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

// Feature 023 US4: the per-event treasurer report lists live checks with their per-line breakdown, and voided
// checks distinctly (so the treasurer records the void into QBO too).
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

    // Live check with its per-line allocation.
    expect(report.performerPayments).toHaveLength(1);
    const live = report.performerPayments[0]!;
    expect(live.checkNumber).toBe("1001");
    expect(live.lines).toHaveLength(1);
    expect(live.lines[0]!.performer).toBe("Live Larry");
    expect(live.lines[0]!.amount).toBe(100);

    // Voided check, distinct.
    expect(report.voidedPerformerPayments).toHaveLength(1);
    const voided2 = report.voidedPerformerPayments[0]!;
    expect(voided2.checkNumber).toBe("1002");
    expect(voided2.voidReason).toBe("no-show");
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
    expect(report.checks.map((k) => k.checkNumber)).toEqual(["1499", "1500", "1500A", "1501"]);
    expect(report.checks[1]).toMatchObject({
      payee: "Ben Fiddle",
      voided: true,
      voidReason: "wrong amount",
      replacedBy: "1500A",
    });
    expect(report.checks[3]).toMatchObject({
      payee: "Ann Caller",
      amount: 100,
      class: "TNC",
      voided: false,
      voidReason: null,
      replacedBy: null,
      note: "left early",
      lines: [{ performer: "Ann Caller", booked: 120, paid: 100, eventDate: null }],
    });
    expect(report.cashPayments).toEqual([
      {
        payee: "Dee Earlier",
        amount: 80,
        note: null,
        lines: [{ performer: "Dee Earlier", booked: 80, paid: 80, eventDate: "2026-06-04" }],
      },
    ]);
    expect(report.otherCashPaidOut).toEqual({ amount: 20, reason: "ice" });
    expect(report.paidElsewhere).toEqual([]);
    // The QBO batch the report always had is unchanged: live checks only.
    expect(report.performerPayments.map((p) => p.checkNumber).sort()).toEqual([
      "1499",
      "1500A",
      "1501",
      null,
    ]);

    const before = await assembleTreasurerReport(db, earlier.id);
    expect(before.paidElsewhere).toEqual([
      { performer: "Dee Earlier", amount: 80, eventDate: "2026-06-18" },
    ]);
    expect(before.checks).toEqual([]);
  });
});
