import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makePerformer } from "./helpers/factories";
import { createBooking, substitutePerformer } from "@/server/domain/bookings/bookingService";
import { createPerformerPayment } from "@/server/domain/payments/performerPaymentService";
import { getPerformer } from "@/server/domain/performers/performerService";

// Feature 024 US4 (FR-007 / SC-005): the person who actually played always has their own booking, so they
// appear in the performer appearance record — a paid substitute and a guest sit-in alike.
describe("everyone who plays gets a booking", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a paid substitute has their own booking; the no-show is retained separately", async () => {
    const evt = await makeEvent();
    const booked = await makePerformer("Booked Bo");
    const sub = await makePerformer("Sub Sue");
    const b = await createBooking(db, evt.id, {
      performerId: booked.id,
      performerType: "musician",
      pay: 125,
    });
    await createPerformerPayment(db, {
      method: "check",
      eventId: evt.id,
      payeePerformerId: booked.id,
      checkNumber: "3001",
      lines: [{ bookingId: b.id, amount: 125 }],
    });

    const result = await substitutePerformer(db, b.id, sub.id);
    expect(result.noShow?.performerId).toBe(booked.id);
    expect(result.booking.performerId).toBe(sub.id);

    // The substitute appears in the record (their own booking).
    const subDetail = await getPerformer(db, sub.id);
    expect(subDetail.appearanceCount).toBe(1);
  });

  it("a guest sit-in with an intact band has their own booking (nobody dropped)", async () => {
    const evt = await makeEvent();
    const guest = await makePerformer("Guest Gus");
    await createBooking(db, evt.id, {
      performerId: guest.id,
      performerType: "musician",
      pay: 125,
    });

    const guestDetail = await getPerformer(db, guest.id);
    expect(guestDetail.appearanceCount).toBe(1);
  });
});
