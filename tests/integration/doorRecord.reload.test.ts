import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makeContactWithEmail } from "./helpers/factories";
import {
  ensureDoorRecord,
  putGateSales,
  updateDoorRecord,
  getDoorRecord,
} from "@/server/domain/door/doorRecordService";

// D2 (gate data-loss fix): getDoorRecord must return everything the gate form needs to REDISPLAY a saved
// record — the money scalars (already there) and the gate-sale lines WITH the contact name for named sales,
// so re-opening the page can repopulate the form instead of showing blanks (which a re-save would then wipe).
describe("getDoorRecord — full reload payload", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("returns saved money fields and gate sales with contact names", async () => {
    const evt = await makeEvent();
    const { contactId } = await makeContactWithEmail({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@ex.com",
    });
    const dr = await ensureDoorRecord(db, evt.id, "t");

    await putGateSales(db, dr.id, {
      sales: [
        { category: "merchandise", paymentMethod: "cash", amount: 12 },
        {
          category: "membership",
          paymentMethod: "card",
          amount: 40,
          contactId,
          membershipLevel: "family",
        },
      ],
    });
    await updateDoorRecord(db, dr.id, { grossCash: 344, pcGross: 223, posTransactionCount: 16 });

    const view = await getDoorRecord(db, dr.id);

    // Money scalars round-trip (dollars).
    expect(view.doorRecord.grossCash).toBe(344);
    expect(view.doorRecord.pcGross).toBe(223);
    expect(view.doorRecord.posTransactionCount).toBe(16);

    // Both sale lines present; the named line carries the contact's display name for redisplay.
    expect(view.gateSales).toHaveLength(2);
    const membership = view.gateSales.find((s) => s.category === "membership")!;
    expect(membership.contactId).toBe(contactId);
    expect(membership.contactName).toBe("Jane Doe");
    // Feature 080 (FR-005): the level bought comes back, so the gate page can show it and re-send it.
    expect(membership.membershipLevel).toBe("family");
    const merch = view.gateSales.find((s) => s.category === "merchandise")!;
    expect(merch.contactName).toBeNull(); // anon line, no contact
  });
});
