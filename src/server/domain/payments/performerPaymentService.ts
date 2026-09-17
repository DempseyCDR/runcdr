import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, DbOrTx } from "@/server/db/client";
import {
  bookings,
  events,
  paymentBookings,
  performerPayments,
  performers,
  treasurerReportAudit,
} from "@/server/db/schema";
import type {
  PerformerPaymentMethod,
  PerformerPaymentRow,
  PerformerType,
} from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { assertEventScope } from "@/server/auth/can";
import type { Actor } from "@/server/auth/actor";
import { recordAudit, writeAudit } from "@/server/lib/audit";
import { dollarsToCents, centsToDollars } from "@/server/lib/money";
import type {
  PaymentLineAddInput,
  PerformerPaymentCreateInput,
  PerformerPaymentPatchInput,
} from "@/server/validation/payments";
import { reconcilePayments, type Reconciliation } from "./reconcile";
import { ensureDoorRecord, refreshDeposit } from "@/server/domain/door/doorRecordService";
import { getPaymentSummary, type PaymentSummary } from "./paymentSummary";

/** Feature 081 (FR-039): check numbers are compared trimmed and in capitals, whoever calls. */
const normaliseNumber = (n: string | null | undefined) =>
  n === undefined || n === null ? n : n.trim().toUpperCase();

/** Feature 081 (FR-031, FR-032): cash has no number and settles exactly one booking. */
function assertMethodShape(
  method: PerformerPaymentMethod,
  checkNumber: string | null | undefined,
  lineCount: number,
): void {
  if (method === "cash" && lineCount > 1) throw errors.cashSingleBooking();
  if (method === "cash" && checkNumber) throw errors.validation("Cash has no check number.");
  if (method === "check" && !checkNumber) throw errors.validation("A check needs a check number.");
}

const UNIQUE_VIOLATION = "23505";

/**
 * Feature 081 (FR-022, R8): the voided check a new payment replaces — the most recently voided payment
 * that settled one of its bookings and has not been replaced already.
 */
async function voidedToReplace(q: DbOrTx, bookingIds: string[]): Promise<string | null> {
  const replaced = alias(performerPayments, "replaced_by");
  const [row] = await q
    .select({ id: performerPayments.id })
    .from(performerPayments)
    .innerJoin(paymentBookings, eq(paymentBookings.paymentId, performerPayments.id))
    .leftJoin(replaced, eq(replaced.replacesPaymentId, performerPayments.id))
    .where(
      and(
        inArray(paymentBookings.bookingId, bookingIds),
        isNotNull(performerPayments.voidedAt),
        isNull(replaced.id),
      ),
    )
    .orderBy(desc(performerPayments.voidedAt))
    .limit(1);
  return row?.id ?? null;
}

/** Feature 081 (FR-011, R2): refuse a line for a booking that already has a live payment. */
async function assertLinesUnpaid(
  q: DbOrTx,
  bookingIds: string[],
  exceptPaymentId: string | null = null,
): Promise<void> {
  if (bookingIds.length === 0) return;
  const [paid] = await q
    .select({
      bookingId: paymentBookings.bookingId,
      paymentId: performerPayments.id,
      checkNumber: performerPayments.checkNumber,
      method: performerPayments.method,
    })
    .from(paymentBookings)
    .innerJoin(performerPayments, eq(performerPayments.id, paymentBookings.paymentId))
    .where(
      and(
        inArray(paymentBookings.bookingId, bookingIds),
        eq(paymentBookings.live, true),
        exceptPaymentId ? ne(performerPayments.id, exceptPaymentId) : undefined,
      ),
    )
    .limit(1);
  if (paid) throw errors.bookingAlreadyPaid(paid);
}

/**
 * Feature 081 (FR-012, FR-013, R3): refuse a check number another payment holds, live or voided. `sameEvent`
 * says whether that check was recorded at the event being paid from, so the page may offer to add to it.
 */
