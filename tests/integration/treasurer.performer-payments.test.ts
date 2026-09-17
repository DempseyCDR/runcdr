import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makeDoorRecord, makePerformer } from "./helpers/factories";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { createPerformerPayment } from "@/server/domain/payments/performerPaymentService";
import { GET as REPORT } from "@/app/api/events/[id]/treasurer-report/route";

// FR-011 / Feature 019 US2: the check number now lives on the recorded performer PAYMENT (payments are
// separate from bookings), and the report surfaces it from there.
describe("performer payments with check numbers", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("shows the check number recorded on the performer payment", async () => {
    const evt = await makeEvent();
    await makeDoorRecord(evt.id);
    const p = await makePerformer("Check Caller");
    const booking = await createBooking(db, evt.id, {
      performerId: p.id,
      performerType: "caller",
      pay: 150,
    });

    await createPerformerPayment(db, {
      method: "check",
      eventId: evt.id,
      payeePerformerId: p.id,
      checkNumber: "1042",
      lines: [{ bookingId: booking.id, amount: 150 }],
    });

    const res = await REPORT(
      jsonReq("GET", `/api/events/${evt.id}/treasurer-report`),
      ctx({ id: evt.id }),
    );
    const body = await res.json();
    expect(body.performerPayments[0].payee).toBe("Check Caller");
    expect(body.performerPayments[0].checkNumber).toBe("1042");
  });
});
