import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent } from "./helpers/factories";
import { createDoorRecord, getDoorRecord } from "@/server/domain/door/doorRecordService";
import { createGateSale } from "@/server/domain/door/gateSaleService";

// Feature 031 (P5-R4) US3: the anonymous-sales comment persists on the gate-sale line (gate_sales.note) and
// round-trips through getDoorRecord.
describe("gate-sales note round-trip (031 US3)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("an anonymous sale keeps its note on an anonymous line; getDoorRecord returns it", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    const dr = await createDoorRecord(db, evt.id, "test");

    await createGateSale(db, dr.id, {
      category: "merchandise",
      paymentMethod: "cash",
      amount: 12,
      note: "3 CDs, 2 shirts",
    });

    const { gateSales } = await getDoorRecord(db, dr.id);
    const merch = gateSales.find((s) => s.category === "merchandise");
    expect(merch?.note).toBe("3 CDs, 2 shirts");
  });

  it("named lines carry no note by default", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    const dr = await createDoorRecord(db, evt.id, "test");
    await createGateSale(db, dr.id, { category: "misc_sales", paymentMethod: "card", amount: 5 });
    const { gateSales } = await getDoorRecord(db, dr.id);
    expect(gateSales[0]?.note ?? null).toBeNull();
  });
});
