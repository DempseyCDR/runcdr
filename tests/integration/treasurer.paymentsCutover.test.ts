import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makeDoorRecord, makePerformer } from "./helpers/factories";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { createPerformerPayment } from "@/server/domain/payments/performerPaymentService";
import { GET as REPORT } from "@/app/api/events/[id]/treasurer-report/route";

// Feature 019 US2 (R7): after the report cuts over to performer_payments, a payment mirroring what the
// migration backfill produces (payee = booked performer, same amount + check, one linked booking) yields
// the SAME expenses line the report emitted pre-cutover.
describe("treasurer report — performer payments cutover parity", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a backfill-equivalent payment reproduces the pre-cutover line shape", async () => {
    const evt = await makeEvent();
    await makeDoorRecord(evt.id);
    const caller = await makePerformer("Backfill Caller");
    const booking = await createBooking(db, evt.id, {
      performerId: caller.id,
      performerType: "caller",
      pay: 150,
    });
    // The backfill's shape: payee = booked performer, same amount + check, linked to its one booking.
    await createPerformerPayment(db, {
      method: "check",
      eventId: evt.id,
      payeePerformerId: caller.id,
      checkNumber: "1042",
      lines: [{ bookingId: booking.id, amount: 150 }],
    });

    const res = await REPORT(
      jsonReq("GET", `/api/events/${evt.id}/treasurer-report`),
      ctx({ id: evt.id }),
    );
    const body = await res.json();
    expect(body.expenses.payments).toHaveLength(1);
    expect(body.expenses.payments[0]).toMatchObject({
      payee: "Backfill Caller",
      role: "caller",
      amount: 150,
      checkNumber: "1042",
      cash: false,
      voided: false,
    });
    // Booked and paid agree, so the line needs no note about the difference.
    expect(body.expenses.payments[0].notes).toEqual([]);
    // Reconciliation: booked 150 = paid 150 → nothing outstanding, and it is still reported.
    expect(body.expenses.reconciliation).toEqual({ booked: 150, paid: 150, outstanding: 0 });
  });

  it("a booked-but-unpaid performer shows as a reconciliation gap, no line", async () => {
    const evt = await makeEvent();
    await makeDoorRecord(evt.id);
    const p = await makePerformer("Unpaid Uma");
    await createBooking(db, evt.id, { performerId: p.id, performerType: "musician", pay: 125 });

    const res = await REPORT(
      jsonReq("GET", `/api/events/${evt.id}/treasurer-report`),
      ctx({ id: evt.id }),
    );
    const body = await res.json();
    expect(body.expenses.payments).toHaveLength(0);
    expect(body.expenses.reconciliation).toEqual({ booked: 125, paid: 0, outstanding: 125 });
  });
});
