import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makeDoorRecord, makePerformer } from "./helpers/factories";
import { updateDoorRecord } from "@/server/domain/door/doorRecordService";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { recordAttendance } from "@/server/domain/attendance/attendanceService";
import { assembleOrganizerReport } from "@/server/domain/organizer/reportService";

const year = 2026;

// A tnc event with `attendees` people through the door — one of them the booked caller, checked in (feature
// 079: a performer is subtracted only when checked in) — and a door record whose admission = `admissionDollars`
// (grossCash with seed float 0, no non-admission sales). Baseline paying dancers = attendees − 1 performer − 1
// door attendant.
async function buildEvent(attendees: number, admissionDollars: number): Promise<string> {
  const evt = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
  const caller = await makePerformer("Cal Caller");
  await createBooking(db, evt.id, { performerId: caller.id, performerType: "caller", pay: 100 });
  await recordAttendance(db, evt.id, { contactId: caller.contactId! });
  for (let i = 1; i < attendees; i++) await recordAttendance(db, evt.id, { unmatched: true });
  const drId = await makeDoorRecord(evt.id);
  await updateDoorRecord(db, drId, { grossCash: admissionDollars, seedFloat: 0 });
  return drId;
}

async function reportRow(): Promise<{ dancers: number; avgTicket: number }> {
  const report = await assembleOrganizerReport(db, "tnc", year);
  return report.perDanceRows[0] as { dancers: number; avgTicket: number };
}

describe("door comp count → paying dancers (feature 014)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("recording comps drops paying dancers and raises Avg Ticket (US1, FR-003/FR-004, SC-001)", async () => {
    const drId = await buildEvent(20, 360); // baseline dancers = 20 − 1 − 1 = 18; avgTicket = 360/18 = $20
    const before = await reportRow();
    expect(before.dancers).toBe(18);
    expect(before.avgTicket).toBe(20);

    await updateDoorRecord(db, drId, { compCount: 3 });

    const after = await reportRow();
    expect(after.dancers).toBe(15); // 3 fewer paying dancers
    expect(after.avgTicket).toBe(24); // 360 / 15 = $24 (rose)
  });

  it("gift-card redeemers stay paying — a redemption with no comps does not reduce dancers (US2, FR-005, SC-002)", async () => {
    const drId = await buildEvent(20, 360);
    await updateDoorRecord(db, drId, { giftCardRedemptionCount: 2 }); // comps untouched (stay 0)

    const row = await reportRow();
    expect(row.dancers).toBe(18); // unchanged by the gift-card redemption
    expect(row.avgTicket).toBe(20);
  });

  it("comp count of 0 is a no-op — figures equal the pre-feature baseline (US2, FR-006/FR-007, SC-003)", async () => {
    await buildEvent(20, 360); // never touch comps → defaults to 0
    const row = await reportRow();
    expect(row.dancers).toBe(18);
    expect(row.avgTicket).toBe(20);
  });

  it("paying dancers never go negative — comps exceeding the remainder floor at 0 (SC-004)", async () => {
    const drId = await buildEvent(20, 360);
    await updateDoorRecord(db, drId, { compCount: 50 }); // 20 − 1 − 1 − 50 < 0

    const row = await reportRow();
    expect(row.dancers).toBe(0);
    expect(row.avgTicket).toBe(0); // no paying dancers → no avg ticket
  });
});