async function assertNumberFree(
  q: DbOrTx,
  checkNumber: string | null | undefined,
  payingEventId: string,
  exceptPaymentId: string | null = null,
): Promise<void> {
  if (!checkNumber) return;
  const [held] = await q
    .select({
      paymentId: performerPayments.id,
      eventId: performerPayments.eventId,
      eventDate: events.eventDate,
      payee: performers.displayName,
      voidedAt: performerPayments.voidedAt,
    })
    .from(performerPayments)
    .innerJoin(events, eq(events.id, performerPayments.eventId))
    .innerJoin(performers, eq(performers.id, performerPayments.payeePerformerId))
    .where(
      and(
        eq(performerPayments.checkNumber, checkNumber),
        exceptPaymentId ? ne(performerPayments.id, exceptPaymentId) : undefined,
      ),
    )
    .limit(1);
  if (!held) return;
  throw errors.checkNumberTaken(checkNumber, {
    paymentId: held.paymentId,
    eventId: held.eventId,
    eventDate: held.eventDate,
    payee: held.payee,
    voided: held.voidedAt !== null,
    sameEvent: held.eventId === payingEventId,
  });
}

/**
 * Feature 081 (FR-014, R5): a performer who already has a live payment at this event is paid again only when
 * Mary has confirmed it.
 */
async function assertNoOtherPaymentToPayee(
  q: DbOrTx,
  eventId: string,
  payeePerformerId: string,
  confirmed: boolean | undefined,
  exceptPaymentId: string | null = null,
): Promise<void> {
  if (confirmed) return;
  const [other] = await q
    .select({
      paymentId: performerPayments.id,
      checkNumber: performerPayments.checkNumber,
      method: performerPayments.method,
      amountCents: performerPayments.amountCents,
      payee: performers.displayName,
    })
    .from(performerPayments)
    .innerJoin(performers, eq(performers.id, performerPayments.payeePerformerId))
    .where(
      and(
        eq(performerPayments.eventId, eventId),
        eq(performerPayments.payeePerformerId, payeePerformerId),
        isNull(performerPayments.voidedAt),
        exceptPaymentId ? ne(performerPayments.id, exceptPaymentId) : undefined,
      ),
    )
    .limit(1);
  if (!other) return;
  throw errors.secondPaymentToPayee(other.payee, {
    paymentId: other.paymentId,
    checkNumber: other.checkNumber,
    method: other.method,
    amount: centsToDollars(other.amountCents),
  });
}

/**
 * Two people saving at once can both pass the checks; the database's unique indexes stop the second. Turn
 * that into the same refusal the checks would have given, with its details (research R2, R3).
 */
async function explainConflict(err: unknown, recheck: () => Promise<void>): Promise<never> {
  if ((err as { code?: string }).code === UNIQUE_VIOLATION) await recheck();
  throw err;
}

/**
 * Feature 081 (FR-033, R7): cash comes out of the evening's takings, so a cash write keeps the event's door
 * record — created if missing — and its stored deposit in step, in the same transaction.
 */
async function syncCash(tx: DbOrTx, eventId: string): Promise<void> {
  await ensureDoorRecord(tx, eventId, "performer-payment");
  await refreshDeposit(tx, eventId);
}

/**
 * One booking a payment settles. Feature 081: with what the booking said (`booked`) and where it was — the
 * event may be an earlier one than the payment's (US7).
 */
export type PerformerPaymentLineView = {
  bookingId: string;
  amount: number;
  booked: number;
  eventId: string;
  eventDate: string;
  performer: string;
  performerType: PerformerType;
};
export type PerformerPaymentView = {
  id: string;
  eventId: string;
  payeePerformerId: string;
  payee: string;
  method: PerformerPaymentMethod; // feature 081 (R1)
  amount: number; // the check total = Σ line amounts
  checkNumber: string | null;
  overrideReason: string | null;
  voided: boolean;
  voidReason: string | null;
  voidedAt: string | null;
  replacesPaymentId: string | null;
  /** Feature 081 (R8): the number of the payment that replaced this voided check, if any. */
  replacedByCheckNumber: string | null;
  lines: PerformerPaymentLineView[];
};

