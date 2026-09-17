import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makePerformer } from "./helpers/factories";
import { doorRecords } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import {
  createPerformerPayment,
  deletePerformerPayment,
  patchPerformerPayment,
} from "@/server/domain/payments/performerPaymentService";
import {
  createDoorRecord,
  getDoorRecord,
  updateDoorRecord,
} from "@/server/domain/door/doorRecordService";
import { PATCH as PATCH_DOOR } from "@/app/api/door-records/[id]/route";
import { POST as OPEN_DOOR } from "@/app/api/events/[id]/door-record/route";

/**
 * Feature 081 (FR-033, research R7): cash paid to performers comes out of the evening's takings, so it
 * counts in that evening's cash paid out and the stored deposit follows it — without a second entry.
 */
describe("performer cash and the deposit (081)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function evening(eventDate = "2026-06-18") {
    const event = await makeEvent({ eventDate });
    const dr = await createDoorRecord(db, event.id, "t");
    await updateDoorRecord(db, dr.id, { grossCash: 300, seedFloat: 15, cashPaidOut: 0 });
    return { event, doorRecordId: dr.id };
  }

  async function booked(eventId: string, name: string) {
    const performer = await makePerformer(name);
    const booking = await createBooking(db, eventId, {
      performerId: performer.id,
      performerType: "musician",
      pay: 100,
    });
    return { performer, booking };
  }

  const deposit = async (eventId: string) => {
    const [row] = await db.select().from(doorRecords).where(eq(doorRecords.eventId, eventId));
    return row ? row.depositCents / 100 : null;
  };

  const cash = (eventId: string, payeeId: string, bookingId: string, amount: number) =>
    createPerformerPayment(db, {
      eventId,
      payeePerformerId: payeeId,
      method: "cash",
      lines: [{ bookingId, amount }],
    });

  it("takes cash payments off the deposit as they are recorded, corrected and deleted", async () => {
    const { event } = await evening();
    const { performer, booking } = await booked(event.id, "Pat Fiddle");
    expect(await deposit(event.id)).toBe(285);

    const payment = await cash(event.id, performer.id, booking.id, 25);
    expect(await deposit(event.id)).toBe(260);

    await patchPerformerPayment(db, payment.id, { lines: [{ bookingId: booking.id, amount: 30 }] });
    expect(await deposit(event.id)).toBe(255);

    await deletePerformerPayment(db, payment.id);
    expect(await deposit(event.id)).toBe(285);
  });

  it("leaves the deposit alone for a check", async () => {
    const { event } = await evening();
    const { performer, booking } = await booked(event.id, "Pat Fiddle");
    await createPerformerPayment(db, {
      eventId: event.id,
      payeePerformerId: performer.id,
      method: "check",
      checkNumber: "1500",
      lines: [{ bookingId: booking.id, amount: 100 }],
    });
    expect(await deposit(event.id)).toBe(285);
  });

  it("keeps the performers' cash when the gate is saved with other cash paid out", async () => {
    const { event, doorRecordId } = await evening();
    const { performer, booking } = await booked(event.id, "Pat Fiddle");
    await cash(event.id, performer.id, booking.id, 30);

    const res = await PATCH_DOOR(
      jsonReq("PATCH", `/api/door-records/${doorRecordId}`, {
        cashPaidOut: 20,
        cashPaidOutReason: "ice",
      }),
      ctx({ id: doorRecordId }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deposit).toBe(235); // 300 − 15 − 20 − 30
    expect(body.cashPaidOut).toBe(20); // the gate's own figure is other payouts only
    expect(await deposit(event.id)).toBe(235);
  });

  it("opens a door record for cash paid at an event that has none", async () => {
    const event = await makeEvent();
    const { performer, booking } = await booked(event.id, "Pat Fiddle");
    await cash(event.id, performer.id, booking.id, 40);
    const [row] = await db.select().from(doorRecords).where(eq(doorRecords.eventId, event.id));
    expect(row).toBeTruthy();
    expect(row!.depositCents).toBe(0 - row!.seedFloatCents - 4000);
  });

  it("names the performers paid in cash on the door record", async () => {
    const { event, doorRecordId } = await evening();
    const a = await booked(event.id, "Pat Fiddle");
    const b = await booked(event.id, "Carl Caller");
    const pay = await cash(event.id, a.performer.id, a.booking.id, 60);
    await createPerformerPayment(db, {
      eventId: event.id,
      payeePerformerId: b.performer.id,
      method: "check",
      checkNumber: "1501",
      lines: [{ bookingId: b.booking.id, amount: 100 }],
    });

    const view = await getDoorRecord(db, doorRecordId);
    expect(view.doorRecord.performerCash).toEqual([
      { paymentId: pay.id, payee: "Pat Fiddle", amount: 60 },
    ]);
    expect(view.doorRecord.cashPaidOut).toBe(0);

    const res = await OPEN_DOOR(
      jsonReq("POST", `/api/events/${event.id}/door-record`),
      ctx({ id: event.id }),
    );
    expect((await res.json()).doorRecord.performerCash).toHaveLength(1);
  });

  it("counts cash paid tonight for an earlier booking in tonight's deposit, not the earlier one's", async () => {
    const earlier = await evening("2026-06-04");
    const tonight = await evening("2026-06-18");
    const { performer, booking } = await booked(earlier.event.id, "Pat Fiddle");
    await cash(tonight.event.id, performer.id, booking.id, 100);
    expect(await deposit(tonight.event.id)).toBe(185);
    expect(await deposit(earlier.event.id)).toBe(285);
  });
});
