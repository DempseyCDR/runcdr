import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makeDoorRecord, contactRow } from "./helpers/factories";
import { contacts, doorRecords, gateChecks, gateSales } from "@/server/db/schema";
import { eventDeposits } from "@/server/domain/door/deposits";
import { refreshDeposit, updateDoorRecord } from "@/server/domain/door/doorRecordService";

// Feature 082 (research R4): an evening's deposits are DERIVED, never stored as rows. The main deposit is
// the cash plus the checks not marked; each marked check is banked on its own (FR-022). Nothing chooses
// which check goes in which deposit beyond the mark, so rows would only repeat what the mark already says.

async function writer(name: string): Promise<string> {
  const [row] = await db.insert(contacts).values(contactRow(name)).returning();
  return row!.id;
}

async function recordCheck(
  doorRecordId: string,
  writerContactId: string,
  amount: number,
  depositSeparately = false,
): Promise<string> {
  const [check] = await db
    .insert(gateChecks)
    .values({ doorRecordId, writerContactId, depositSeparately })
    .returning();
  await db.insert(gateSales).values({
    doorRecordId,
    category: "donation",
    paymentMethod: "check",
    amountCents: amount * 100,
    checkId: check!.id,
    contactId: writerContactId,
  });
  return check!.id;
}

/** An evening with $500 counted, a $15 float and $20 paid out, its stored deposit up to date. */
async function evening(): Promise<{ eventId: string; doorRecordId: string }> {
  const event = await makeEvent();
  const doorRecordId = await makeDoorRecord(event.id);
  await db
    .update(doorRecords)
    .set({
      grossCashCents: 50000,
      seedFloatCents: 1500,
      cashPaidOutCents: 2000,
      cashPaidOutReason: "ice",
    })
    .where(eq(doorRecords.id, doorRecordId));
  await refreshDeposit(db, event.id);
  return { eventId: event.id, doorRecordId };
}

describe("the evening's deposits", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lists one main deposit when there are no checks", async () => {
    const { eventId } = await evening();
    const deposits = await eventDeposits(db, eventId);

    expect(deposits).toHaveLength(1);
    expect(deposits[0]!.kind).toBe("main");
    expect(deposits[0]!.amountCents).toBe(50000 - 1500 - 2000);
    expect(deposits[0]!.makeUp).toMatchObject({
      countedCashCents: 50000,
      seedFloatCents: 1500,
      otherPaidOutCents: 2000,
      performerCashCents: 0,
      checksCents: 0,
    });
  });

  it("adds the checks that are not marked to the main deposit", async () => {
    const { eventId, doorRecordId } = await evening();
    const chuck = await writer("Chuck Writer");
    await recordCheck(doorRecordId, chuck, 95);
    await recordCheck(doorRecordId, chuck, 40);
    await refreshDeposit(db, eventId);

    const deposits = await eventDeposits(db, eventId);
    expect(deposits).toHaveLength(1);
    expect(deposits[0]!.amountCents).toBe(50000 - 1500 - 2000 + 13500);
    expect(deposits[0]!.makeUp.checksCents).toBe(13500);
  });

  it("banks a marked check on its own, with its writer (FR-022)", async () => {
    const { eventId, doorRecordId } = await evening();
    const chuck = await writer("Chuck Writer");
    const big = await writer("Big Donor");
    await recordCheck(doorRecordId, chuck, 95);
    const separate = await recordCheck(doorRecordId, big, 500, true);
    await refreshDeposit(db, eventId);

    const deposits = await eventDeposits(db, eventId);
    expect(deposits).toHaveLength(2);

    const main = deposits.find((d) => d.kind === "main")!;
    expect(main.amountCents).toBe(50000 - 1500 - 2000 + 9500);
    expect(main.makeUp.checksCents).toBe(9500);

    const own = deposits.find((d) => d.kind === "check")!;
    expect(own.checkId).toBe(separate);
    expect(own.writer).toBe("Big Donor");
    expect(own.amountCents).toBe(50000);
  });

  it("still lists both when the marked check is the only money besides cash", async () => {
    const { eventId, doorRecordId } = await evening();
    const big = await writer("Big Donor");
    await recordCheck(doorRecordId, big, 500, true);
    await refreshDeposit(db, eventId);

    const deposits = await eventDeposits(db, eventId);
    expect(deposits.map((d) => d.kind)).toEqual(["main", "check"]);
    expect(deposits[0]!.makeUp.checksCents).toBe(0);
  });

  it("keeps a marked check out of the main deposit however large it is", async () => {
    const { eventId, doorRecordId } = await evening();
    const big = await writer("Big Donor");
    await recordCheck(doorRecordId, big, 500, true);
    await refreshDeposit(db, eventId);

    const deposits = await eventDeposits(db, eventId);
    const main = deposits.find((d) => d.kind === "main")!;
    expect(main.amountCents).toBe(50000 - 1500 - 2000);
    expect(main.makeUp.checksCents).toBe(0);
    expect(main.makeUp.performerCashCents).toBe(0); // no performers paid in cash this evening
  });

  it("keeps the stored main deposit in step with the checks (research R4)", async () => {
    const { eventId, doorRecordId } = await evening();
    const chuck = await writer("Chuck Writer");
    await recordCheck(doorRecordId, chuck, 95);
    await refreshDeposit(db, eventId);

    const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, doorRecordId) });
    expect(row!.depositCents).toBe(50000 - 1500 - 2000 + 9500);

    const deposits = await eventDeposits(db, eventId);
    expect(deposits[0]!.amountCents).toBe(row!.depositCents);
  });

  it("keeps the checks in the stored deposit when the money is saved again", async () => {
    // Saving the evening's money recomputes the deposit; it must not recompute it from the cash alone.
    const { eventId, doorRecordId } = await evening();
    const chuck = await writer("Chuck Writer");
    await recordCheck(doorRecordId, chuck, 95);
    await refreshDeposit(db, eventId);

    await updateDoorRecord(db, doorRecordId, { grossCash: 510 });

    const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, doorRecordId) });
    expect(row!.depositCents).toBe(51000 - 1500 - 2000 + 9500);
  });

  it("returns nothing for an event with no door record", async () => {
    const event = await makeEvent();
    expect(await eventDeposits(db, event.id)).toEqual([]);
  });
});
