import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makePerformer } from "./helpers/factories";
import { bookings, performerPayments } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { createPerformerPayment } from "@/server/domain/payments/performerPaymentService";
import { POST as CREATE } from "@/app/api/performer-payments/route";

/** Feature 081 (FR-006–FR-008, FR-031, FR-032): a payment is a numbered check or cash. */
describe("payment method (081)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function setup(performerType: "musician" | "instructor" = "musician", pay?: number) {
    const event = await makeEvent();
    const performer = await makePerformer("Pat Fiddle");
    const booking = await createBooking(db, event.id, {
      performerId: performer.id,
      performerType,
      ...(pay !== undefined ? { pay } : {}),
    });
    return { event, performer, booking };
  }

  const post = (body: Record<string, unknown>) =>
    CREATE(jsonReq("POST", "/api/performer-payments", body), ctx());

  it("records a check with its number at the amount the page sends", async () => {
    const { event, performer, booking } = await setup("musician", 120);
    const res = await post({
      eventId: event.id,
      payeePerformerId: performer.id,
      method: "check",
      checkNumber: "1450",
      lines: [{ bookingId: booking.id, amount: 120 }],
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ method: "check", checkNumber: "1450", amount: 120 });
  });

  it("refuses a check with no number and cash with one", async () => {
    const { event, performer, booking } = await setup("musician", 120);
    const lines = [{ bookingId: booking.id, amount: 120 }];
    const common = { eventId: event.id, payeePerformerId: performer.id, lines };
    expect((await post({ ...common, method: "check" })).status).toBe(422);
    expect((await post({ ...common, method: "cash", checkNumber: "1450" })).status).toBe(422);
  });

  it("records cash with no number and no note", async () => {
    const { event, performer, booking } = await setup("musician", 120);
    const res = await post({
      eventId: event.id,
      payeePerformerId: performer.id,
      method: "cash",
      lines: [{ bookingId: booking.id, amount: 120 }],
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      method: "cash",
      checkNumber: null,
      overrideReason: null,
    });
  });

  it("refuses cash settling two bookings, at the route and in the service", async () => {
    const { event, performer, booking } = await setup("musician", 120);
    const other = await createBooking(db, event.id, {
      performerId: (await makePerformer("Sam Second")).id,
      performerType: "musician",
      pay: 80,
    });
    const lines = [
      { bookingId: booking.id, amount: 120 },
      { bookingId: other.id, amount: 80 },
    ];
    const res = await post({
      eventId: event.id,
      payeePerformerId: performer.id,
      method: "cash",
      lines,
    });
    expect(res.status).toBe(422);

    await expect(
      createPerformerPayment(db, {
        eventId: event.id,
        payeePerformerId: performer.id,
        method: "cash",
        lines,
      }),
    ).rejects.toMatchObject({ code: "CASH_SINGLE_BOOKING" });
    expect(await db.select().from(performerPayments)).toHaveLength(0);
  });

  it("pays a free booking without changing what it was booked at (FR-007)", async () => {
    const { event, performer, booking } = await setup("instructor");
    expect(booking.payCents).toBe(0);
    const res = await post({
      eventId: event.id,
      payeePerformerId: performer.id,
      method: "cash",
      lines: [{ bookingId: booking.id, amount: 25 }],
    });
    expect(res.status).toBe(201);
    const [after] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(after!.payCents).toBe(0);
  });

  it("keeps an override note only when one is written (FR-008)", async () => {
    const { event, performer, booking } = await setup("musician", 120);
    const withNote = await createPerformerPayment(db, {
      eventId: event.id,
      payeePerformerId: performer.id,
      method: "check",
      checkNumber: "1451",
      overrideReason: "left early",
      lines: [{ bookingId: booking.id, amount: 110 }],
    });
    expect(withNote.overrideReason).toBe("left early");

    const second = await setup("musician", 120);
    const without = await createPerformerPayment(db, {
      eventId: second.event.id,
      payeePerformerId: second.performer.id,
      method: "check",
      checkNumber: "1452",
      lines: [{ bookingId: second.booking.id, amount: 110 }],
    });
    expect(without.overrideReason).toBeNull();
  });
});
