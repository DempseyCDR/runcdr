import { eq, getTableColumns, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/server/db/client";
import { contacts, doorRecordAudit, doorRecords, events, gateSales } from "@/server/db/schema";
import type { DoorRecordRow, GateSaleRow } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { assertEventScope } from "@/server/auth/can";
import type { Actor } from "@/server/auth/actor";
import { writeAudit } from "@/server/lib/audit";
import { dollarsToCents, centsToDollars } from "@/server/lib/money";
import { recordDuesPayment } from "@/server/domain/membership/accountService";
import { resolveParameterCentsOrNull } from "@/server/domain/parameters/seriesParameterService";
import { depositCents, posFeeCents } from "./calc";
import type { DoorRecordPatchInput, GateSalesPutInput } from "@/server/validation/door";

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
};

function toView(row: DoorRecordRow): DoorRecordView {
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

  const cashPaidOutCents =
    input.cashPaidOut !== undefined ? dollarsToCents(input.cashPaidOut) : current.cashPaidOutCents;
  const cashPaidOutReason =
    input.cashPaidOutReason !== undefined ? input.cashPaidOutReason : current.cashPaidOutReason;
  if (cashPaidOutCents > 0 && !cashPaidOutReason) throw errors.cashPayoutReasonRequired();

  const grossCashCents =
    input.grossCash !== undefined ? dollarsToCents(input.grossCash) : current.grossCashCents;
  const pcGrossCents =
    input.pcGross !== undefined ? dollarsToCents(input.pcGross) : current.pcGrossCents;
  const seedFloatCents =
    input.seedFloat !== undefined ? dollarsToCents(input.seedFloat) : current.seedFloatCents;
  const posTransactionCount = input.posTransactionCount ?? current.posTransactionCount;

  // Fee from card txns + PC gross; deposit = gross cash − seed float − cash paid out.
  const fee = posFeeCents(posTransactionCount, pcGrossCents);
  const deposit = depositCents(grossCashCents, seedFloatCents, cashPaidOutCents);

  const [row] = await db
    .update(doorRecords)
    .set({
      posTransactionCount,
      grossCashCents,
      pcGrossCents,
      seedFloatCents,
      cashPaidOutCents,
      cashPaidOutReason,
      posFeeCents: fee,
      depositCents: deposit,
      giftCardRedemptionCount: input.giftCardRedemptionCount ?? current.giftCardRedemptionCount,
      compCount: input.compCount ?? current.compCount,
      updatedAt: new Date(),
    })
    .where(eq(doorRecords.id, id))
    .returning();
  if (!row) throw errors.doorRecordNotFound();

  await db.insert(doorRecordAudit).values({
    doorRecordId: id,
    action: "updated",
    actor,
    details: { fields: Object.keys(input) },
  });
  writeAudit({
    kind: "door_record.updated",
    actor,
    details: { doorRecordId: id, posFeeCents: row.posFeeCents, depositCents: row.depositCents },
  });
  return toView(row);
}

export async function putGateSales(
  db: Db,
  doorRecordId: string,
  input: GateSalesPutInput,
  authz?: Actor,
): Promise<{ sales: GateSaleRow[]; enrolled: DoorEnrollment[] }> {
  const dr = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, doorRecordId) });
  if (!dr) throw errors.doorRecordNotFound();
  await assertGateScope(db, authz, dr.eventId); // FR-020

  const actorId = authz?.staff.contactId ?? null;
  return db.transaction(async (tx) => {
    await tx.delete(gateSales).where(eq(gateSales.doorRecordId, doorRecordId));
    if (input.sales.length === 0) return { sales: [], enrolled: [] };
    const inserted = await tx
      .insert(gateSales)
      .values(
        input.sales.map((s) => ({
          doorRecordId,
          category: s.category,
          paymentMethod: s.paymentMethod,
          amountCents: dollarsToCents(s.amount),
          contactId: s.contactId ?? null,
          note: s.note ?? null, // feature 031: the anonymous-sales comment
          membershipLevel: s.membershipLevel ?? null, // feature 068 (FR-005): what was bought (null on named lines)
        })),
      )
      .returning();
    // Feature 019 US1 (B31): named membership lines create/renew memberships, in THIS transaction.
    const enrolled = await enrollDoorMemberships(tx, dr.eventId, inserted, actorId);
    return { sales: inserted, enrolled };
  });
}

/** A membership created/renewed by a door gate save — surfaced to the FS so they see it worked (T012). */
export type DoorEnrollment = { contactId: string; displayName: string; expiryDate: string };

/**
 * Feature 019 (FR-001..FR-004): for each NAMED `membership` gate line just written, create or renew the
 * contact's membership — inside the gate-sale transaction, so it is all-or-nothing (FR-001).
 *
 * Idempotency across the replace-all save (R5): the guard is (contact, target boundary), NOT the gate-sale
 * id — because `putGateSales` deletes and re-inserts gate-sale rows on every save, so their ids are not
 * stable. A contact who already holds a membership reaching the target boundary is skipped (renewal no-op,
 * FR-004); a later payment past that boundary genuinely renews. `source_gate_sale_id` is recorded as
 * provenance and backs a secondary unique index. Anonymous lines (no contactId) record money only (FR-002).
 */
async function enrollDoorMemberships(
  tx: DbOrTx,
  eventId: string,
  sales: GateSaleRow[],
  actorId: string | null,
): Promise<DoorEnrollment[]> {
  const named = sales.filter((s) => s.category === "membership" && s.contactId);
  if (named.length === 0) return [];

  const event = await tx.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();
  const enrolled: DoorEnrollment[] = [];
  for (const sale of named) {
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

/** A gate sale plus the payer's display name (null for anonymous lines) — for redisplay on the gate form. */
export type GateSaleView = GateSaleRow & { contactName: string | null };

export async function getDoorRecord(
  db: Db,
  id: string,
): Promise<{ doorRecord: DoorRecordView; gateSales: GateSaleView[] }> {
  const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, id) });
  if (!row) throw errors.doorRecordNotFound();
  // D2: join the contact so a NAMED sale (donation/future_event/membership) can be re-shown with its payer's
  // name when the gate form reloads — the raw row carries only contact_id.
  const sales = await db
    .select({ ...getTableColumns(gateSales), contactName: contacts.displayName })
    .from(gateSales)
    .leftJoin(contacts, eq(contacts.id, gateSales.contactId))
    .where(eq(gateSales.doorRecordId, id));
  return { doorRecord: toView(row), gateSales: sales };
}
