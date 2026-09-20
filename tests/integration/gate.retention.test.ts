import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makeDoorRecord, contactRow } from "./helpers/factories";
import { attendance, contacts, doorRecords, gateChecks, gateSales } from "@/server/db/schema";
import { purgeOldAttendance } from "@/server/domain/attendance/retentionService";

// Feature 082 (FR-038, research R15): gate records are KEPT. The Treasurer goes back to an evening's
// report — usually within two years — to correct the books, so the money, the sales, the checks and their
// notes must still be there. The 90-day purge (079) deletes check-ins only. This pins that it stays so.

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

describe("the purge leaves gate records alone", () => {
  it("keeps an old evening's door record, sales and checks after the purge runs", async () => {
    const event = await makeEvent({ eventDate: "2024-06-18" });
    const [dee] = await db.insert(contacts).values(contactRow("Dee Member")).returning();
    const doorRecordId = await makeDoorRecord(event.id, [
      { category: "merchandise", paymentMethod: "cash", amount: 25 },
      { category: "donation", paymentMethod: "card", amount: 40, contactId: dee!.id },
    ]);
    await db
      .update(doorRecords)
      .set({ eveningNote: "the ice ran out" })
      .where(eq(doorRecords.id, doorRecordId));
    const [check] = await db
      .insert(gateChecks)
      .values({ doorRecordId, writerContactId: dee!.id, note: "covers Jo too" })
      .returning();
    await db.insert(gateSales).values({
      doorRecordId,
      category: "admission",
      paymentMethod: "check",
      amountCents: 3000,
      checkId: check!.id,
      quantity: 2,
    });

    // An old check-in — the purge's actual target — so the run has something to do.
    await db.insert(attendance).values({ eventId: event.id, contactId: dee!.id });
    await db.execute(sql`UPDATE attendance SET created_at = now() - interval '400 days'`);

    const { purged } = await purgeOldAttendance(db);
    expect(purged).toBe(1);

    const dr = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, doorRecordId) });
    expect(dr!.eveningNote).toBe("the ice ran out");
    expect(
      await db.select().from(gateSales).where(eq(gateSales.doorRecordId, doorRecordId)),
    ).toHaveLength(3);
    const checks = await db.select().from(gateChecks).where(eq(gateChecks.id, check!.id));
    expect(checks[0]!.note).toBe("covers Jo too");
  });
});
