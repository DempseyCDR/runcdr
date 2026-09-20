import { and, asc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/server/db/client";
import {
  contacts,
  doorRecordAudit,
  doorRecords,
  events,
  gateChecks,
  gateSales,
  performerPayments,
  performers,
} from "@/server/db/schema";
import type { DoorRecordRow, GateSaleRow } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { assertEventScope } from "@/server/auth/can";
import type { Actor } from "@/server/auth/actor";
import { recordAudit, writeAudit } from "@/server/lib/audit";
import { logger } from "@/server/lib/logger";
import { dollarsToCents, centsToDollars } from "@/server/lib/money";
import { attachMember, recordDuesPayment } from "@/server/domain/membership/accountService";
import { resolveParameterCentsOrNull } from "@/server/domain/parameters/seriesParameterService";
import { depositCents, posFeeCents } from "./calc";
import type { DoorRecordPatchInput } from "@/server/validation/door";

/** Feature 019 US5 (FR-024): the documented club default when a series has no configured seed float. */
export const CLUB_DEFAULT_SEED_FLOAT_CENTS = 1500;

/**
 * The seed float (cents) a NEW door record for this event should open with: the series' configured value in
 * effect on the event date, or the club default when unconfigured (FR-022/FR-024). A configured $0 is
 * honoured — `resolveParameterCentsOrNull` keeps it distinct from unconfigured (R4).
 */
async function resolveSeedFloatCents(
  db: DbOrTx,
  seriesId: string,
  onDate: string,
): Promise<number> {
  const configured = await resolveParameterCentsOrNull(db, {
    category: "door",
    kind: "seed_float",
    seriesId,
    onDate,
  });
  return configured ?? CLUB_DEFAULT_SEED_FLOAT_CENTS;
}

/**
 * Assert a gate write against the door record's event scope (FR-020). A door record belongs to an
 * event, and the event carries the series/group an FS grant is scoped to — so a gate write resolves to
 * exactly the series the FS was granted (or was not). The Door Attendant never reaches here: they hold
 * no `gate.write` at all, so layer 1 refuses them first.
 */
async function assertGateScope(db: Db, actor: Actor | undefined, eventId: string): Promise<void> {
  if (!actor) return;
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();
  assertEventScope(actor, "gate.write", { seriesId: event.seriesId, groupId: event.groupId });
}

/** Door-record view returned to clients — the POS fee is intentionally omitted (FR-007). */
export type DoorRecordView = {
  id: string;
  eventId: string;
  posTransactionCount: number;
  pcGross: number; // derived sum of card lines (was "POS gross")
  grossCash: number; // derived sum of cash lines
  seedFloat: number;
  cashPaidOut: number;
  cashPaidOutReason: string | null;
  deposit: number;
  giftCardRedemptionCount: number;
  compCount: number;
  openBandCount: number; // feature 017 (B36): open-band comps; FS sees it read-only on /gate
  /** Feature 081 (FR-033): cash paid to performers from these takings — `cashPaidOut` is everything else. */
  performerCash: PerformerCashLine[];
};

/** Feature 081: one live cash payment to a performer, recorded at the event. */
export type PerformerCashLine = { paymentId: string; payee: string; amount: number };

type PerformerCashRow = { paymentId: string; payee: string; amountCents: number };

/** Feature 081 (R7): the live cash payments to performers recorded at an event, oldest first. */
async function performerCashRows(db: DbOrTx, eventId: string): Promise<PerformerCashRow[]> {
  return db
    .select({
      paymentId: performerPayments.id,
      payee: performers.displayName,
      amountCents: performerPayments.amountCents,
    })
    .from(performerPayments)
    .innerJoin(performers, eq(performers.id, performerPayments.payeePerformerId))
    .where(
      and(
        eq(performerPayments.eventId, eventId),
        eq(performerPayments.method, "cash"),
        isNull(performerPayments.voidedAt),
      ),
    )
    .orderBy(asc(performerPayments.createdAt));
}

export async function performerCashFor(db: DbOrTx, eventId: string): Promise<PerformerCashLine[]> {
  return (await performerCashRows(db, eventId)).map((r) => ({
    paymentId: r.paymentId,
    payee: r.payee,
    amount: centsToDollars(r.amountCents),
  }));
}

/** Feature 082: the same figure in cents, for the deposit arithmetic. */
export async function performerCashCentsFor(db: DbOrTx, eventId: string): Promise<number> {
  return (await performerCashRows(db, eventId)).reduce((a, r) => a + r.amountCents, 0);
}

/**
 * Feature 081 (FR-033, R7): recompute and store an event's deposit — gross cash less the float, the gate's
 * other payouts and the cash paid to performers. Called in the same transaction as any write that changes
 * one of them, so every reader of the stored deposit (gate, treasurer and organizer reports) stays right.
 * A no-op for an event with no door record.
 *
 * Feature 082 (research R4): the checks NOT marked "deposit separately" go to the bank on the same slip,
 * so they belong in this figure too. A marked check makes its own deposit and is listed by `eventDeposits`.
 */
export async function refreshDeposit(tx: DbOrTx, eventId: string): Promise<void> {
  const door = await tx.query.doorRecords.findFirst({ where: eq(doorRecords.eventId, eventId) });
  if (!door) return;
  const cash = (await performerCashRows(tx, eventId)).reduce((a, r) => a + r.amountCents, 0);
  // The checks banked with the cash. Queried here rather than through `deposits.ts`, which reads this
  // module for the performers' cash — one direction only, so there is no import cycle.
  const bankedChecks = await tx
    .select({ amountCents: gateSales.amountCents })
    .from(gateSales)
    .innerJoin(gateChecks, eq(gateChecks.id, gateSales.checkId))
    .where(and(eq(gateChecks.doorRecordId, door.id), eq(gateChecks.depositSeparately, false)));
  const checks = bankedChecks.reduce((a, r) => a + r.amountCents, 0);
  const deposit =
    depositCents(door.grossCashCents, door.seedFloatCents, door.cashPaidOutCents, cash) + checks;
  if (deposit === door.depositCents) return;
  await tx
    .update(doorRecords)
    .set({ depositCents: deposit, updatedAt: new Date() })
    .where(eq(doorRecords.id, door.id));
  logger.info(
    {
      event: "door_record.deposit_refreshed",
      eventId,
      depositCents: deposit,
      performerCashCents: cash,
    },
    "deposit refreshed",
  );
}

function toView(row: DoorRecordRow, performerCash: PerformerCashLine[] = []): DoorRecordView {
  return {
    id: row.id,
    eventId: row.eventId,
    posTransactionCount: row.posTransactionCount,
    pcGross: centsToDollars(row.pcGrossCents),
    grossCash: centsToDollars(row.grossCashCents),
    seedFloat: centsToDollars(row.seedFloatCents),
    cashPaidOut: centsToDollars(row.cashPaidOutCents),
    cashPaidOutReason: row.cashPaidOutReason,
    deposit: centsToDollars(row.depositCents),
    giftCardRedemptionCount: row.giftCardRedemptionCount,
    compCount: row.compCount,
    openBandCount: row.openBandCount,
    performerCash,
  };
}

export async function createDoorRecord(
  db: Db,
  eventId: string,
  actor: string | null = null,
): Promise<DoorRecordView> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();
  const existing = await db.query.doorRecords.findFirst({
    where: eq(doorRecords.eventId, eventId),
  });
  if (existing) throw errors.doorRecordExists();

  // Feature 019 US5: seed the float from the series parameter (copied once, at creation — FR-025).
  const seedFloatCents = await resolveSeedFloatCents(db, event.seriesId, event.eventDate);
  const [row] = await db.insert(doorRecords).values({ eventId, seedFloatCents }).returning();
  if (!row) throw new Error("door record insert failed");
  await db.insert(doorRecordAudit).values({ doorRecordId: row.id, action: "created", actor });
  writeAudit({ kind: "door_record.created", actor, details: { doorRecordId: row.id, eventId } });
  return toView(row);
}

