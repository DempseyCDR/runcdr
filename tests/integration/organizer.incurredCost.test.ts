import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makePerformer } from "./helpers/factories";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { createPerformerPayment } from "@/server/domain/payments/performerPaymentService";
import { assembleOrganizerReport } from "@/server/domain/organizer/reportService";

// Feature 023 US5 (FR-009): organizer performer cost is a single figure by PERFORMANCE (incurred) date —
// actual settled for a paid booking, else the booking's expected pay. A delayed check's cost lands on the
// event the booking was performed at, never on the event the check was written at.
describe("organizer report — incurred-date performer cost (023)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  const year = new Date().getUTCFullYear();

  it("charges the performance event with actual (paid) + expected (unpaid), and none to the writing event", async () => {
    const eventA = await makeEvent({ seriesKey: "tnc", eventDate: `${year}-03-07` }); // performed here
    const eventB = await makeEvent({ seriesKey: "tnc", eventDate: `${year}-03-14` }); // the check written here
    const pam = await makePerformer("Paid Pam");
    const uma = await makePerformer("Unpaid Uma");
    const bPaid = await createBooking(
      db,
      eventA.id,
      { performerId: pam.id, performerType: "musician", pay: 100 },
      "t",
    );
    await createBooking(
      db,
      eventA.id,
      { performerId: uma.id, performerType: "musician", pay: 80 },
      "t",
    );
    // A delayed check recorded at B settles A's paid booking for $90 (a discrepancy vs the booked $100).
    await createPerformerPayment(db, {
      method: "cash",
      eventId: eventB.id,
      payeePerformerId: pam.id,
      lines: [{ bookingId: bPaid.id, amount: 90 }],
    });

    const report = await assembleOrganizerReport(db, "tnc", year);
    const rows = report.perDanceRows as { eventId: string; performerTotal: number }[];
    const rowA = rows.find((r) => r.eventId === eventA.id)!;
    const rowB = rows.find((r) => r.eventId === eventB.id)!;

    // A: actual 90 (paid, the discrepancy amount) + expected 80 (still-outstanding) = 170, combined.
    expect(rowA.performerTotal).toBe(170);
    // B has no bookings of its own → the delayed check's cost did NOT land here.
    expect(rowB.performerTotal).toBe(0);
  });
});
