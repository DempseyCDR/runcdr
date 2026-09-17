import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makePerformer } from "./helpers/factories";
import { performerPayments } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import {
  createPerformerPayment,
  patchPerformerPayment,
  voidPerformerPayment,
} from "@/server/domain/payments/performerPaymentService";
import { POST as CREATE } from "@/app/api/performer-payments/route";

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

async function booked(eventId: string, name: string, pay = 100) {
  const performer = await makePerformer(name);
  const booking = await createBooking(db, eventId, {
    performerId: performer.id,
    performerType: "musician",
    pay,
  });
  return { performer, booking };
}

const check = (
  eventId: string,
  payeeId: string,
  bookingId: string,
  checkNumber: string,
  extra: { confirmSecondPayment?: boolean } = {},
) =>
  createPerformerPayment(db, {
    eventId,
    payeePerformerId: payeeId,
    method: "check",
    checkNumber,
    lines: [{ bookingId, amount: 100 }],
    ...extra,
  });

/** Feature 081 (FR-011, SC-002, research R2): a booking is settled by at most one live payment. */
describe("one live payment per booking (081)", () => {
  it("refuses a second payment for a paid booking, naming the payment, until it is voided", async () => {
    const event = await makeEvent();
    const { performer, booking } = await booked(event.id, "Pat Fiddle");
    const first = await check(event.id, performer.id, booking.id, "9001");

    await expect(
      check(event.id, performer.id, booking.id, "9002", { confirmSecondPayment: true }),
    ).rejects.toMatchObject({
      code: "BOOKING_ALREADY_PAID",
      data: { details: { bookingId: booking.id, paymentId: first.id, checkNumber: "9001" } },
    });

    await voidPerformerPayment(db, first.id, "wrong amount");
    const again = await check(event.id, performer.id, booking.id, "9002", {
      confirmSecondPayment: true,
    });
    expect(again.voided).toBe(false);
  });

  it("lets only one of two simultaneous payments for a booking through", async () => {
    const event = await makeEvent();
    const { performer, booking } = await booked(event.id, "Pat Fiddle");
    const results = await Promise.allSettled([
      check(event.id, performer.id, booking.id, "9011", { confirmSecondPayment: true }),
      check(event.id, performer.id, booking.id, "9012", { confirmSecondPayment: true }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "BOOKING_ALREADY_PAID" });
  });
});

/** Feature 081 (FR-012, FR-013, FR-039, research R3): a check number identifies one check. */
describe("one check per number (081)", () => {
  it("refuses a number already used, saying whose and where", async () => {
    const tonight = await makeEvent({ eventDate: "2026-06-18" });
    const other = await makeEvent({ eventDate: "2026-06-04" });
    const a = await booked(tonight.id, "Ann Able");
    const b = await booked(tonight.id, "Bea Bow");
    const c = await booked(other.id, "Cy Cello");
    const held = await check(tonight.id, a.performer.id, a.booking.id, "9001A");

    await expect(check(tonight.id, b.performer.id, b.booking.id, "9001a")).rejects.toMatchObject({
      code: "CHECK_NUMBER_TAKEN",
      data: {
        details: {
          paymentId: held.id,
          eventId: tonight.id,
          eventDate: "2026-06-18",
          payee: "Ann Able",
          voided: false,
          sameEvent: true,
        },
      },
    });
    await expect(check(other.id, c.performer.id, c.booking.id, "9001A")).rejects.toMatchObject({
      code: "CHECK_NUMBER_TAKEN",
      data: { details: { sameEvent: false } },
    });

    await voidPerformerPayment(db, held.id, "lost");
    await expect(check(tonight.id, b.performer.id, b.booking.id, "9001A")).rejects.toMatchObject({
      code: "CHECK_NUMBER_TAKEN",
      data: { details: { voided: true } },
    });
  });

  it("counts an earlier booking paid on tonight's check as the same event", async () => {
    const tonight = await makeEvent({ eventDate: "2026-06-18" });
    const earlier = await makeEvent({ eventDate: "2026-06-04" });
    const a = await booked(tonight.id, "Ann Able");
    const e = await booked(earlier.id, "Eli Early");
    await check(tonight.id, a.performer.id, a.booking.id, "9005");
    await expect(check(tonight.id, e.performer.id, e.booking.id, "9005")).rejects.toMatchObject({
      data: { details: { sameEvent: true } },
    });
  });

  it("lets only one of two simultaneous checks with a number through", async () => {
    const event = await makeEvent();
    const a = await booked(event.id, "Ann Able");
    const b = await booked(event.id, "Bea Bow");
    const results = await Promise.allSettled([
      check(event.id, a.performer.id, a.booking.id, "9021"),
      check(event.id, b.performer.id, b.booking.id, "9021"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason,
    ).toMatchObject({ code: "CHECK_NUMBER_TAKEN" });
    expect(await db.select().from(performerPayments)).toHaveLength(1);
  });

  it("refuses a malformed number at the route", async () => {
    const event = await makeEvent();
    const a = await booked(event.id, "Ann Able");
    const res = await CREATE(
      jsonReq("POST", "/api/performer-payments", {
        eventId: event.id,
        payeePerformerId: a.performer.id,
        method: "check",
        checkNumber: "#9001",
        lines: [{ bookingId: a.booking.id, amount: 100 }],
      }),
      ctx(),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("INVALID_CHECK_NUMBER");
  });
});

/** Feature 081 (FR-014, research R5): a second payment to a performer at an event needs confirming. */
describe("a second payment to the same performer (081)", () => {
  it("asks before paying a performer who already has a live payment here, check or cash", async () => {
    const event = await makeEvent();
    const pat = await makePerformer("Pat Fiddle");
    const b1 = await createBooking(db, event.id, {
      performerId: pat.id,
      performerType: "musician",
      pay: 100,
    });
    const b2 = await createBooking(db, event.id, {
      performerId: pat.id,
      performerType: "sound_tech",
      pay: 60,
    });
    const first = await check(event.id, pat.id, b1.id, "9031");

    const cash = () =>
      createPerformerPayment(db, {
        eventId: event.id,
        payeePerformerId: pat.id,
        method: "cash",
        lines: [{ bookingId: b2.id, amount: 60 }],
      });
    await expect(cash()).rejects.toMatchObject({
      code: "SECOND_PAYMENT_TO_PAYEE",
      data: { details: { paymentId: first.id, checkNumber: "9031", method: "check", amount: 100 } },
    });

    const confirmed = await createPerformerPayment(db, {
      eventId: event.id,
      payeePerformerId: pat.id,
      method: "cash",
      confirmSecondPayment: true,
      lines: [{ bookingId: b2.id, amount: 60 }],
    });
    expect(confirmed.method).toBe("cash");
  });

  it("does not ask when the other payment is voided or at another event", async () => {
    const tonight = await makeEvent({ eventDate: "2026-06-18" });
    const other = await makeEvent({ eventDate: "2026-06-04" });
    const pat = await makePerformer("Pat Fiddle");
    const bOther = await createBooking(db, other.id, {
      performerId: pat.id,
      performerType: "musician",
      pay: 100,
    });
    const bTonight = await createBooking(db, tonight.id, {
      performerId: pat.id,
      performerType: "musician",
      pay: 100,
    });
    const bTonight2 = await createBooking(db, tonight.id, {
      performerId: pat.id,
      performerType: "sound_tech",
      pay: 50,
    });
    await check(other.id, pat.id, bOther.id, "9041");
    const voided = await check(tonight.id, pat.id, bTonight.id, "9042");
    await voidPerformerPayment(db, voided.id, "wrong");
    await expect(check(tonight.id, pat.id, bTonight2.id, "9043")).resolves.toBeTruthy();
  });

  it("asks when a check's payee is changed to a performer already paid here", async () => {
    const event = await makeEvent();
    const a = await booked(event.id, "Ann Able");
    const b = await booked(event.id, "Bea Bow");
    await check(event.id, a.performer.id, a.booking.id, "9051");
    const other = await check(event.id, b.performer.id, b.booking.id, "9052");

    await expect(
      patchPerformerPayment(db, other.id, { payeePerformerId: a.performer.id }),
    ).rejects.toMatchObject({ code: "SECOND_PAYMENT_TO_PAYEE" });
    const moved = await patchPerformerPayment(db, other.id, {
      payeePerformerId: a.performer.id,
      confirmSecondPayment: true,
    });
    expect(moved.payeePerformerId).toBe(a.performer.id);
  });
});