/** Get-or-create the door record for an event (used when money/donations appear). */
export async function ensureDoorRecord(
  db: DbOrTx,
  eventId: string,
  actor: string | null = null,
): Promise<DoorRecordRow> {
  const existing = await db.query.doorRecords.findFirst({
    where: eq(doorRecords.eventId, eventId),
  });
  if (existing) return existing;
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();
  const seedFloatCents = await resolveSeedFloatCents(db, event.seriesId, event.eventDate);
  const [row] = await db.insert(doorRecords).values({ eventId, seedFloatCents }).returning();
  if (!row) throw new Error("door record insert failed");
  await db.insert(doorRecordAudit).values({ doorRecordId: row.id, action: "created", actor });
  writeAudit({ kind: "door_record.created", actor, details: { doorRecordId: row.id, eventId } });
  return row;
}

/**
 * Feature 025 US1 (FR-007): nudge an event's aggregate comp / gift-card count by ±1 (counts-only, decision
 * B — never attributed to a person), floored at zero. The Door Attendant's roster correction; the FS's gate
 * override still supersedes for final money. Ensures the door record first.
 */
export async function adjustDoorCount(
  db: Db,
  eventId: string,
  count: "comp" | "gift",
  delta: 1 | -1,
  actor: string | null = null,
): Promise<{ compCount: number; giftCardRedemptionCount: number }> {
  const dr = await ensureDoorRecord(db, eventId, actor);
  const set =
    count === "comp"
      ? { compCount: sql`greatest(0, ${doorRecords.compCount} + ${delta})`, updatedAt: new Date() }
      : {
          giftCardRedemptionCount: sql`greatest(0, ${doorRecords.giftCardRedemptionCount} + ${delta})`,
          updatedAt: new Date(),
        };
  const [row] = await db.update(doorRecords).set(set).where(eq(doorRecords.id, dr.id)).returning();
  if (!row) throw errors.doorRecordNotFound();
  writeAudit({ kind: "door_record.updated", actor, details: { eventId, count, delta } });
  return { compCount: row.compCount, giftCardRedemptionCount: row.giftCardRedemptionCount };
}

