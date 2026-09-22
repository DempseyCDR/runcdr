import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makeDoorRecord } from "./helpers/factories";
import { GET as REPORT } from "@/app/api/events/[id]/treasurer-report/route";

// FR-004 — a TNC and a Community Dance on the same date are two evenings, and each reports its own money.
// (Feature 085: this used to assert both carried the QuickBooks customer "Contra Gate". The customer went
// with the mapping; the rule that survives is that the two reports do not bleed into each other.)
describe("same-evening events", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function report(eventId: string) {
    const res = await REPORT(
      jsonReq("GET", `/api/events/${eventId}/treasurer-report`),
      ctx({ id: eventId }),
    );
    return await res.json();
  }

  it("reports two evenings on one date separately, each with its own receipts", async () => {
    const tnc = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const cd = await makeEvent({ seriesKey: "community_dance", eventDate: "2026-06-18" });
    await makeDoorRecord(tnc.id, [{ category: "merchandise", paymentMethod: "cash", amount: 20 }]);
    await makeDoorRecord(cd.id, [{ category: "donation", paymentMethod: "cash", amount: 5 }]);

    const tncReport = await report(tnc.id);
    const cdReport = await report(cd.id);

    // Same date, two headings.
    expect(tncReport.header.date).toBe("2026-06-18");
    expect(cdReport.header.date).toBe("2026-06-18");
    expect(tncReport.header.title).not.toBe(cdReport.header.title);

    // Each evening's sale appears on its own report and nowhere else.
    expect(tncReport.receipts.lines.map((l: { category: string }) => l.category)).toEqual([
      "merchandise",
    ]);
    expect(cdReport.receipts.lines.map((l: { category: string }) => l.category)).toEqual([
      "donation",
    ]);
  });
});
