import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makePerformer } from "./helpers/factories";
import { createBooking } from "@/server/domain/bookings/bookingService";
import {
  createPerformerPayment,
  voidPerformerPayment,
  patchPerformerPayment,
  settledCentsByBookingForEvent,
} from "@/server/domain/payments/performerPaymentService";

// Feature 023 US3: a voided check persists (the treasurer records the void), settles nothing, and a reissue
// links back to it; a voided check is not editable.
describe("performer payment voids (023)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("voids a check (persists, settles nothing), links a reissue, and refuses to edit a voided check", async () => {
    const evt = await makeEvent();
    const p = await makePerformer("Pat");
    const b = await createBooking(
      db,
      evt.id,
      { performerId: p.id, performerType: "musician", pay: 125 },
      "t",
    );
    const pay = await createPerformerPayment(db, {
      method: "check",
      eventId: evt.id,
      payeePerformerId: p.id,
      checkNumber: "1",
      lines: [{ bookingId: b.id, amount: 125 }],
    });

    expect((await settledCentsByBookingForEvent(db, evt.id)).get(b.id)).toBe(12500);

    const voided = await voidPerformerPayment(db, pay.id, "wrong amount");
    expect(voided.voided).toBe(true);
    expect(voided.voidReason).toBe("wrong amount");

    // A voided check settles nothing.
    expect((await settledCentsByBookingForEvent(db, evt.id)).get(b.id) ?? 0).toBe(0);

    // A reissue is a new live check; feature 081 (R8) links it to the voided one without being asked.
    const reissue = await createPerformerPayment(db, {
      method: "check",
      eventId: evt.id,
      payeePerformerId: p.id,
      checkNumber: "2",
      lines: [{ bookingId: b.id, amount: 130 }],
    });
    expect(reissue.replacesPaymentId).toBe(pay.id);
    expect((await settledCentsByBookingForEvent(db, evt.id)).get(b.id)).toBe(13000);

    // A voided check cannot be edited (correct via a reissue).
    await expect(
      patchPerformerPayment(db, pay.id, { lines: [{ bookingId: b.id, amount: 1 }] }),
    ).rejects.toThrow();
  });
});