/** Update the manually-entered fields, then recompute derived totals (fee/deposit). */
export async function updateDoorRecord(
  db: Db,
  id: string,
  input: DoorRecordPatchInput,
  actor: string | null = null,
  authz?: Actor,
): Promise<DoorRecordView> {
  const current = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, id) });
  if (!current) throw errors.doorRecordNotFound();
  await assertGateScope(db, authz, current.eventId); // FR-020: the FS owns money only for their series

  // Feature 082 (FR-012, research R8): the count in progress, written as Mary keys it. Scratch work, not
  // the evening's money — so it touches nothing else, names no one as having recorded the money, and
  // writes no audit row (or every keypress would).
  if (Object.keys(input).length === 1 && input.cashCount !== undefined) {
    const [row] = await db
      .update(doorRecords)
      .set({ cashCount: input.cashCount })
      .where(eq(doorRecords.id, id))
      .returning();
    if (!row) throw errors.doorRecordNotFound();
    return toView(row, await performerCashFor(db, current.eventId));
  }

  // Feature 082 (FR-007): cash paid out with no reason is no longer REFUSED. Refusing the whole
  // evening's money over a missing word lost more than it protected; the Save now says so as a warning
  // (`gateWarnings`) and Mary adds the reason and saves again.
  const cashPaidOutCents =
    input.cashPaidOut !== undefined ? dollarsToCents(input.cashPaidOut) : current.cashPaidOutCents;
  const cashPaidOutReason =
    input.cashPaidOutReason !== undefined ? input.cashPaidOutReason : current.cashPaidOutReason;

  const grossCashCents =
    input.grossCash !== undefined ? dollarsToCents(input.grossCash) : current.grossCashCents;
  const pcGrossCents =
    input.pcGross !== undefined ? dollarsToCents(input.pcGross) : current.pcGrossCents;
  const seedFloatCents =
    input.seedFloat !== undefined ? dollarsToCents(input.seedFloat) : current.seedFloatCents;
  const posTransactionCount = input.posTransactionCount ?? current.posTransactionCount;
  const fee = posFeeCents(posTransactionCount, pcGrossCents);

  const row = await db.transaction(async (tx) => {
    await tx
      .update(doorRecords)
      .set({
        posTransactionCount,
        grossCashCents,
        pcGrossCents,
        seedFloatCents,
        cashPaidOutCents,
        cashPaidOutReason,
        posFeeCents: fee,
        giftCardRedemptionCount: input.giftCardRedemptionCount ?? current.giftCardRedemptionCount,
        compCount: input.compCount ?? current.compCount,
        // Feature 082 (FR-012): saving the money drops the count — the saved gross cash is the record —
        // unless the save itself carries one.
        cashCount: input.cashCount ?? {},
        // Feature 082 (FR-030): the evening's note. Blank clears it; a save that omits it leaves it.
        ...(input.eveningNote !== undefined ? { eveningNote: blankToNull(input.eveningNote) } : {}),
        // Feature 082 (FR-033, research R7): the last person to save the evening's money, for the report.
        moneyRecordedByContactId: authz?.staff.contactId ?? current.moneyRecordedByContactId,
        updatedAt: new Date(),
      })
      .where(eq(doorRecords.id, id));
    // The deposit is the cash less the float, the payouts and the performers' cash, PLUS the checks not
    // banked separately (082, R4). One function computes it, so saving the money can never drop the
    // checks from it.
    await refreshDeposit(tx, current.eventId);
    await tx.insert(doorRecordAudit).values({
      doorRecordId: id,
      action: "updated",
      actor,
      details: { fields: Object.keys(input) },
    });
    const [saved] = await tx.select().from(doorRecords).where(eq(doorRecords.id, id));
    if (!saved) throw errors.doorRecordNotFound();
    // Feature 082 (FR-034): a durable row naming the signed-in volunteer, replacing the log-only
    // `writeAudit` whose actor was whatever the page sent — in practice always "door".
    await recordAudit(tx, {
      kind: "door_record.updated",
      actorContactId: authz?.staff.contactId ?? null,
      details: {
        doorRecordId: id,
        posFeeCents: saved.posFeeCents,
        depositCents: saved.depositCents,
      },
    });
    return saved;
  });
  return toView(row, await performerCashFor(db, current.eventId));
}

