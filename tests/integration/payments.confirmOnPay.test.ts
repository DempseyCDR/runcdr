import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makePerformer } from "./helpers/factories";
import { bookings, type BookingStatus } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import {
  addPaymentLine,
  createPerformerPayment,
  deletePerformerPayment,
  patchPerformerPayment,
  voidPerformerPayment,
} from "@/server/domain/payments/performerPaymentService";

// Feature 082 US5 (FR-039, FR-040, research R12, MARY-R22): someone who played and was paid has plainly
// confirmed. Paying a booking that is still proposed, requested or tentative sets it confirmed — on every
// path that records a payment — so the Booker's report and the evening's figures stop counting them as
// unsettled. A declined booking a check still settles (the no-show kept when someone substituted) stays
// declined, and a booking confirmed this way stays confirmed if its payment is later voided or deleted.

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

let checkNumber = 7000;
const nextCheck = () => String(checkNumber++);

async function booked(status: BookingStatus, eventId?: string, name = `Pat ${status}`) {
  const event = eventId ? { id: eventId } : await makeEvent();
  const performer = await makePerformer(name);
  const booking = await createBooking(
    db,
    event.id,
    { performerId: performer.id, performerType: "musician", pay: 100 },
    "t",
  );
  await db.update(bookings).set({ status }).where(eq(bookings.id, booking.id));
  return { eventId: event.id, performerId: performer.id, bookingId: booking.id };
}

async function statusOf(bookingId: string): Promise<BookingStatus> {
  const row = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
  return row!.status;
}

const payByCheck = (b: { eventId: string; performerId: string; bookingId: string }) =>
  createPerformerPayment(db, {
    method: "check",
    checkNumber: nextCheck(),
    eventId: b.eventId,
    payeePerformerId: b.performerId,
    lines: [{ bookingId: b.bookingId, amount: 100 }],
  });

describe("paying confirms the booking (FR-039)", () => {
  for (const status of ["proposed", "requested", "tentative"] as const) {
    it(`confirms a ${status} booking when it is paid`, async () => {
      const b = await booked(status);
      await payByCheck(b);
      expect(await statusOf(b.bookingId)).toBe("confirmed");
    });
  }

  it("confirms a booking paid in cash", async () => {
    const b = await booked("requested");
    await createPerformerPayment(db, {
      method: "cash",
      eventId: b.eventId,
      payeePerformerId: b.performerId,
      lines: [{ bookingId: b.bookingId, amount: 100 }],
    });
    expect(await statusOf(b.bookingId)).toBe("confirmed");
  });

  it("leaves a confirmed booking as it was", async () => {
    const b = await booked("confirmed");
    await payByCheck(b);
    expect(await statusOf(b.bookingId)).toBe("confirmed");
  });

  it("leaves a declined booking declined, though a check settles it (FR-040)", async () => {
    const b = await booked("declined");
    await payByCheck(b);
    expect(await statusOf(b.bookingId)).toBe("declined");
  });
});

describe("on every path that records a payment", () => {
  it("confirms every booking one check settles — the several-performers dialog", async () => {
    const first = await booked("requested", undefined, "Ann Band");
    const second = await booked("tentative", first.eventId, "Bo Band");
    await createPerformerPayment(db, {
      method: "check",
      checkNumber: nextCheck(),
      eventId: first.eventId,
      payeePerformerId: first.performerId,
      lines: [
        { bookingId: first.bookingId, amount: 100 },
        { bookingId: second.bookingId, amount: 100 },
      ],
    });
    expect(await statusOf(first.bookingId)).toBe("confirmed");
    expect(await statusOf(second.bookingId)).toBe("confirmed");
  });

  it("confirms an earlier evening's booking paid tonight", async () => {
    const earlier = await booked("requested");
    const tonight = await makeEvent({ eventDate: "2026-06-25" });
    await createPerformerPayment(db, {
      method: "check",
      checkNumber: nextCheck(),
      eventId: tonight.id,
      payeePerformerId: earlier.performerId,
      lines: [{ bookingId: earlier.bookingId, amount: 100 }],
    });
    expect(await statusOf(earlier.bookingId)).toBe("confirmed");
  });

  it("confirms a booking added as a line to a check already written", async () => {
    const first = await booked("confirmed", undefined, "Ann Band");
    const second = await booked("proposed", first.eventId, "Bo Band");
    const payment = await payByCheck(first);
    await addPaymentLine(db, payment.id, {
      eventId: first.eventId,
      bookingId: second.bookingId,
      amount: 100,
    });
    expect(await statusOf(second.bookingId)).toBe("confirmed");
  });

  it("confirms a booking a corrected check now settles", async () => {
    const first = await booked("confirmed", undefined, "Ann Band");
    const second = await booked("tentative", first.eventId, "Bo Band");
    const payment = await payByCheck(first);
    await patchPerformerPayment(db, payment.id, {
      lines: [
        { bookingId: first.bookingId, amount: 100 },
        { bookingId: second.bookingId, amount: 100 },
      ],
    });
    expect(await statusOf(second.bookingId)).toBe("confirmed");
  });
});

describe("a confirmation stays (FR-040)", () => {
  it("stays confirmed when the payment is voided", async () => {
    const b = await booked("requested");
    const payment = await payByCheck(b);
    await voidPerformerPayment(db, payment.id, "wrong amount");
    expect(await statusOf(b.bookingId)).toBe("confirmed");
  });

  it("stays confirmed when the payment is deleted", async () => {
    const b = await booked("requested");
    const payment = await payByCheck(b);
    await deletePerformerPayment(db, payment.id);
    expect(await statusOf(b.bookingId)).toBe("confirmed");
  });
});
