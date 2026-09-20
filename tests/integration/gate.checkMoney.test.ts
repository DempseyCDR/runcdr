import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makeDoorRecord, contactRow } from "./helpers/factories";
import { contacts, doorRecords, gateChecks, gateSales } from "@/server/db/schema";
import { computeEventGate } from "@/server/domain/gate/eventMoney";
import { eq } from "drizzle-orm";

// Feature 082 (research R3): admission gains a THIRD source — admission a check paid for. The two derived
// figures keep their meaning, so the organizer report's takings and average ticket follow without change.
//
// Checks are recorded here as rows rather than through the routes, which arrive at T043: this file is
// about what the money DERIVATION does with them.

async function writer(name: string): Promise<string> {
  const [row] = await db.insert(contacts).values(contactRow(name)).returning();
  return row!.id;
}

async function recordCheck(
  doorRecordId: string,
  writerContactId: string,
  lines: {
    category: "admission" | "merchandise" | "donation";
    amount: number;
    quantity?: number;
  }[],
  depositSeparately = false,
): Promise<string> {
  const [check] = await db
    .insert(gateChecks)
    .values({ doorRecordId, writerContactId, depositSeparately })
    .returning();
  await db.insert(gateSales).values(
    lines.map((l) => ({
      doorRecordId,
      category: l.category,
      paymentMethod: "check" as const,
      amountCents: l.amount * 100,
      checkId: check!.id,
      quantity: l.quantity ?? null,
    })),
  );
  return check!.id;
}

describe("gate money with checks received", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("leaves the counted cash and the cash/card admission alone (FR-019)", async () => {
    const event = await makeEvent();
    const doorRecordId = await makeDoorRecord(event.id, [
      { category: "merchandise", paymentMethod: "cash", amount: 25 },
    ]);
    await db
      .update(doorRecords)
      .set({ grossCashCents: 50000, seedFloatCents: 1500, pcGrossCents: 18000 })
      .where(eq(doorRecords.id, doorRecordId));

    const before = await computeEventGate(db, event.id);

    const chuck = await writer("Chuck Writer");
    await recordCheck(doorRecordId, chuck, [
      { category: "admission", amount: 30, quantity: 2 },
      { category: "merchandise", amount: 25 },
      { category: "donation", amount: 40 },
    ]);

    const after = await computeEventGate(db, event.id);
    // Gross cash is bills and coins; a check never joins it, so neither derived figure moves.
    expect(after.admissionCashCents).toBe(before.admissionCashCents);
    expect(after.admissionCardCents).toBe(before.admissionCardCents);
  });

  it("counts a check's admission line as admission by check", async () => {
    const event = await makeEvent();
    const doorRecordId = await makeDoorRecord(event.id);
    const chuck = await writer("Chuck Writer");
    await recordCheck(doorRecordId, chuck, [
      { category: "admission", amount: 30, quantity: 2 },
      { category: "merchandise", amount: 25 },
    ]);

    const gate = await computeEventGate(db, event.id);
    expect(gate.admissionCheckCents).toBe(3000);
  });

  it("makes admission the three sources added (FR-020)", async () => {
    const event = await makeEvent();
    const doorRecordId = await makeDoorRecord(event.id, [
      { category: "merchandise", paymentMethod: "cash", amount: 25 },
      { category: "misc_sales", paymentMethod: "card", amount: 40 },
    ]);
    await db
      .update(doorRecords)
      .set({ grossCashCents: 50000, seedFloatCents: 1500, pcGrossCents: 18000 })
      .where(eq(doorRecords.id, doorRecordId));

    const chuck = await writer("Chuck Writer");
    await recordCheck(doorRecordId, chuck, [{ category: "admission", amount: 30, quantity: 2 }]);

    const gate = await computeEventGate(db, event.id);
    expect(gate.admissionCashCents).toBe(50000 - 1500 - 2500);
    expect(gate.admissionCardCents).toBe(18000 - 4000);
    expect(gate.admissionCheckCents).toBe(3000);
    expect(gate.admissionCents).toBe(
      gate.admissionCashCents + gate.admissionCardCents + gate.admissionCheckCents,
    );
  });

  it("totals every check's lines, whatever they pay for", async () => {
    const event = await makeEvent();
    const doorRecordId = await makeDoorRecord(event.id);
    const chuck = await writer("Chuck Writer");
    const dee = await writer("Dee Member");
    await recordCheck(doorRecordId, chuck, [
      { category: "admission", amount: 30, quantity: 2 },
      { category: "merchandise", amount: 25 },
      { category: "donation", amount: 40 },
    ]);
    await recordCheck(doorRecordId, dee, [{ category: "donation", amount: 500 }], true);

    const gate = await computeEventGate(db, event.id);
    expect(gate.checksCents).toBe(9500 + 50000);
  });

  it("keeps a check's non-admission lines out of the cash and card sales", async () => {
    const event = await makeEvent();
    const doorRecordId = await makeDoorRecord(event.id);
    await db
      .update(doorRecords)
      .set({ grossCashCents: 50000, seedFloatCents: 1500 })
      .where(eq(doorRecords.id, doorRecordId));
    const chuck = await writer("Chuck Writer");
    await recordCheck(doorRecordId, chuck, [{ category: "merchandise", amount: 25 }]);

    const gate = await computeEventGate(db, event.id);
    // The T-shirt was paid by check, so it must not be taken off the CASH takings.
    expect(gate.admissionCashCents).toBe(50000 - 1500);
    // It is still merchandise sold, whatever paid for it.
    expect(gate.merchandiseCents).toBe(2500);
  });

  it("reports zero checks for an evening with none", async () => {
    const event = await makeEvent();
    await makeDoorRecord(event.id);
    const gate = await computeEventGate(db, event.id);
    expect(gate.checksCents).toBe(0);
    expect(gate.admissionCheckCents).toBe(0);
  });
});
