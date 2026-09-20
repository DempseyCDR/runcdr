import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, DbOrTx } from "@/server/db/client";
import { contacts, doorRecords, events, gateChecks, gateSales } from "@/server/db/schema";
import type { GateSaleRow } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { actorCan, assertEventScopeAny, type EventScope } from "@/server/auth/can";
import type { Actor } from "@/server/auth/actor";
import { recordAudit } from "@/server/lib/audit";
import { centsToDollars, dollarsToCents } from "@/server/lib/money";
import type { GateSaleCreateInput, GateSalePatchInput } from "@/server/validation/door";
import { enrollDoorMemberships, refreshDeposit, type DoorEnrollment } from "./doorRecordService";

/**
 * Feature 082 (research R5, FR-024/FR-026): one named sale, written on its own as soon as it is recorded.
 *
 * The gate's Save used to REPLACE every sale on the evening, which is how a sale the door recorded while
 * Mary had the page open could be wiped. Named sales now arrive one at a time, from the door or the gate,
 * and the Save owns only the anonymous totals.
 */

/** A sale as the pages see it — dollars, the payer's name, and who recorded it (FR-029). */
export type GateSaleView = {
  id: string;
  category: GateSaleRow["category"];
  paymentMethod: GateSaleRow["paymentMethod"];
  amount: number;
  contactId: string | null;
  contactName: string | null;
  membershipLevel: GateSaleRow["membershipLevel"];
  note: string | null;
  quantity: number | null;
  checkId: string | null;
  recordedBy: { contactId: string; displayName: string } | null;
};

const recorder = alias(contacts, "recorder");

/** Read sales with their payer and recorder names, for one door record or one sale. */
export async function saleViews(
  db: DbOrTx,
  where: { doorRecordId: string } | { saleId: string },
): Promise<GateSaleView[]> {
  const rows = await db
    .select({
      sale: gateSales,
      contactName: contacts.displayName,
      recorderName: recorder.displayName,
    })
    .from(gateSales)
    .leftJoin(contacts, eq(contacts.id, gateSales.contactId))
    .leftJoin(recorder, eq(recorder.id, gateSales.recordedByContactId))
    .where(
      "saleId" in where
        ? eq(gateSales.id, where.saleId)
        : eq(gateSales.doorRecordId, where.doorRecordId),
    );
  return rows.map(({ sale, contactName, recorderName }) => ({
    id: sale.id,
    category: sale.category,
    paymentMethod: sale.paymentMethod,
    amount: centsToDollars(sale.amountCents),
    contactId: sale.contactId,
    contactName: contactName ?? null,
    membershipLevel: sale.membershipLevel,
    note: sale.note,
    quantity: sale.quantity,
    checkId: sale.checkId,
    recordedBy:
      sale.recordedByContactId && recorderName
        ? { contactId: sale.recordedByContactId, displayName: recorderName }
        : null,
  }));
}

async function saleView(db: DbOrTx, saleId: string): Promise<GateSaleView> {
  const [view] = await saleViews(db, { saleId });
  if (!view) throw errors.validation("That sale no longer exists.");
  return view;
}

/** The event a door record belongs to, as a scope target. */
export async function doorRecordScope(
  db: DbOrTx,
  doorRecordId: string,
): Promise<{ eventId: string; scope: EventScope }> {
  const dr = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, doorRecordId) });
  if (!dr) throw errors.doorRecordNotFound();
  const event = await db.query.events.findFirst({ where: eq(events.id, dr.eventId) });
  if (!event) throw errors.eventNotFound();
  return { eventId: event.id, scope: { seriesId: event.seriesId, groupId: event.groupId } };
}

/**
 * Research R6: who may RECORD a sale or a check — the door (`attendance.write`) or whoever may record
 * gate money (`gate.write`), in the event's scope. An actor-less call (a service, a test) skips it.
 */
export function assertMayRecord(actor: Actor | undefined, scope: EventScope): void {
  assertEventScopeAny(actor, ["attendance.write", "gate.write"], scope);
}

