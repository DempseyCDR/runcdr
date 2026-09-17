import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, jsonReqAs, ctx } from "./helpers/http";
import { makeActor, makeBaseActor, makeEvent, makePerformer } from "./helpers/factories";
import { bookings, series } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import {
  createPerformerPayment,
  listPerformerPayments,
} from "@/server/domain/payments/performerPaymentService";
import { GET as UNPAID } from "@/app/api/performers/[id]/unpaid-bookings/route";

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

type Unpaid = {
  bookingId: string;
  eventId: string;
  eventDate: string;
  performerType: string;
  booked: number;
};

const unpaid = async (performerId: string, forEvent: string, token?: string) => {
  const path = `/api/performers/${performerId}/unpaid-bookings?forEvent=${forEvent}`;
  return UNPAID(
    token ? jsonReqAs(token, "GET", path) : jsonReq("GET", path),
    ctx({ id: performerId }),
  );
};

/** Feature 081 US7 (FR-035–FR-037, research R14): paying tonight for a booking from an earlier evening. */
describe("earlier unpaid bookings (081)", () => {
  it("lists the performer's unpaid bookings from the 90 days before, newest first", async () => {
    const tonight = await makeEvent({ eventDate: "2026-06-18" });
    const pat = await makePerformer("Pat Fiddle");
    const bookAt = async (eventDate: string, pay = 100) => {
      const evt = await makeEvent({ eventDate });
      return createBooking(db, evt.id, { performerId: pat.id, performerType: "musician", pay });
    };
    const day1 = await bookAt("2026-06-17"); // 1 day before
    const day90 = await bookAt("2026-03-20"); // 90 days before
    await bookAt("2026-03-19"); // 91 days — too old
    await bookAt("2026-06-25"); // later — not earlier
    await createBooking(db, tonight.id, {
      performerId: pat.id,
      performerType: "musician",
      pay: 100,
    }); // tonight
    await bookAt("2026-06-10", 0); // free
    const donatedEvt = await makeEvent({ eventDate: "2026-06-09" });
    await createBooking(db, donatedEvt.id, {
      performerId: pat.id,
      performerType: "caller",
      isDonated: true,
    });
    const declined = await bookAt("2026-06-08");
    await db.update(bookings).set({ status: "declined" }).where(eq(bookings.id, declined.id));
    const paid = await bookAt("2026-06-07");
    await createPerformerPayment(db, {
      eventId: paid.eventId,
      payeePerformerId: pat.id,
      method: "check",
      checkNumber: "9001",
      lines: [{ bookingId: paid.id, amount: 100 }],
    });

    const res = await unpaid(pat.id, tonight.id);
    expect(res.status).toBe(200);
    const list: Unpaid[] = (await res.json()).bookings;
    expect(list).toEqual([
      {
        bookingId: day1.id,
        eventId: day1.eventId,
        eventDate: "2026-06-17",
        performerType: "musician",
        booked: 100,
      },
      {
        bookingId: day90.id,
        eventId: day90.eventId,
        eventDate: "2026-03-20",
        performerType: "musician",
        booked: 100,
      },
    ]);
  });

  it("shows only bookings in series the payer may pay, and needs payment authority", async () => {
    const tonight = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const tncEarlier = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-04" });
    const ecdEarlier = await makeEvent({ seriesKey: "ecd", eventDate: "2026-06-05" });
    const pat = await makePerformer("Pat Fiddle");
    const inTnc = await createBooking(db, tncEarlier.id, {
      performerId: pat.id,
      performerType: "musician",
      pay: 100,
    });
    await createBooking(db, ecdEarlier.id, {
      performerId: pat.id,
      performerType: "musician",
      pay: 100,
    });
    const tnc = await db.query.series.findFirst({ where: eq(series.key, "tnc") });
    const fs = await makeActor({
      email: "fs@example.com",
      grants: [{ role: "financial_secretary", seriesId: tnc!.id }],
    });

    const scoped: Unpaid[] = (await (await unpaid(pat.id, tonight.id, fs.token)).json()).bookings;
    expect(scoped.map((b) => b.bookingId)).toEqual([inTnc.id]);

    const base = await makeBaseActor("base@example.com");
    expect((await unpaid(pat.id, tonight.id, base.token)).status).toBe(403);
  });

  it("pays an earlier booking tonight, and both events say where", async () => {
    const earlier = await makeEvent({ eventDate: "2026-06-04" });
    const tonight = await makeEvent({ eventDate: "2026-06-18" });
    const pat = await makePerformer("Pat Fiddle");
    const b = await createBooking(db, earlier.id, {
      performerId: pat.id,
      performerType: "musician",
      pay: 100,
    });
    const payment = await createPerformerPayment(db, {
      eventId: tonight.id,
      payeePerformerId: pat.id,
      method: "cash",
      lines: [{ bookingId: b.id, amount: 100 }],
    });
    expect(payment.eventId).toBe(tonight.id);
    expect(payment.lines[0]).toMatchObject({ eventId: earlier.id, eventDate: "2026-06-04" });

    const before = await listPerformerPayments(db, earlier.id);
    expect(before.paidElsewhere).toEqual({
      [b.id]: { eventId: tonight.id, eventDate: "2026-06-18", paymentId: payment.id },
    });
    expect(before.summary).toMatchObject({ paid: 100, stillToPayCount: 0 });

    const after = await listPerformerPayments(db, tonight.id);
    expect(after.paidElsewhere).toEqual({});
    expect(after.summary.earlierPaidHere).toBe(100);

    expect(((await (await unpaid(pat.id, tonight.id)).json()).bookings as Unpaid[]).length).toBe(0);
  });
});