/** Assert the money boundary against the payment's EVENT scope (FR-009), like the gate does. */
export async function assertPaymentScope(
  db: Db,
  authz: Actor | undefined,
  eventId: string,
): Promise<void> {
  if (!authz) return;
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();
  assertEventScope(authz, "performer_payment.write", {
    seriesId: event.seriesId,
    groupId: event.groupId,
  });
}

/**
 * Feature 023: bookings must exist, but MAY belong to ANY event — a delayed check written at one event can
 * settle a booking performed at another (cross-event). (Was `assertBookingsForEvent`, which required same
 * event; relaxed in 023, R2.)
 */
async function assertBookingsExist(db: Db, bookingIds: string[]): Promise<void> {
  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(inArray(bookings.id, bookingIds));
  if (rows.length !== new Set(bookingIds).size) throw errors.bookingNotFound();
}

async function linesFor(db: DbOrTx, paymentId: string): Promise<PerformerPaymentLineView[]> {
  const rows = await db
    .select({
      bookingId: paymentBookings.bookingId,
      amountCents: paymentBookings.amountCents,
      bookedCents: bookings.payCents,
      eventId: bookings.eventId,
      eventDate: events.eventDate,
      performer: performers.displayName,
      performerType: bookings.performerType,
    })
    .from(paymentBookings)
    .innerJoin(bookings, eq(bookings.id, paymentBookings.bookingId))
    .innerJoin(events, eq(events.id, bookings.eventId))
    .innerJoin(performers, eq(performers.id, bookings.performerId))
    .where(eq(paymentBookings.paymentId, paymentId));
  return rows.map((r) => ({
    bookingId: r.bookingId,
    amount: centsToDollars(r.amountCents),
    booked: centsToDollars(r.bookedCents),
    eventId: r.eventId,
    eventDate: r.eventDate,
    performer: r.performer,
    performerType: r.performerType,
  }));
}

async function toView(db: DbOrTx, row: PerformerPaymentRow): Promise<PerformerPaymentView> {
  const performer = await db.query.performers.findFirst({
    where: eq(performers.id, row.payeePerformerId),
  });
  const replacement = await db.query.performerPayments.findFirst({
    where: eq(performerPayments.replacesPaymentId, row.id),
  });
  return {
    id: row.id,
    eventId: row.eventId,
    payeePerformerId: row.payeePerformerId,
    payee: performer?.displayName ?? "(unknown)",
    method: row.method,
    amount: centsToDollars(row.amountCents),
    checkNumber: row.checkNumber,
    overrideReason: row.overrideReason,
    voided: row.voidedAt !== null,
    voidReason: row.voidReason,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    replacesPaymentId: row.replacesPaymentId,
    replacedByCheckNumber: replacement?.checkNumber ?? null,
    lines: await linesFor(db, row.id),
  };
}

export async function createPerformerPayment(
  db: Db,
  input: PerformerPaymentCreateInput,
  actor: string | null = null,
  authz?: Actor,
): Promise<PerformerPaymentView> {
  await assertPaymentScope(db, authz, input.eventId);
  const performer = await db.query.performers.findFirst({
    where: eq(performers.id, input.payeePerformerId),
  });
  if (!performer) throw errors.performerNotFound();
  await assertBookingsExist(
    db,
    input.lines.map((l) => l.bookingId),
  );

  // The check total is the sum of its per-line amounts (integer cents).
  const lineCents = input.lines.map((l) => ({
    bookingId: l.bookingId,
    amountCents: dollarsToCents(l.amount),
  }));
  const totalCents = lineCents.reduce((a, l) => a + l.amountCents, 0);
  const checkNumber = normaliseNumber(input.checkNumber) ?? null;
  assertMethodShape(input.method, checkNumber, lineCents.length);

  const bookingIds = lineCents.map((l) => l.bookingId);
  const checks = async (q: DbOrTx) => {
    await assertLinesUnpaid(q, bookingIds);
    await assertNumberFree(q, checkNumber, input.eventId);
    await assertNoOtherPaymentToPayee(
      q,
      input.eventId,
      input.payeePerformerId,
      input.confirmSecondPayment,
    );
  };

  const created = await db
    .transaction(async (tx) => {
      await checks(tx);
      const replacesPaymentId = await voidedToReplace(tx, bookingIds);
      const [row] = await tx
        .insert(performerPayments)
        .values({
          eventId: input.eventId,
          payeePerformerId: input.payeePerformerId,
          amountCents: totalCents,
          method: input.method, // feature 081 (R1)
          checkNumber,
          overrideReason: input.overrideReason ?? null,
          replacesPaymentId,
        })
        .returning();
      if (!row) throw new Error("performer payment insert failed");
      await tx.insert(paymentBookings).values(
        lineCents.map((l) => ({
          paymentId: row.id,
          bookingId: l.bookingId,
          amountCents: l.amountCents,
        })),
      );
      if (row.method === "cash") await syncCash(tx, row.eventId);
      return row;
    })
    .catch((err: unknown) => explainConflict(err, () => checks(db)));
  writeAudit({
    kind: "performer_payment.created",
    actor,
    details: { paymentId: created.id, eventId: input.eventId, lines: lineCents.length },
  });
  return toView(db, created);
}

