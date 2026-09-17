import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReqAs, ctx } from "./helpers/http";
import { makeBaseActor, makeEvent, makePerformer } from "./helpers/factories";
import { bookings } from "@/server/db/schema";
import type { PerformerType } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import {
  createPerformerPayment,
  voidPerformerPayment,
} from "@/server/domain/payments/performerPaymentService";
import { getPaymentSummary, type PaymentSummary } from "@/server/domain/payments/paymentSummary";
import { GET as SUMMARY } from "@/app/api/events/[id]/payment-summary/route";

/** Feature 081 (FR-004, SC-006, research R10): what is booked, paid and still to pay at an event. */
describe("payment summary (081)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  let n = 1000;
  const nextNumber = () => String(++n);

  async function book(eventId: string, name: string, type: PerformerType, pay?: number) {
    const performer = await makePerformer(name);
    const booking = await createBooking(db, eventId, {
      performerId: performer.id,
      performerType: type,
      ...(pay !== undefined ? { pay } : {}),
    });
    return { performer, booking };
  }

  async function pay(
    eventId: string,
    b: Awaited<ReturnType<typeof book>>,
    amount: number,
    method: "check" | "cash" = "check",
  ) {
    return createPerformerPayment(db, {
      eventId,
      payeePerformerId: b.performer.id,
      method,
      ...(method === "check" ? { checkNumber: nextNumber() } : {}),
      lines: [{ bookingId: b.booking.id, amount }],
    });
  }

  /** SC-006: the summary always adds up. */
  const addsUp = (s: PaymentSummary) =>
    expect(Math.round((s.paid + s.stillToPay - s.difference) * 100)).toBe(
      Math.round(s.booked * 100),
    );

  async function evening() {
    const event = await makeEvent();
    const caller = await book(event.id, "Cal Caller", "caller", 120);
    const m1 = await book(event.id, "Abe Musician", "musician", 100);
    const m2 = await book(event.id, "Bea Musician", "musician", 100);
    const instructor = await book(event.id, "Ivy Instructor", "instructor");
    return { event, caller, m1, m2, instructor };
  }

  it("starts with everything booked still to pay, free bookings not counted", async () => {
    const { event } = await evening();
    const s = await getPaymentSummary(db, event.id);
    expect(s).toMatchObject({
      booked: 320,
      paid: 0,
      stillToPay: 320,
      stillToPayCount: 3,
      difference: 0,
      earlierPaidHere: 0,
      performerCash: [],
    });
    addsUp(s);
  });

  it("follows payments, differences and free bookings paid", async () => {
    const { event, caller, m1, instructor } = await evening();
    await pay(event.id, caller, 120);
    await pay(event.id, m1, 90);
    let s = await getPaymentSummary(db, event.id);
    expect(s).toMatchObject({ paid: 210, stillToPay: 100, stillToPayCount: 1, difference: -10 });
    addsUp(s);

    const cash = await pay(event.id, instructor, 25, "cash");
    s = await getPaymentSummary(db, event.id);
    expect(s).toMatchObject({ paid: 235, stillToPayCount: 1, difference: 15 });
    expect(s.performerCash).toEqual([{ paymentId: cash.id, payee: "Ivy Instructor", amount: 25 }]);
    addsUp(s);
  });

  it("does not count a voided payment", async () => {
    const { event, caller } = await evening();
    const check = await pay(event.id, caller, 120);
    await voidPerformerPayment(db, check.id, "wrong amount");
    const s = await getPaymentSummary(db, event.id);
    expect(s).toMatchObject({ paid: 0, stillToPayCount: 3 });
    addsUp(s);
  });

  it("leaves out a declined booking never paid, and counts a declined one that was paid", async () => {
    const { event, m1, m2 } = await evening();
    await db.update(bookings).set({ status: "declined" }).where(eq(bookings.id, m1.booking.id));
    let s = await getPaymentSummary(db, event.id);
    expect(s).toMatchObject({ booked: 220, stillToPayCount: 2 });
    addsUp(s);

    await pay(event.id, m2, 100);
    await db.update(bookings).set({ status: "declined" }).where(eq(bookings.id, m2.booking.id));
    s = await getPaymentSummary(db, event.id);
    expect(s).toMatchObject({ booked: 220, paid: 100, stillToPayCount: 1 });
    addsUp(s);
  });

  it("neither books nor owes a donated fee", async () => {
    const event = await makeEvent();
    const performer = await makePerformer("Dee Donor");
    await createBooking(db, event.id, {
      performerId: performer.id,
      performerType: "caller",
      isDonated: true,
    });
    const s = await getPaymentSummary(db, event.id);
    expect(s).toMatchObject({ booked: 0, stillToPay: 0, stillToPayCount: 0 });
  });

  it("is readable by any signed-in volunteer, and 404s for an unknown event", async () => {
    const { event } = await evening();
    const base = await makeBaseActor("base@example.com");
    const res = await SUMMARY(
      jsonReqAs(base.token, "GET", `/api/events/${event.id}/payment-summary`),
      ctx({ id: event.id }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(await getPaymentSummary(db, event.id));

    const missing = "00000000-0000-0000-0000-000000000000";
    const res404 = await SUMMARY(
      jsonReqAs(base.token, "GET", `/api/events/${missing}/payment-summary`),
      ctx({ id: missing }),
    );
    expect(res404.status).toBe(404);
  });
});
