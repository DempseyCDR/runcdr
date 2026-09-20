import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makeDoorRecord } from "./helpers/factories";
import { auditEvents, doorRecords } from "@/server/db/schema";
import { PATCH as PATCH_DR } from "@/app/api/door-records/[id]/route";

// Feature 082 (FR-012, research R8): the denomination counts while Mary is counting. Kept as she keys them,
// so closing the dialog or reloading the page does not lose a half-finished count, and dropped when the
// money is saved — the saved gross cash is the record.
//
// A count-only write is scratch work, not the evening's money: it names nobody as having recorded the
// money and writes no audit row, or every keypress would.

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

async function evening(): Promise<string> {
  const event = await makeEvent();
  return makeDoorRecord(event.id);
}

const patch = (id: string, body: unknown) =>
  PATCH_DR(jsonReq("PATCH", `/api/door-records/${id}`, body), ctx({ id }));

const COUNT = { "100": 2, "20": 4, "5": 6, coins: 4.35 };

describe("the cash count in progress", () => {
  it("is kept as Mary keys it, and returned", async () => {
    const id = await evening();
    const res = await patch(id, { cashCount: COUNT });
    expect(res.status).toBe(200);
    expect((await res.json()).cashCount).toEqual(COUNT);

    const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, id) });
    expect(row!.cashCount).toEqual(COUNT);
  });

  it("is scratch work — it names no one as recording the money and writes no audit row", async () => {
    const id = await evening();
    await patch(id, { cashCount: COUNT });
    await patch(id, { cashCount: { ...COUNT, "1": 3 } });

    const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, id) });
    expect(row!.moneyRecordedByContactId).toBeNull();
    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.kind, "door_record.updated"));
    expect(audits).toHaveLength(0);
  });

  it("leaves the money alone", async () => {
    const id = await evening();
    await patch(id, { grossCash: 500, seedFloat: 15 });
    await patch(id, { cashCount: COUNT });
    const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, id) });
    expect(row!.grossCashCents).toBe(50000);
    expect(row!.seedFloatCents).toBe(1500);
  });

  it("is dropped when the money is saved (FR-012)", async () => {
    const id = await evening();
    await patch(id, { cashCount: COUNT });
    const res = await patch(id, { grossCash: 314.35 });
    expect((await res.json()).cashCount).toEqual({});
    const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, id) });
    expect(row!.cashCount).toEqual({});
    expect(row!.grossCashCents).toBe(31435);
  });

  it("is kept when the save itself sets it", async () => {
    const id = await evening();
    const res = await patch(id, { grossCash: 314.35, cashCount: COUNT });
    expect((await res.json()).cashCount).toEqual(COUNT);
  });
});