export async function patchPerformerPayment(
  db: Db,
  id: string,
  input: PerformerPaymentPatchInput,
  actor: string | null = null,
  authz?: Actor,
): Promise<PerformerPaymentView> {
  const current = await db.query.performerPayments.findFirst({
    where: eq(performerPayments.id, id),
  });
  if (!current) throw errors.performerPaymentNotFound();
  await assertPaymentScope(db, authz, current.eventId);
  // A voided check is terminal — correct it with a reissue, never by editing.
  if (current.voidedAt !== null) throw errors.alreadyVoided();
  if (input.lines)
    await assertBookingsExist(
      db,
      input.lines.map((l) => l.bookingId),
    );

  const lineCents = input.lines?.map((l) => ({
    bookingId: l.bookingId,
    amountCents: dollarsToCents(l.amount),
  }));
  const method = input.method ?? current.method;
  const checkNumber =
    input.checkNumber !== undefined
      ? normaliseNumber(input.checkNumber)
      : method === "cash"
        ? null // switching a check to cash drops its number
        : current.checkNumber;
  const lineCount =
    lineCents?.length ?? (await db.$count(paymentBookings, eq(paymentBookings.paymentId, id)));
  assertMethodShape(method, checkNumber, lineCount);
  const payee = input.payeePerformerId ?? current.payeePerformerId;
  const checks = async (q: DbOrTx) => {
    if (lineCents)
      await assertLinesUnpaid(
        q,
        lineCents.map((l) => l.bookingId),
        id,
      );
    if (checkNumber !== current.checkNumber)
      await assertNumberFree(q, checkNumber, current.eventId, id);
    if (payee !== current.payeePerformerId)
      await assertNoOtherPaymentToPayee(q, current.eventId, payee, input.confirmSecondPayment, id);
  };

  const updated = await db
    .transaction(async (tx) => {
      await checks(tx);
      const [row] = await tx
        .update(performerPayments)
        .set({
          amountCents: lineCents
            ? lineCents.reduce((a, l) => a + l.amountCents, 0)
            : current.amountCents,
          method,
          checkNumber,
          payeePerformerId: payee,
          overrideReason:
            input.overrideReason !== undefined ? input.overrideReason : current.overrideReason,
          updatedAt: new Date(),
        })
        .where(eq(performerPayments.id, id))
        .returning();
      if (!row) throw errors.performerPaymentNotFound();
      if (lineCents) {
        await tx.delete(paymentBookings).where(eq(paymentBookings.paymentId, id));
        await tx.insert(paymentBookings).values(
          lineCents.map((l) => ({
            paymentId: id,
            bookingId: l.bookingId,
            amountCents: l.amountCents,
          })),
        );
      }
      if (row.method === "cash" || current.method === "cash") await syncCash(tx, row.eventId);
      return row;
    })
    .catch((err: unknown) => explainConflict(err, () => checks(db)));
  writeAudit({
    kind: "performer_payment.updated",
    actor,
    details: { paymentId: id, fields: Object.keys(input) },
  });
  return toView(db, updated);
}

