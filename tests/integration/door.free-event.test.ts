import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, contactRow } from "./helpers/factories";
import { contacts, doorRecords, gateSales } from "@/server/db/schema";
import { POST as ATTEND } from "@/app/api/events/[id]/attendance/route";
import { POST as CREATE_DR } from "@/app/api/door-records/route";
import { POST as CREATE_SALE } from "@/app/api/door-records/[id]/sales/route";

// FR-010 — free events: attendance with no door record; donations create one.
describe("free events", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("records attendance for a free event with no door record", async () => {
    const evt = await makeEvent({ chargesAdmission: false });
    const res = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, { unmatched: true }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(201);
    const drs = await db.select().from(doorRecords).where(eq(doorRecords.eventId, evt.id));
    expect(drs).toHaveLength(0);
  });

  it("accepts a donation via a door record with no paid admission", async () => {
    const evt = await makeEvent({ chargesAdmission: false });
    const drRes = await CREATE_DR(jsonReq("POST", "/api/door-records", { eventId: evt.id }), ctx());
    const drId = (await drRes.json()).id as string;
    const [donor] = await db.insert(contacts).values(contactRow("Donor")).returning();
    // Feature 082 (research R5): a named sale is recorded on its own, not through the gate's Save.
    const res = await CREATE_SALE(
      jsonReq("POST", `/api/door-records/${drId}/sales`, {
        category: "donation",
        paymentMethod: "cash",
        amount: 40,
        contactId: donor!.id,
      }),
      ctx({ id: drId }),
    );
    expect(res.status).toBe(201);
    const sales = await db.select().from(gateSales).where(eq(gateSales.doorRecordId, drId));
    expect(sales).toHaveLength(1);
    expect(sales[0]?.category).toBe("donation");
    const admission = sales.filter((s) => s.category === "admission");
    expect(admission).toHaveLength(0);
  });
});