function blankToNull(note: string | null): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
}

/** A membership created/renewed by a door gate save — surfaced to the FS so they see it worked (T012). */
export type DoorEnrollment = { contactId: string; displayName: string; expiryDate: string };

/**
 * Feature 019 (FR-001..FR-004): for each NAMED `membership` gate line just written, create or renew the
 * contact's membership — inside the gate-sale transaction, so it is all-or-nothing (FR-001).
 *
 * Idempotency: the guard is (contact, target boundary), NOT the gate-sale id — a sale can be corrected,
 * removed and recorded again (and before feature 082 the gate's Save re-inserted every row). A contact who already holds a membership reaching the target boundary is skipped (renewal no-op,
 * FR-004); a later payment past that boundary genuinely renews. `source_gate_sale_id` is recorded as
 * provenance and backs a secondary unique index. Anonymous lines (no contactId) record money only (FR-002).
 *
 * Feature 082 (the quickstart walk, §3.3): the sale's contact is the PAYER, who owns the account and is
 * always a member of it; `members[i]` names the others sale `i` covers — Rachel and Finn, when Will pays —
 * each attached to the payer's account. A level that covers the payer alone refuses them, and the whole
 * write with it.
 */
export async function enrollDoorMemberships(
  tx: DbOrTx,
  eventId: string,
  sales: GateSaleRow[],
  actorId: string | null,
  members: (string[] | undefined)[] = [],
): Promise<DoorEnrollment[]> {
  const named = sales.flatMap((s, i) =>
    s.category === "membership" && s.contactId ? [{ sale: s, members: members[i] ?? [] }] : [],
  );
  if (named.length === 0) return [];

  const event = await tx.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();
  const enrolled: DoorEnrollment[] = [];
  for (const { sale, members: others } of named) {
    const contactId = sale.contactId!;
    const contact = await tx.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
    // Feature 068: dues open or renew the payer's DURABLE account. The renewal no-op lives inside
    // `recordDuesPayment` (a payment never pulls coverage backwards), which is also what keeps the
    // replace-all gate save idempotent — gate-sale ids were never stable enough to key on.
    const account = await recordDuesPayment(
      tx as unknown as Db,
      contactId,
      { level: sale.membershipLevel ?? "individual", paymentDate: event.eventDate },
      actorId,
    );
    for (const member of others) await attachMember(tx, contactId, member, actorId);
    const targetExpiry = account.expiryDate;
    writeAudit({
      kind: "membership.door_enrollment",
      actor: actorId,
      details: { contactId, eventId, expiryDate: targetExpiry, gateSaleId: sale.id },
    });
    enrolled.push({
      contactId,
      displayName: contact?.displayName ?? "Member",
      expiryDate: targetExpiry,
    });
  }
  return enrolled;
}

/**
 * A gate sale ROW plus the payer's display name (null for anonymous lines). The raw getter's shape; the
 * pages read `GateSaleView` from `gateSaleService` via `doorRecordPayload` (feature 082).
 */
export type GateSaleRowWithName = GateSaleRow & { contactName: string | null };

export async function getDoorRecord(
  db: Db,
  id: string,
): Promise<{ doorRecord: DoorRecordView; gateSales: GateSaleRowWithName[] }> {
  const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, id) });
  if (!row) throw errors.doorRecordNotFound();
  // D2: join the contact so a NAMED sale (donation/future_event/membership) can be re-shown with its payer's
  // name when the gate form reloads — the raw row carries only contact_id.
  const sales = await db
    .select({ ...getTableColumns(gateSales), contactName: contacts.displayName })
    .from(gateSales)
    .leftJoin(contacts, eq(contacts.id, gateSales.contactId))
    .where(eq(gateSales.doorRecordId, id));
  return { doorRecord: toView(row, await performerCashFor(db, row.eventId)), gateSales: sales };
}