/**
 * Research R6: who may CORRECT or REMOVE an entry. The door may correct what it recorded itself; anyone
 * else's belongs to whoever may record gate money. `recordedBy` is what makes "your own" answerable —
 * an entry with no recorder (recorded before this feature) belongs to the gate.
 */
export function assertMayCorrect(
  actor: Actor | undefined,
  scope: EventScope,
  recordedBy: string | null,
): void {
  if (!actor) return;
  assertMayRecord(actor, scope);
  if (recordedBy !== null && recordedBy === actor.staff.contactId) return;
  const target = { seriesId: scope.seriesId, groupId: scope.groupId };
  if (!actorCan(actor, "gate.write", target)) throw errors.notYourEntry();
}

export async function createGateSale(
  db: Db,
  doorRecordId: string,
  input: GateSaleCreateInput,
  actor?: Actor,
): Promise<{ sale: GateSaleView; enrolled: DoorEnrollment[] }> {
  const { eventId, scope } = await doorRecordScope(db, doorRecordId);
  assertMayRecord(actor, scope);
  // FR-020: admission in cash and by card is derived from the takings; only a check states it. The
  // schema lets it through so that THIS refusal, with its own code, is what the caller sees.
  if (input.category === "admission") throw errors.admissionNeedsCheck();

  const actorId = actor?.staff.contactId ?? null;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(gateSales)
      .values({
        doorRecordId,
        category: input.category,
        paymentMethod: input.paymentMethod,
        amountCents: dollarsToCents(input.amount),
        contactId: input.contactId ?? null,
        membershipLevel: input.membershipLevel ?? null,
        note: blankToNull(input.note),
        quantity: input.quantity ?? null,
        recordedByContactId: actorId,
      })
      .returning();
    if (!row) throw new Error("gate sale insert returned no row");

    const enrolled = await enrollDoorMemberships(tx, eventId, [row], actorId, [
      input.memberContactIds,
    ]);
    await recordAudit(tx, {
      kind: "gate_sale.created",
      actorContactId: actorId,
      details: {
        saleId: row.id,
        doorRecordId,
        category: row.category,
        amountCents: row.amountCents,
      },
    });
    return { sale: await saleView(tx, row.id), enrolled };
  });
}

export async function patchGateSale(
  db: Db,
  saleId: string,
  input: GateSalePatchInput,
  actor?: Actor,
): Promise<{ sale: GateSaleView; enrolled: DoorEnrollment[] }> {
  const existing = await db.query.gateSales.findFirst({ where: eq(gateSales.id, saleId) });
  if (!existing) throw errors.validation("That sale no longer exists.");
  const { eventId, scope } = await doorRecordScope(db, existing.doorRecordId);
  assertMayCorrect(actor, scope, existing.recordedByContactId);

  const next = {
    paymentMethod: input.paymentMethod ?? existing.paymentMethod,
    contactId: input.contactId === undefined ? existing.contactId : input.contactId,
    membershipLevel:
      input.membershipLevel === undefined ? existing.membershipLevel : input.membershipLevel,
    quantity: input.quantity === undefined ? existing.quantity : input.quantity,
  };
  assertSaleShape(existing.category, existing.checkId, next);

  const actorId = actor?.staff.contactId ?? existing.recordedByContactId;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(gateSales)
      .set({
        ...next,
        ...(input.amount !== undefined ? { amountCents: dollarsToCents(input.amount) } : {}),
        ...(input.note !== undefined ? { note: blankToNull(input.note) } : {}),
        // Research R7: whoever last corrected an entry is who recorded it.
        recordedByContactId: actorId,
      })
      .where(eq(gateSales.id, saleId))
      .returning();
    if (!row) throw errors.validation("That sale no longer exists.");

    const enrolled = await enrollDoorMemberships(tx, eventId, [row], actorId, [
      input.memberContactIds,
    ]);
    // A check's line moves the deposit; an ordinary sale leaves it as it was.
    if (row.checkId) await refreshDeposit(tx, eventId);
    await recordAudit(tx, {
      kind: "gate_sale.updated",
      actorContactId: actor?.staff.contactId ?? null,
      details: { saleId, fields: Object.keys(input) },
    });
    return { sale: await saleView(tx, row.id), enrolled };
  });
}

