import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makeDoorRecord } from "./helpers/factories";
import { assembleTreasurerReport } from "@/server/domain/treasurer/reportService";

/**
 * Feature 085 (FR-001, SC-001): the report answers with the parts the page shows, and nothing else.
 * This is the guard that keeps a second description of the evening from creeping back in — a part nobody
 * displays is a part that can quietly disagree with the one that is displayed.
 */
describe("the treasurer report's shape", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  const SHOWN = [
    "attendance",
    "card",
    "deposits",
    "eveningNote",
    "expenses",
    "header",
    "paidElsewhere",
    "paidTonightForEarlier",
    "receipts",
    "recordedBy",
  ];

  it("carries the ten parts the page shows and no other", async () => {
    const evt = await makeEvent();
    await makeDoorRecord(evt.id);
    const report = await assembleTreasurerReport(db, evt.id);

    expect(Object.keys(report).sort()).toEqual(SHOWN);
  });

  it("answers the booked-versus-paid question inside the expenses", async () => {
    const evt = await makeEvent();
    await makeDoorRecord(evt.id);
    const report = await assembleTreasurerReport(db, evt.id);

    expect(Object.keys(report.expenses).sort()).toEqual([
      "otherPaidOut",
      "payments",
      "reconciliation",
      "rent",
      "totals",
    ]);
  });
});
