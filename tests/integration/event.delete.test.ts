import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makePerformer, makeDoorRecord } from "./helpers/factories";
import { events } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { createPerformerPayment } from "@/server/domain/payments/performerPaymentService";
import { recordAttendance } from "@/server/domain/attendance/attendanceService";
import { DELETE as EVENT_DELETE } from "@/app/api/events/[id]/route";

function del(id: string, confirm = false) {
  const q = confirm ? "?confirmDiscardAttendance=true" : "";
  return EVENT_DELETE(jsonReq("DELETE", `/api/events/${id}${q}`), ctx({ id }));
}

// Feature 019 US4 (FR-017..FR-020): an EMPTY door record is not history; attendance is confirmed, not
// blocked; gate sales / money / check numbers / performer payments still block, and the refusal names them.
describe("event delete guardrail (feature 019)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("deletes an event whose only history is an EMPTY door record (204), removing it", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    await makeDoorRecord(evt.id); // empty: no gate sales, all money zero
    const res = await del(evt.id);
    expect(res.status).toBe(204);
    expect(await db.query.events.findFirst({ where: eq(events.id, evt.id) })).toBeUndefined();
  });

  it("refuses (409) with a named blocker when the door record has a gate sale", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    await makeDoorRecord(evt.id, [{ category: "merchandise", paymentMethod: "cash", amount: 10 }]);
    const res = await del(evt.id);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("EVENT_HAS_HISTORY");
    expect(body.error.detail).toBe("gate takings");
  });

  it("deletes an event with a booking at a rate but no check number", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    const caller = await makePerformer("Cal Caller");
    await createBooking(db, evt.id, { performerId: caller.id, performerType: "caller", pay: 150 });
    expect((await del(evt.id)).status).toBe(204);
  });

  it("refuses (409) when a performer payment exists (feature 019; was 'a paid booking (check number)' pre-021)", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    const p = await makePerformer("Paid Pat");
    const b = await createBooking(db, evt.id, {
      performerId: p.id,
      performerType: "musician",
      pay: 125,
    });
    await createPerformerPayment(db, {
      method: "check",
      checkNumber: "1001",
      eventId: evt.id,
      payeePerformerId: p.id,
      lines: [{ bookingId: b.id, amount: 125 }],
    });
    const res = await del(evt.id);
    expect(res.status).toBe(409);
    expect((await res.json()).error.detail).toBe("a recorded performer payment");
  });

  it("surfaces the attendee count and requires confirmation to discard (FR-018a)", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    await recordAttendance(db, evt.id, { unmatched: true });
    // Without confirm → 409 EVENT_HAS_ATTENDANCE with the count.
    const refused = await del(evt.id);
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.error.code).toBe("EVENT_HAS_ATTENDANCE");
    expect(body.error.detail).toBe("1");
    // With confirm → deleted.
    const ok = await del(evt.id, true);
    expect(ok.status).toBe(204);
    expect(await db.query.events.findFirst({ where: eq(events.id, evt.id) })).toBeUndefined();
  });

  it("confirm does NOT override a real blocker (gate sale still refuses)", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    await makeDoorRecord(evt.id, [{ category: "merchandise", paymentMethod: "cash", amount: 10 }]);
    await recordAttendance(db, evt.id, { unmatched: true });
    const res = await del(evt.id, true); // confirm set, but a gate sale exists
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("EVENT_HAS_HISTORY");
  });
});
