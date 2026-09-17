import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makePerformer } from "./helpers/factories";
import { createBooking } from "@/server/domain/bookings/bookingService";
import {
  createPerformerPayment,
  voidPerformerPayment,
} from "@/server/domain/payments/performerPaymentService";
import { deleteEvent } from "@/server/domain/events/eventService";

// Feature 023 (analyze H1 / FR-013): the event-delete guardrail is widened for cross-event settlement. An
// event whose booking is settled by a LIVE check recorded at ANOTHER event must not be deletable, or the
// paid line would be silently orphaned and the check's line-sum total broken.
describe("event delete guardrail — cross-event payment (023, H1)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("refuses to delete an event whose booking is settled by a live cross-event check", async () => {
    const eventA = await makeEvent(); // performed here
    const eventB = await makeEvent({ eventDate: "2026-07-02" }); // the check is written here
    const p = await makePerformer("P");
    const bA = await createBooking(
      db,
      eventA.id,
      { performerId: p.id, performerType: "musician", pay: 100 },
      "t",
    );
    // A delayed check recorded at B that settles A's booking.
    await createPerformerPayment(db, {
      method: "check",
      checkNumber: "1001",
      eventId: eventB.id,
      payeePerformerId: p.id,
      lines: [{ bookingId: bA.id, amount: 100 }],
    });

    await expect(deleteEvent(db, eventA.id)).rejects.toThrow();
  });

  it("does not block an event whose only cross-event settlement is VOIDED", async () => {
    const eventA = await makeEvent();
    const eventB = await makeEvent({ eventDate: "2026-07-02" });
    const p = await makePerformer("P");
    const bA = await createBooking(
      db,
      eventA.id,
      { performerId: p.id, performerType: "musician", pay: 100 },
      "t",
    );
    const pay = await createPerformerPayment(db, {
      method: "check",
      checkNumber: "1002",
      eventId: eventB.id,
      payeePerformerId: p.id,
      lines: [{ bookingId: bA.id, amount: 100 }],
    });
    await voidPerformerPayment(db, pay.id, "no-show");

    // Voided → no live settlement on A's bookings → this guard does not block.
    await expect(deleteEvent(db, eventA.id)).resolves.toBeUndefined();
  });
});
