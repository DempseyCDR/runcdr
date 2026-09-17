import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, jsonReqAs, ctx } from "./helpers/http";
import { makeBaseActor, makeEvent, makePerformer } from "./helpers/factories";
import { paymentBookings } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import {
  createPerformerPayment,
  voidPerformerPayment,
} from "@/server/domain/payments/performerPaymentService";
import { POST as ADD_LINE } from "@/app/api/performer-payments/[id]/lines/route";

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

const addLine = (paymentId: string, body: unknown, token?: string) => {
  const path = `/api/performer-payments/${paymentId}/lines`;
  return ADD_LINE(
    token ? jsonReqAs(token, "POST", path, body) : jsonReq("POST", path, body),
    ctx({ id: paymentId }),
  );
};

/** Feature 081 (FR-013, research R4, analysis I1): "Add this booking to check #N". */
describe("POST /api/performer-payments/{id}/lines (081)", () => {
  async function tonightWithCheck() {
    const event = await makeEvent({ eventDate: "2026-06-18" });
    const a = await booked(event.id, "Ann Able");
    const payment = await createPerformerPayment(db, {
      eventId: event.id,
      payeePerformerId: a.performer.id,
      method: "check",
      checkNumber: "9001",
      lines: [{ bookingId: a.booking.id, amount: 100 }],
    });
    return { event, a, payment };
  }

  it("adds a booking to the check, and its amount to the total", async () => {
    const { event, payment } = await tonightWithCheck();
    const b = await booked(event.id, "Bea Bow", 120);
    const res = await addLine(payment.id, {
      eventId: event.id,
      bookingId: b.booking.id,
      amount: 120,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.amount).toBe(220);
    expect(body.lines.map((l: { bookingId: string }) => l.bookingId)).toContain(b.booking.id);
  });

  it("accepts an earlier event's booking onto tonight's check", async () => {
    const { event, payment } = await tonightWithCheck();
    const earlier = await makeEvent({ eventDate: "2026-06-04" });
    const e = await booked(earlier.id, "Eli Early");
    const res = await addLine(payment.id, {
      eventId: event.id,
      bookingId: e.booking.id,
      amount: 100,
    });
    expect(res.status).toBe(200);
  });

  it("refuses when the check was recorded at another event than the one being paid from", async () => {
    const { payment } = await tonightWithCheck();
    const later = await makeEvent({ eventDate: "2026-06-25" });
    const l = await booked(later.id, "Lou Later");
    const res = await addLine(payment.id, {
      eventId: later.id,
      bookingId: l.booking.id,
      amount: 100,
    });
    expect(res.status).toBe(422);
  });

  it("refuses a voided check, cash, and a booking already paid", async () => {
    const { event, a, payment } = await tonightWithCheck();
    const b = await booked(event.id, "Bea Bow");
    const c = await booked(event.id, "Cy Cello");

    // a booking already paid (by this check)
    let res = await addLine(payment.id, { eventId: event.id, bookingId: a.booking.id, amount: 5 });
    expect((await res.json()).error.code).toBe("BOOKING_ALREADY_PAID");

    const cash = await createPerformerPayment(db, {
      eventId: event.id,
      payeePerformerId: b.performer.id,
      method: "cash",
      lines: [{ bookingId: b.booking.id, amount: 100 }],
    });
    res = await addLine(cash.id, { eventId: event.id, bookingId: c.booking.id, amount: 100 });
    expect((await res.json()).error.code).toBe("CASH_SINGLE_BOOKING");

    await voidPerformerPayment(db, payment.id, "lost");
    res = await addLine(payment.id, { eventId: event.id, bookingId: c.booking.id, amount: 100 });
    expect((await res.json()).error.code).toBe("ALREADY_VOIDED");
    const lines = await db
      .select()
      .from(paymentBookings)
      .where(eq(paymentBookings.bookingId, c.booking.id));
    expect(lines).toHaveLength(0);
  });

  it("requires payment authority", async () => {
    const { event, payment } = await tonightWithCheck();
    const b = await booked(event.id, "Bea Bow");
    const base = await makeBaseActor("base@example.com");
    const res = await addLine(
      payment.id,
      { eventId: event.id, bookingId: b.booking.id, amount: 100 },
      base.token,
    );
    expect(res.status).toBe(403);
  });
});