/**
 * Feature 081 (FR-013, R4, analysis I1): "Add this booking to check #N" — one more line on a live check,
 * its total growing by the line. The check must have been recorded at the event Mary is paying from; the
 * booking may be that event's or an earlier one's.
 */
export async function addPaymentLine(
  db: Db,
  id: string,
  input: PaymentLineAddInput,
  actor: string | null = null,
  authz?: Actor,
): Promise<PerformerPaymentView> {
  const current = await db.query.performerPayments.findFirst({
    where: eq(performerPayments.id, id),
  });
  if (!current) throw errors.performerPaymentNotFound();
  await assertPaymentScope(db, authz, current.eventId);
  if (current.voidedAt !== null) throw errors.alreadyVoided();
  if (current.method === "cash") throw errors.cashSingleBooking();
  if (current.eventId !== input.eventId) {
    throw errors.validation(
      "That check was recorded at another event — change the number instead.",
    );
  }
  await assertBookingsExist(db, [input.bookingId]);
  const amountCents = dollarsToCents(input.amount);
  const checks = (q: DbOrTx) => assertLinesUnpaid(q, [input.bookingId]);

  const updated = await db
    .transaction(async (tx) => {
      await checks(tx);
      await tx
        .insert(paymentBookings)
        .values({ paymentId: id, bookingId: input.bookingId, amountCents });
      const [row] = await tx
        .update(performerPayments)
        .set({ amountCents: current.amountCents + amountCents, updatedAt: new Date() })
        .where(eq(performerPayments.id, id))
        .returning();
      if (!row) throw errors.performerPaymentNotFound();
      return row;
    })
    .catch((err: unknown) => explainConflict(err, () => checks(db)));
  writeAudit({
    kind: "performer_payment.line_added",
    actor,
    details: { paymentId: id, bookingId: input.bookingId, amountCents },
  });
  return toView(db, updated);
}

/** Feature 023: void a check — it persists (the treasurer records the void) and settles nothing. */
export async function voidPerformerPayment(
  db: Db,
  id: string,
  reason: string,
  actor: string | null = null,
  authz?: Actor,
): Promise<PerformerPaymentView> {
  const current = await db.query.performerPayments.findFirst({
    where: eq(performerPayments.id, id),
  });
  if (!current) throw errors.performerPaymentNotFound();
  await assertPaymentScope(db, authz, current.eventId);
  // Feature 081 (FR-020, R6, R9): a check is voided once, and cash is never voided — it is corrected or
  // deleted. The update itself only touches a live check, so a second void racing the first changes nothing.
  if (current.method === "cash") throw errors.cashNotVoidable();
  if (current.voidedAt !== null) throw errors.alreadyVoided();
  const row = await db.transaction(async (tx) => {
    const [voided] = await tx
      .update(performerPayments)
      .set({ voidedAt: new Date(), voidReason: reason.trim(), updatedAt: new Date() })
      .where(and(eq(performerPayments.id, id), isNull(performerPayments.voidedAt)))
      .returning();
    if (!voided) throw errors.alreadyVoided();
    // Feature 081 (R2): a voided check settles nothing, so its lines stop counting as live.
    await tx.update(paymentBookings).set({ live: false }).where(eq(paymentBookings.paymentId, id));
    return voided;
  });
  writeAudit({ kind: "performer_payment.voided", actor, details: { paymentId: id, reason } });
  return toView(db, row);
}

export async function deletePerformerPayment(
  db: Db,
  id: string,
  actor: string | null = null,
  authz?: Actor,
): Promise<void> {
  const current = await db.query.performerPayments.findFirst({
    where: eq(performerPayments.id, id),
  });
  if (!current) throw errors.performerPaymentNotFound();
  await assertPaymentScope(db, authz, current.eventId);
  // Feature 081 (FR-016): delete means "never written"; a voided check was written, so it stays.
  if (current.voidedAt !== null) throw errors.alreadyVoided();
  const lines = await db
    .select({ bookingId: paymentBookings.bookingId, amountCents: paymentBookings.amountCents })
    .from(paymentBookings)
    .where(eq(paymentBookings.paymentId, id));
  await db.transaction(async (tx) => {
    await tx.delete(performerPayments).where(eq(performerPayments.id, id)); // join rows cascade
    if (current.method === "cash") await refreshDeposit(tx, current.eventId);
    // A durable record of what was erased, in the same transaction (FR-016, constitution IV).
    await recordAudit(tx, {
      kind: "performer_payment.deleted",
      actorContactId: authz?.staff.contactId ?? null,
      details: {
        paymentId: id,
        eventId: current.eventId,
        payeePerformerId: current.payeePerformerId,
        method: current.method,
        checkNumber: current.checkNumber,
        amount: centsToDollars(current.amountCents),
        overrideReason: current.overrideReason,
        actor,
        lines: lines.map((l) => ({
          bookingId: l.bookingId,
          amount: centsToDollars(l.amountCents),
        })),
      },
    });
  });
}

