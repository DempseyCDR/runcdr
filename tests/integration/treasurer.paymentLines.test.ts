import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makeDoorRecord, makePerformer } from "./helpers/factories";
import { createBooking } from "@/server/domain/bookings/bookingService";
import {
  createPerformerPayment,
  voidPerformerPayment,
} from "@/server/domain/payments/performerPaymentService";
import { assembleTreasurerReport } from "@/server/domain/treasurer/reportService";
import { updateDoorRecord } from "@/server/domain/door/doorRecordService";
import type { PerformerType } from "@/server/db/schema";

// Feature 023 US4: the per-event treasurer report lists every payment with its per-line detail, and marks a
// voided check (feature 085: in the one expenses list, where the page shows it — and out of the totals).
afterAll(closeDb);

describe("treasurer report — payment lines + voided distinct (023)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);

  it("emits a per-line breakdown for live checks and lists voided checks separately", async () => {
    const evt = await makeEvent();
    await makeDoorRecord(evt.id);
    const larry = await makePerformer("Live Larry");
    const vic = await makePerformer("Void Vic");
    const bL = await createBooking(
      db,
      evt.id,
      { performerId: larry.id, performerType: "musician", pay: 100 },
      "t",
    );
    const bV = await createBooking(
      db,
      evt.id,
      { performerId: vic.id, performerType: "musician", pay: 100 },
      "t",
    );
    await createPerformerPayment(db, {
      method: "check",
      eventId: evt.id,
      payeePerformerId: larry.id,
      checkNumber: "1001",
      lines: [{ bookingId: bL.id, amount: 100 }],
    });
    const voided = await createPerformerPayment(db, {
      method: "check",
      eventId: evt.id,
      payeePerformerId: vic.id,
      checkNumber: "1002",
      lines: [{ bookingId: bV.id, amount: 100 }],
    });
    await voidPerformerPayment(db, voided.id, "no-show");

    const report = await assembleTreasurerReport(db, evt.id);

    // Feature 085: both checks are in the one expenses list, in check-number order.
    expect(report.expenses.payments).toHaveLength(2);
    const [live, dead] = report.expenses.payments;

    // Live check, with the payee and role its own booking gives it.
    expect(live).toMatchObject({
      checkNumber: "1001",
      payee: "Live Larry",
      role: "musician",
      amount: 100,
      cash: false,
      voided: false,
    });

    // The voided check is still listed — marked, with its reason.
    expect(dead).toMatchObject({ checkNumber: "1002", payee: "Void Vic", voided: true });
    expect(dead!.notes).toContain("Void — no-show");

    // …and out of the totals: $100 live, not $200 (the rule the separate voided list used to prove).
    expect(report.expenses.totals).toEqual({ check: 100, cash: 0, total: 100 });
  });
});

/**
 * Feature 081 (FR-027, FR-028, FR-038, research R15): every check in one list by number — voids with their
 * reason and replacement — booked against paid where they differ, cash under cash paid out, and payments made
 * at another event named on both reports.
 */
describe("treasurer report — checks, cash and other events (081)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);

  it("lists every check by number, cash apart, and where each booking was paid", async () => {
    const earlier = await makeEvent({ eventDate: "2026-06-04" });
    const tonight = await makeEvent({ eventDate: "2026-06-18" });
    await makeDoorRecord(earlier.id);
    const doorId = await makeDoorRecord(tonight.id);
    await updateDoorRecord(db, doorId, { cashPaidOut: 20, cashPaidOutReason: "ice" });

    const mk = async (eventId: string, name: string, performerType: PerformerType, pay: number) => {
      const performer = await makePerformer(name);
      const booking = await createBooking(db, eventId, {
        performerId: performer.id,
        performerType,
        pay,
      });
      return { performer, booking };
    };
    const a = await mk(tonight.id, "Ann Caller", "caller", 120);
    const b = await mk(tonight.id, "Ben Fiddle", "musician", 100);
    const c = await mk(tonight.id, "Cy Sound", "sound_tech", 60);
    const d = await mk(earlier.id, "Dee Earlier", "musician", 80);

    const pay = (
      p: { performer: { id: string }; booking: { id: string } },
      amount: number,
      extra: { checkNumber?: string; overrideReason?: string },
    ) =>
      createPerformerPayment(db, {
        eventId: tonight.id,
        payeePerformerId: p.performer.id,
        method: extra.checkNumber ? "check" : "cash",
        ...extra,
        lines: [{ bookingId: p.booking.id, amount }],
      });

    await pay(a, 100, { checkNumber: "1501", overrideReason: "left early" });
    const wrong = await pay(b, 100, { checkNumber: "1500" });
    await voidPerformerPayment(db, wrong.id, "wrong amount");
    await pay(b, 100, { checkNumber: "1500A" });
    await pay(c, 60, { checkNumber: "1499" });
    await pay(d, 80, {});

    const report = await assembleTreasurerReport(db, tonight.id);

    // Feature 085: one expenses list — every check by number, then the cash.
    const payments = report.expenses.payments;
    expect(payments.map((k) => k.checkNumber)).toEqual(["1499", "1500", "1500A", "1501", null]);
    expect(payments[4]).toMatchObject({ payee: "Dee Earlier", cash: true, amount: 80 });

    // The void carries its reason and its replacement in its notes.
    expect(payments[1]).toMatchObject({ payee: "Ben Fiddle", voided: true });
    expect(payments[1]!.notes).toEqual(["Void — wrong amount", "replaced by check 1500A"]);

    // A short payment says what was booked against what was paid, beside the treasurer's own note.
    expect(payments[3]).toMatchObject({
      payee: "Ann Caller",
      role: "caller",
      amount: 100,
      voided: false,
    });
    expect(payments[3]!.notes).toEqual(["booked $120.00 · paid $100.00", "left early"]);

    // Live only, and the gate's cash payout counted with the cash.
    expect(report.expenses.totals).toEqual({ check: 260, cash: 100, total: 360 });
    expect(report.expenses.otherPaidOut).toEqual({ amount: 20, reason: "ice" });

    // Tonight settles an earlier evening's booking, and both evenings say so.
    expect(report.paidTonightForEarlier).toEqual([
      { performer: "Dee Earlier", amount: 80, eventDate: "2026-06-04" },
    ]);
    expect(report.paidElsewhere).toEqual([]);

    const before = await assembleTreasurerReport(db, earlier.id);
    expect(before.paidElsewhere).toEqual([
      { performer: "Dee Earlier", amount: 80, eventDate: "2026-06-18" },
    ]);
    expect(before.expenses.payments).toEqual([]);
  });
});
