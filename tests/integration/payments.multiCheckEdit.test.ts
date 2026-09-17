import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makePerformer } from "./helpers/factories";
import { paymentBookings } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { createPerformerPayment } from "@/server/domain/payments/performerPaymentService";
import { PATCH as PATCH_PAYMENT } from "@/app/api/performer-payments/[id]/route";

// Feature 043 (D3): a multi-booking payment's check number is correctable IN PLACE — a check-number-only PATCH
// (no `lines`) sets the number and leaves the per-line allocation untouched. (Characterizes the existing PATCH
// contract; locks FR-008/FR-009.)
describe("PATCH /api/performer-payments/:id — multi-line check-number-only edit (043 D3)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("sets the check number and preserves each line's amount", async () => {
    const evt = await makeEvent();
    const clara = await makePerformer("Clara Lead");
    const micah = await makePerformer("Micah Lead");
    const b1 = await createBooking(db, evt.id, {
      performerId: clara.id,
      performerType: "lead_musician",
      pay: 50,
    });
    const b2 = await createBooking(db, evt.id, {
      performerId: micah.id,
      performerType: "lead_musician",
      pay: 50,
    });
    // one check to Clara covering both bookings. (043's D3 case was a number-less check; since 081 a check
    // always has a number, so the case is now correcting the number.)
    const payment = await createPerformerPayment(db, {
      method: "check",
      checkNumber: "1791",
      eventId: evt.id,
      payeePerformerId: clara.id,
      lines: [
        { bookingId: b1.id, amount: 50 },
        { bookingId: b2.id, amount: 50 },
      ],
    });
    expect(payment.checkNumber).toBe("1791");

    // check-number-only PATCH — NO `lines`
    const res = await PATCH_PAYMENT(
      jsonReq("PATCH", `/api/performer-payments/${payment.id}`, { checkNumber: "1792" }),
      ctx({ id: payment.id }),
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.checkNumber).toBe("1792");

    // the allocation is untouched: both lines still $50 each
    const lines = await db
      .select()
      .from(paymentBookings)
      .where(eq(paymentBookings.paymentId, payment.id));
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.amountCents === 5000)).toBe(true);
  });
});