/**
 * Feature 023 (analyze M1): the cents actually settled onto each of an event's bookings — the sum of LIVE
 * (non-voided) per-line amounts whose booking belongs to the event. Keyed on the booking's event, so a
 * cross-event check contributes to the event its line settles, not the event it was recorded at.
 */
export async function settledCentsByBookingForEvent(
  db: Db,
  eventId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ bookingId: paymentBookings.bookingId, amountCents: paymentBookings.amountCents })
    .from(paymentBookings)
    .innerJoin(performerPayments, eq(performerPayments.id, paymentBookings.paymentId))
    .innerJoin(bookings, eq(bookings.id, paymentBookings.bookingId))
    .where(and(eq(bookings.eventId, eventId), isNull(performerPayments.voidedAt)));
  const byBooking = new Map<string, number>();
  for (const r of rows)
    byBooking.set(r.bookingId, (byBooking.get(r.bookingId) ?? 0) + r.amountCents);
  return byBooking;
}

/**
 * Feature 024: the written-check discriminator, scoped to ONE booking. True iff the booking has a
 * `payment_bookings` line belonging to a LIVE (non-voided) `performer_payments` row — i.e. it is settled by
 * a live check. A voided check does not count (FR-006), so a re-point/clear is allowed again after a void.
 */
export async function bookingHasLivePayment(db: DbOrTx, bookingId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(paymentBookings)
    .innerJoin(performerPayments, eq(performerPayments.id, paymentBookings.paymentId))
    .where(and(eq(paymentBookings.bookingId, bookingId), isNull(performerPayments.voidedAt)));
  return (row?.n ?? 0) > 0;
}

/** True if any of the event's bookings is settled by a LIVE payment line (guardrail — FR-013, H1). */
export async function eventHasLiveSettlement(db: Db, eventId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(paymentBookings)
    .innerJoin(performerPayments, eq(performerPayments.id, paymentBookings.paymentId))
    .innerJoin(bookings, eq(bookings.id, paymentBookings.bookingId))
    .where(and(eq(bookings.eventId, eventId), isNull(performerPayments.voidedAt)));
  return (row?.n ?? 0) > 0;
}

/** FR-008: actual payments recorded at an event, plus the expected-vs-actual reconciliation for the event. */
export async function listPerformerPayments(
  db: Db,
  eventId: string,
): Promise<{
  payments: PerformerPaymentView[];
  reconciliation: ReconciliationView;
  settledByBooking: Record<string, number>;
  summary: PaymentSummary;
  voidedByBooking: Record<string, VoidedLineView[]>;
  paidElsewhere: Record<string, PaidElsewhereView>;
  treasurerReportGeneratedAt: string | null;
}> {
  const paymentRows = await db
    .select()
    .from(performerPayments)
    .where(eq(performerPayments.eventId, eventId));
  const payments = await Promise.all(paymentRows.map((r) => toView(db, r)));

  // Reconciliation (M1): expected = the event's bookings' pay; actual = the LIVE per-line amounts settling
  // THIS event's bookings (regardless of which check paid them, excluding voided).
  const bookingRows = await db
    .select({ id: bookings.id, payCents: bookings.payCents })
    .from(bookings)
    .where(eq(bookings.eventId, eventId));
  const settled = await settledCentsByBookingForEvent(db, eventId);
  const recon: Reconciliation = reconcilePayments(
    bookingRows.map((b) => b.payCents),
    bookingRows.map((b) => settled.get(b.id) ?? 0),
  );
  return {
    payments,
    reconciliation: {
      expected: centsToDollars(recon.expectedCents),
      actual: centsToDollars(recon.actualCents),
      delta: centsToDollars(recon.deltaCents),
    },
    // Feature 030 (FR-016): per-booking LIVE settled cents (cross-event aware — a check recorded at another
    // event still counts here) so the per-performer page classifies a settled booking as paid, never
    // outstanding. Same map already computed for reconciliation; reconciliation math is unchanged.
    settledByBooking: Object.fromEntries(bookingRows.map((b) => [b.id, settled.get(b.id) ?? 0])),
    summary: await getPaymentSummary(db, eventId), // feature 081 (FR-004)
    voidedByBooking: await voidedByBookingFor(
      db,
      bookingRows.map((b) => b.id),
    ),
    paidElsewhere: await paidElsewhereFor(db, eventId),
    treasurerReportGeneratedAt: await treasurerReportGeneratedAt(db, eventId),
  };
}