export async function deleteGateSale(db: Db, saleId: string, actor?: Actor): Promise<void> {
  const existing = await db.query.gateSales.findFirst({ where: eq(gateSales.id, saleId) });
  if (!existing) throw errors.validation("That sale no longer exists.");
  const { eventId, scope } = await doorRecordScope(db, existing.doorRecordId);
  assertMayCorrect(actor, scope, existing.recordedByContactId);

  await db.transaction(async (tx) => {
    await tx.delete(gateSales).where(eq(gateSales.id, saleId));
    // contracts/gate.md: removing a check's last line removes the check — a check with no lines has no
    // amount and says nothing about what it paid for (FR-017).
    if (existing.checkId) {
      const left = await tx
        .select({ id: gateSales.id })
        .from(gateSales)
        .where(eq(gateSales.checkId, existing.checkId));
      if (left.length === 0) await tx.delete(gateChecks).where(eq(gateChecks.id, existing.checkId));
      await refreshDeposit(tx, eventId);
    }
    await recordAudit(tx, {
      kind: "gate_sale.deleted",
      actorContactId: actor?.staff.contactId ?? null,
      details: {
        saleId,
        doorRecordId: existing.doorRecordId,
        category: existing.category,
        amountCents: existing.amountCents,
        checkId: existing.checkId,
      },
    });
  });
}

const NAMED = new Set(["donation", "future_event", "membership"]);

/**
 * The rules a patch must still satisfy once merged onto the row. The database refuses the same things
 * (migration 0053), but this answers first, and in words.
 */
function assertSaleShape(
  category: GateSaleRow["category"],
  checkId: string | null,
  next: {
    paymentMethod: GateSaleRow["paymentMethod"];
    contactId: string | null;
    membershipLevel: GateSaleRow["membershipLevel"];
  },
): void {
  if (NAMED.has(category) && !next.contactId) {
    throw errors.validation("donation, future_event, and membership lines require a contactId");
  }
  if (category === "membership" && !next.membershipLevel) {
    throw errors.validation("membership lines require a membershipLevel");
  }
  if (category !== "membership" && next.membershipLevel) {
    throw errors.validation("membershipLevel applies only to membership lines");
  }
  if ((checkId !== null) !== (next.paymentMethod === "check")) {
    throw errors.validation("A check's lines are paid by check, and only a check's lines are.");
  }
}

function blankToNull(note: string | null | undefined): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
}

/** Feature 082 (contracts/gate.md): a check received, with its lines. Its amount is their sum (FR-017). */
export type GateCheckView = {
  id: string;
  writerContactId: string;
  writer: string;
  amount: number;
  note: string | null;
  depositSeparately: boolean;
  recordedBy: { contactId: string; displayName: string } | null;
  lines: GateSaleView[];
};

/** Every check of a door record, oldest first, each with its lines. */
export async function checkViews(db: DbOrTx, doorRecordId: string): Promise<GateCheckView[]> {
  const writer = alias(contacts, "writer");
  const checks = await db
    .select({
      check: gateChecks,
      writerName: writer.displayName,
      recorderName: recorder.displayName,
    })
    .from(gateChecks)
    .leftJoin(writer, eq(writer.id, gateChecks.writerContactId))
    .leftJoin(recorder, eq(recorder.id, gateChecks.recordedByContactId))
    .where(eq(gateChecks.doorRecordId, doorRecordId))
    .orderBy(asc(gateChecks.createdAt));
  const lines = (await saleViews(db, { doorRecordId })).filter((l) => l.checkId !== null);

  return checks.map(({ check, writerName, recorderName }) => {
    const own = lines.filter((l) => l.checkId === check.id);
    return {
      id: check.id,
      writerContactId: check.writerContactId,
      writer: writerName ?? "Unknown",
      amount: centsToDollars(own.reduce((a, l) => a + dollarsToCents(l.amount), 0)),
      note: check.note,
      depositSeparately: check.depositSeparately,
      recordedBy:
        check.recordedByContactId && recorderName
          ? { contactId: check.recordedByContactId, displayName: recorderName }
          : null,
      lines: own,
    };
  });
}
