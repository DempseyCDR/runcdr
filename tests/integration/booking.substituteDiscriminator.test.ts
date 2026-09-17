import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makePerformer } from "./helpers/factories";
import { bookings } from "@/server/db/schema";
import { createBand } from "@/server/domain/bands/bandService";
import { bookBand } from "@/server/domain/bands/bookBand";
import {
  createBooking,
  deleteBooking,
  patchBooking,
  substitutePerformer,
} from "@/server/domain/bookings/bookingService";
import {
  createPerformerPayment,
  voidPerformerPayment,
} from "@/server/domain/payments/performerPaymentService";

// Feature 024 US3 (FR-004/005/006): the written check is the discriminator. A live-paid booking may not be
// re-pointed or cleared; an unpaid (or only-voided) booking swaps clean; substitutePerformer does the right
// thing per branch. analyze H1: substituting a paid no-show LEAD must NOT cascade-decline the band.
describe("written-check discriminator + substitute", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function bookOne(pay = 125) {
    const evt = await makeEvent();
    const p = await makePerformer("Booked Bo");
    const b = await createBooking(db, evt.id, {
      performerId: p.id,
      performerType: "musician",
      pay,
    });
    return { evt, p, b };
  }

  async function payLive(
    eventId: string,
    payeePerformerId: string,
    bookingId: string,
    amount = 125,
  ) {
    return createPerformerPayment(db, {
      method: "check",
      eventId,
      payeePerformerId,
      checkNumber: "1001",
      lines: [{ bookingId, amount }],
    });
  }

  it("refuses a re-point of a booking settled by a live check", async () => {
    const { evt, p, b } = await bookOne();
    await payLive(evt.id, p.id, b.id);
    const sub = await makePerformer("Sub Sue");
    await expect(patchBooking(db, b.id, { performerId: sub.id })).rejects.toThrow(
      /settled by a live check/i,
    );
  });

  it("refuses a delete of a booking settled by a live check", async () => {
    const { evt, p, b } = await bookOne();
    await payLive(evt.id, p.id, b.id);
    await expect(deleteBooking(db, b.id)).rejects.toThrow(/settled by a live check/i);
  });

  it("allows a re-point / delete when unpaid", async () => {
    const { b } = await bookOne();
    const sub = await makePerformer("Sub Sue");
    const repointed = await patchBooking(db, b.id, { performerId: sub.id });
    expect(repointed.performerId).toBe(sub.id);
    expect(repointed.status).toBe("proposed");

    const { b: b2 } = await bookOne();
    await expect(deleteBooking(db, b2.id)).resolves.toBeUndefined();
  });

  it("allows a re-point once the only settling check is voided (FR-006)", async () => {
    const { evt, p, b } = await bookOne();
    const pay = await payLive(evt.id, p.id, b.id);
    await voidPerformerPayment(db, pay.id, "wrong amount");
    const sub = await makePerformer("Sub Sue");
    const repointed = await patchBooking(db, b.id, { performerId: sub.id });
    expect(repointed.performerId).toBe(sub.id); // voided → treated as unpaid → clean swap
  });

  it("substitutePerformer on an UNPAID booking re-points the slot (no no-show kept)", async () => {
    const { b } = await bookOne();
    const sub = await makePerformer("Sub Sue");
    const result = await substitutePerformer(db, b.id, sub.id);
    expect(result.noShow).toBeNull();
    expect(result.booking.id).toBe(b.id); // same slot, re-pointed
    expect(result.booking.performerId).toBe(sub.id);
    expect(result.booking.status).toBe("proposed");
  });

  it("substitutePerformer on a PAID booking keeps the original declined + adds a new booking for the sub", async () => {
    const { evt, p, b } = await bookOne();
    await payLive(evt.id, p.id, b.id);
    const sub = await makePerformer("Sub Sue");
    const result = await substitutePerformer(db, b.id, sub.id);

    expect(result.noShow?.id).toBe(b.id);
    expect(result.noShow?.status).toBe("declined"); // original kept as a no-show
    expect(result.noShow?.performerId).toBe(p.id); // original performer retained on the record
    expect(result.booking.id).not.toBe(b.id); // a fresh booking
    expect(result.booking.performerId).toBe(sub.id);
    expect(result.booking.performerType).toBe("musician");

    const rows = await db.select().from(bookings).where(eq(bookings.eventId, evt.id));
    expect(rows).toHaveLength(2); // no-show + sub
  });

  it("substituting a paid no-show LEAD declines only the lead, not the band (analyze H1)", async () => {
    const lead = await makePerformer("Lead Larry");
    const m1 = await makePerformer("Member Mo");
    const m2 = await makePerformer("Member May");
    const band = await createBand(db, {
      name: "The Trio",
      members: [
        { performerId: lead.id, isLead: true },
        { performerId: m1.id, isLead: false },
        { performerId: m2.id, isLead: false },
      ],
    });
    const evt = await makeEvent();
    await bookBand(db, evt.id, band.id);
    const bandRows = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.eventId, evt.id), eq(bookings.bandId, band.id)));
    const leadBooking = bandRows.find((r) => r.performerType === "lead_musician")!;
    const memberBookings = bandRows.filter((r) => r.performerType === "musician");

    // The lead is settled by a live check, then substituted.
    await payLive(evt.id, lead.id, leadBooking.id);
    const sub = await makePerformer("Sub Sue");
    const result = await substitutePerformer(db, leadBooking.id, sub.id);

    expect(result.noShow?.status).toBe("declined");
    // The band members must NOT have cascade-declined off the lead's internal decline.
    for (const m of memberBookings) {
      const row = await db.query.bookings.findFirst({ where: eq(bookings.id, m.id) });
      expect(row?.status).toBe("proposed");
    }
  });

  // Feature 081 (FR-025, research R13): the substitute steps into the slot at its booked amount.
  it("keeps the booked amount on an unpaid substitution", async () => {
    const { b } = await bookOne(150);
    const sub = await makePerformer("Sub Sue");
    const { booking } = await substitutePerformer(db, b.id, sub.id);
    expect(booking).toMatchObject({ payCents: 15000, isOverridden: true, requiresCheck: true });
  });

  it("books the substitute at the paid no-show's booked amount", async () => {
    const { evt, p, b } = await bookOne(150);
    await payLive(evt.id, p.id, b.id, 150);
    const sub = await makePerformer("Sub Sue");
    const { booking } = await substitutePerformer(db, b.id, sub.id);
    expect(booking).toMatchObject({ payCents: 15000, isOverridden: true, requiresCheck: true });
  });

  it("books a donated slot's substitute at $0, not donated", async () => {
    const evt = await makeEvent();
    const p = await makePerformer("Dee Donor");
    const b = await createBooking(db, evt.id, {
      performerId: p.id,
      performerType: "caller",
      isDonated: true,
    });
    const sub = await makePerformer("Sub Sue");
    const { booking } = await substitutePerformer(db, b.id, sub.id);
    expect(booking).toMatchObject({ payCents: 0, isDonated: false, requiresCheck: false });
  });

  it("leaves the Booker's own re-point resetting to the standard rate", async () => {
    const { b } = await bookOne(150);
    const sub = await makePerformer("Sub Sue");
    const repointed = await patchBooking(db, b.id, { performerId: sub.id });
    expect(repointed).toMatchObject({ payCents: 0, isOverridden: false }); // no musician rate configured
  });
});