type ReconciliationView = { expected: number; actual: number; delta: number };

/** Feature 081 (FR-021): a voided check shown quietly under a booking it had settled. */
export type VoidedLineView = {
  paymentId: string;
  checkNumber: string | null;
  reason: string | null;
};

/** Voided checks that settled each of these bookings — wherever they were recorded — oldest void first. */
async function voidedByBookingFor(
  db: DbOrTx,
  bookingIds: string[],
): Promise<Record<string, VoidedLineView[]>> {
  if (bookingIds.length === 0) return {};
  const rows = await db
    .select({
      bookingId: paymentBookings.bookingId,
      paymentId: performerPayments.id,
      checkNumber: performerPayments.checkNumber,
      reason: performerPayments.voidReason,
    })
    .from(paymentBookings)
    .innerJoin(performerPayments, eq(performerPayments.id, paymentBookings.paymentId))
    .where(
      and(inArray(paymentBookings.bookingId, bookingIds), isNotNull(performerPayments.voidedAt)),
    )
    .orderBy(performerPayments.voidedAt);
  const out: Record<string, VoidedLineView[]> = {};
  for (const r of rows) {
    (out[r.bookingId] ??= []).push({
      paymentId: r.paymentId,
      checkNumber: r.checkNumber,
      reason: r.reason,
    });
  }
  return out;
}

/** Feature 081 (FR-037): where a booking of this event was paid, when that was at another event. */
export type PaidElsewhereView = { eventId: string; eventDate: string; paymentId: string };

async function paidElsewhereFor(
  db: DbOrTx,
  eventId: string,
): Promise<Record<string, PaidElsewhereView>> {
  const rows = await db
    .select({
      bookingId: paymentBookings.bookingId,
      paymentId: performerPayments.id,
      eventId: performerPayments.eventId,
      eventDate: events.eventDate,
    })
    .from(paymentBookings)
    .innerJoin(bookings, eq(bookings.id, paymentBookings.bookingId))
    .innerJoin(performerPayments, eq(performerPayments.id, paymentBookings.paymentId))
    .innerJoin(events, eq(events.id, performerPayments.eventId))
    .where(
      and(
        eq(bookings.eventId, eventId),
        eq(paymentBookings.live, true),
        ne(performerPayments.eventId, eventId),
      ),
    );
  return Object.fromEntries(
    rows.map((r) => [
      r.bookingId,
      { eventId: r.eventId, eventDate: r.eventDate, paymentId: r.paymentId },
    ]),
  );
}

/** Feature 081 (FR-017, R17): when the treasurer report was last generated for the event, if ever. */
async function treasurerReportGeneratedAt(db: DbOrTx, eventId: string): Promise<string | null> {
  const [row] = await db
    .select({ at: treasurerReportAudit.createdAt })
    .from(treasurerReportAudit)
    .where(eq(treasurerReportAudit.eventId, eventId))
    .orderBy(desc(treasurerReportAudit.createdAt))
    .limit(1);
  return row?.at.toISOString() ?? null;
}
