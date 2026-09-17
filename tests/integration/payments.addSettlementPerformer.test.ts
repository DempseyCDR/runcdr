import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReqAs, ctx } from "./helpers/http";
import { makeActor, makeEvent, makePerformer } from "./helpers/factories";
import { bookings, series } from "@/server/db/schema";
import { createBooking, patchBooking } from "@/server/domain/bookings/bookingService";
import { createRateParameter } from "@/server/domain/parameters/seriesParameterService";
import { POST as ADD } from "@/app/api/events/[id]/settlement-performer/route";

// Feature 030 (FR-011): the FS adds a last-minute performer at settlement — creates a booking via
// performer_payment.write (NOT booking.write), scoped to the event's series, deduping an already-booked
// performer.
async function seriesId(key: string): Promise<string> {
  const row = await db.query.series.findFirst({ where: eq(series.key, key) });
  if (!row) throw new Error(`series ${key} not seeded`);
  return row.id;
}

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

describe("add-settlement-performer (030 US6)", () => {
  async function fsFor(key: string) {
    const { token } = await makeActor({
      email: `fs-${key}@cdrochester.org`,
      grants: [{ role: "financial_secretary", seriesId: await seriesId(key) }],
    });
    return token;
  }

  const add = (token: string, eventId: string, body: unknown) =>
    ADD(
      jsonReqAs(token, "POST", `/api/events/${eventId}/settlement-performer`, body),
      ctx({ id: eventId }),
    );

  it("creates a booking for an unbooked performer with payment-write, not booking-write", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    const p = await makePerformer("Walkin Wendy");
    const res = await add(await fsFor("tnc"), evt.id, {
      performerId: p.id,
      performerType: "musician",
    });
    expect(res.status).toBe(201);

    const rows = await db.query.bookings.findMany({
      where: and(eq(bookings.eventId, evt.id), eq(bookings.performerId, p.id)),
    });
    expect(rows).toHaveLength(1); // a booking now exists for the walk-in
    expect(rows[0]?.performerType).toBe("musician");
  });

  // Feature 081 (FR-024): an already-booked performer is refused, not quietly handed back.
  it("refuses a performer already booked on the event, naming the booking", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    const p = await makePerformer("Booked Bo");
    const existing = await createBooking(db, evt.id, {
      performerId: p.id,
      performerType: "musician",
      pay: 125,
    });
    const res = await add(await fsFor("tnc"), evt.id, {
      performerId: p.id,
      performerType: "caller",
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatchObject({
      code: "ALREADY_BOOKED",
      details: { bookingId: existing.id, performerType: "musician" },
    });

    const rows = await db.query.bookings.findMany({
      where: and(eq(bookings.eventId, evt.id), eq(bookings.performerId, p.id)),
    });
    expect(rows).toHaveLength(1);
  });

  // Feature 081 (FR-023): the Add dialog's rate becomes the booked amount; without one, the standard rate.
  it("books at the pay given, or at the series rate when none is given", async () => {
    await createRateParameter(db, {
      seriesKey: "tnc",
      kind: "musician",
      amount: 75,
      effectiveDate: "2026-01-01",
    });
    const evt = await makeEvent({ seriesKey: "tnc" });
    const token = await fsFor("tnc");
    const atRate = await (
      await add(token, evt.id, {
        performerId: (await makePerformer("Rate Rae")).id,
        performerType: "musician",
      })
    ).json();
    expect(atRate).toMatchObject({ payCents: 7500, isOverridden: false });

    const agreed = await (
      await add(token, evt.id, {
        performerId: (await makePerformer("Agreed Al")).id,
        performerType: "instructor",
        pay: 50,
      })
    ).json();
    expect(agreed).toMatchObject({ payCents: 5000, isOverridden: true, requiresCheck: true });
  });

  it("refuses a sound tech where the series has none", async () => {
    const evt = await makeEvent({ seriesKey: "community_dance" });
    const res = await add(await fsFor("community_dance"), evt.id, {
      performerId: (await makePerformer("Sam Sound")).id,
      performerType: "sound_tech",
    });
    expect(res.status).toBe(422);
  });

  it("is refused for an FS scoped to a different series", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    const p = await makePerformer("Walkin Wendy");
    const res = await add(await fsFor("ecd"), evt.id, {
      performerId: p.id,
      performerType: "musician",
    });
    expect(res.status).toBe(403);
  });
});

/**
 * Feature 081 (FR-009, research R11): instructor and open-band musician are free unless given an amount —
 * then they are payable like anyone else.
 */
describe("free unless an amount is set (081)", () => {
  it("books instructor and open-band musician free by default, payable when given a pay", async () => {
    const evt = await makeEvent();
    for (const performerType of ["instructor", "open_band_musician"] as const) {
      const free = await createBooking(db, evt.id, {
        performerId: (await makePerformer(`Free ${performerType}`)).id,
        performerType,
      });
      expect(free).toMatchObject({ payCents: 0, requiresCheck: false });

      const paid = await createBooking(db, evt.id, {
        performerId: (await makePerformer(`Paid ${performerType}`)).id,
        performerType,
        pay: 50,
      });
      expect(paid).toMatchObject({ payCents: 5000, requiresCheck: true, isOverridden: true });
    }
  });

  it("keeps a pay set later on an instructor", async () => {
    const evt = await makeEvent();
    const b = await createBooking(db, evt.id, {
      performerId: (await makePerformer("Ivy Instructor")).id,
      performerType: "instructor",
    });
    const patched = await patchBooking(db, b.id, { pay: 40 });
    expect(patched).toMatchObject({ payCents: 4000, requiresCheck: true });
  });

  it("does not ask for a payment on a donated fee", async () => {
    const evt = await makeEvent();
    const b = await createBooking(db, evt.id, {
      performerId: (await makePerformer("Dee Donor")).id,
      performerType: "caller",
      isDonated: true,
    });
    expect(b.requiresCheck).toBe(false);
  });
});
