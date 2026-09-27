import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReqAs, ctx } from "./helpers/http";
import { makeActor, makeEvent, makePerformer } from "./helpers/factories";
import { events } from "@/server/db/schema";
import { createVenue } from "@/server/domain/venues/venueService";
import { createBooking, substitutePerformer } from "@/server/domain/bookings/bookingService";
import { createPerformerPayment } from "@/server/domain/payments/performerPaymentService";
import { assembleBookingsReport } from "@/server/domain/bookings/reportService";
import { GET as REPORT } from "@/app/api/bookings/report/route";

// Feature 018 (B24): cross-event bookings report — filters, status, cancelled inclusion, base read.
describe("cross-event bookings report", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function seed() {
    const bob = await makePerformer("Bob Fabinski");
    const cal = await makePerformer("Cal Caller");
    const dee = await makePerformer("Dee Caller");

    const a = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    await createBooking(db, a.id, { performerId: cal.id, performerType: "caller", pay: 150 });
    await createBooking(db, a.id, { performerId: bob.id, performerType: "musician", pay: 60 });

    const b = await makeEvent({ seriesKey: "ecd", eventDate: "2026-07-05" });
    await createBooking(db, b.id, { performerId: dee.id, performerType: "caller", pay: 150 });
    await createBooking(db, b.id, { performerId: bob.id, performerType: "musician", pay: 60 });

    const c = await makeEvent({ seriesKey: "tnc", eventDate: "2026-08-01" });
    await createBooking(db, c.id, { performerId: cal.id, performerType: "caller", pay: 150 });
    await db.update(events).set({ status: "cancelled" }).where(eq(events.id, c.id));

    return { bob, cal, dee, a, b, c };
  }

  // Feature 087 (FR-001b): the musician FILTER is retired — the hub's table has one control, the horizon.
  // "Where has Bob played?" is answered by a performer's own history (US3). What survives here is the
  // fact the filter relied on: a musician is reported on every dance they are booked for, in any status.
  it("reports a musician on every dance they are booked for, in any status", async () => {
    const { a, b } = await seed();
    const { rows } = await assembleBookingsReport(db, {});
    const withBob = rows.filter((r) => r.musicians.includes("Bob Fabinski")).map((r) => r.eventId);
    expect(withBob.sort()).toEqual([a.id, b.id].sort());
    expect(
      rows.find((r) => r.eventId === a.id)?.bookings.some((x) => x.status === "proposed"),
    ).toBe(true);
  });

  // Feature 087: the series narrowing survives; the date range becomes the HORIZON — the table's upper
  // bound, with no lower one, because the Booker scrolls back through history without limit.
  it("narrows to a series and stops at the horizon", async () => {
    const { a } = await seed();
    const { rows } = await assembleBookingsReport(db, { series: "tnc", horizon: "2026-06-30" });
    expect(rows.map((r) => r.eventId)).toEqual([a.id]);
    expect(rows[0]?.caller).toBe("Cal Caller");
    expect(rows[0]?.musicians).toContain("Bob Fabinski");
  });

  it("includes cancelled events, flagged", async () => {
    const { c } = await seed();
    const { rows } = await assembleBookingsReport(db, { series: "tnc" });
    const cancelledRow = rows.find((r) => r.eventId === c.id);
    expect(cancelledRow?.cancelled).toBe(true);
  });

  /**
   * Feature 087 (T004): the row carries what the hub's table shows — the time and label beside the date,
   * the venue's id so its short code can open it, the Booker's private note on the dance, each booking's
   * note, and the instructor, who shares the caller's cell (FR-003a).
   */
  it("carries the time, label, venue id, notes and instructor (087)", async () => {
    const hall = await createVenue(db, { name: "German House", address: "1 Main" });
    const ev = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    await db
      .update(events)
      .set({
        startTime: "19:30:00",
        label: "Waltz night",
        venueId: hall.id,
        note: "ask Dave first",
      })
      .where(eq(events.id, ev.id));
    const cal = await makePerformer("Cal Caller");
    const ina = await makePerformer("Ina Instructor");
    await createBooking(db, ev.id, {
      performerId: cal.id,
      performerType: "caller",
      pay: 150,
      note: "prefers the long set",
    });
    await createBooking(db, ev.id, { performerId: ina.id, performerType: "instructor", pay: 50 });

    const row = (await assembleBookingsReport(db, {})).rows.find((r) => r.eventId === ev.id);
    expect(row).toMatchObject({
      startTime: "19:30:00",
      label: "Waltz night",
      venueId: hall.id,
      note: "ask Dave first",
      caller: "Cal Caller",
      instructor: "Ina Instructor",
    });
    expect(row?.bookings.find((b) => b.performer === "Cal Caller")?.note).toBe(
      "prefers the long set",
    );
    expect(row?.bookings.find((b) => b.performer === "Cal Caller")?.bandId).toBeNull();
  });

  /**
   * Feature 087 (T005, FR-007): open-band musicians turn up and are not booked or paid, so they never
   * belong among a dance's booked musicians. They appeared here until 087 — a defect, corrected.
   */
  it("never lists an open-band musician as booked (087 FR-007)", async () => {
    const ev = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const ob = await makePerformer("Olive Openband");
    const mu = await makePerformer("Mo Musician");
    await createBooking(db, ev.id, {
      performerId: ob.id,
      performerType: "open_band_musician",
      pay: 0,
    });
    await createBooking(db, ev.id, { performerId: mu.id, performerType: "musician", pay: 60 });

    const row = (await assembleBookingsReport(db, {})).rows.find((r) => r.eventId === ev.id);
    expect(row?.musicians).toEqual(["Mo Musician"]);
    expect(row?.bookings.map((b) => b.performer)).not.toContain("Olive Openband");
  });

  /**
   * Feature 087 (T007, research R2): the table pages by keyset and must never drop or repeat a dance at a
   * page boundary. Two dances share a date routinely, and two CAN share a date and a start time, told
   * apart only by venue — the id tie-break is what keeps them apart. Paged two at a time on purpose, so
   * every awkward pair straddles a boundary somewhere.
   */
  it("pages back through every dance exactly once, newest first (087)", async () => {
    const a = await createVenue(db, { name: "Alpha Hall", address: "1 A" });
    const b = await createVenue(db, { name: "Beta Hall", address: "2 B" });
    const mk = async (date: string, time: string | null, venueId: string | null) => {
      const e = await makeEvent({ seriesKey: "tnc", eventDate: date });
      await db.update(events).set({ startTime: time, venueId }).where(eq(events.id, e.id));
      return e.id;
    };
    const ids = [
      await mk("2026-06-18", "19:30:00", a.id),
      await mk("2026-06-18", "19:30:00", b.id), // same date AND time, different hall
      await mk("2026-06-18", "13:00:00", a.id), // same date, earlier
      await mk("2026-06-18", null, null), // untimed — sorts last within its day
      await mk("2026-06-04", "19:30:00", a.id),
    ];

    // A page is exactly the size asked for — this is what fails until paging exists, since an ignored
    // limit returns everything in one page and the loop below would then pass trivially.
    const first = await assembleBookingsReport(db, { limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof assembleBookingsReport>> = await assembleBookingsReport(
        db,
        { limit: 2, ...(cursor ? { cursor } : {}) },
      );
      seen.push(...page.rows.map((r) => r.eventId));
      cursor = page.nextCursor;
    } while (cursor);

    expect(new Set(seen).size).toBe(seen.length); // nothing repeated
    expect([...seen].sort()).toEqual([...ids].sort()); // nothing dropped
    const rows = (await assembleBookingsReport(db, {})).rows;
    expect(
      rows
        .map((r) => r.eventId)
        .slice(0, 2)
        .sort(),
    ).toEqual([ids[0], ids[1]].sort());
    expect(rows[2]?.eventId).toBe(ids[2]);
    expect(rows[3]?.eventId).toBe(ids[3]); // the untimed dance, last on its day
    expect(rows[4]?.eventId).toBe(ids[4]);
  });

  /**
   * 087 US4 (T059): the table is also the club's record of who played. A substitution on a past dance
   * must leave the row naming the person who was THERE — whichever way the substitution was made.
   */
  it("names who actually played after a substitution — unpaid, the slot is re-pointed (087 US4)", async () => {
    const ev = await makeEvent({ seriesKey: "tnc", eventDate: "2026-02-05" });
    const out = await makePerformer("Ann Fiddle");
    const sub = await makePerformer("Dee Fiddle");
    const b = await createBooking(db, ev.id, {
      performerId: out.id,
      performerType: "musician",
      pay: 90,
    });
    await substitutePerformer(db, b.id, sub.id);

    const { rows } = await assembleBookingsReport(db, { series: "tnc", horizon: "2026-12-31" });
    const lines = rows.find((r) => r.eventId === ev.id)!.bookings;
    expect(lines.map((l) => l.performer)).toEqual(["Dee Fiddle"]);
  });

  it("names who actually played after a substitution — paid, the no-show is kept, declined (087 US4)", async () => {
    const ev = await makeEvent({ seriesKey: "tnc", eventDate: "2026-02-05" });
    const out = await makePerformer("Ann Fiddle");
    const sub = await makePerformer("Dee Fiddle");
    const b = await createBooking(db, ev.id, {
      performerId: out.id,
      performerType: "musician",
      pay: 90,
    });
    await createPerformerPayment(db, {
      method: "check",
      eventId: ev.id,
      payeePerformerId: out.id,
      checkNumber: "1001",
      lines: [{ bookingId: b.id, amount: 90 }],
    });
    await substitutePerformer(db, b.id, sub.id);

    const { rows } = await assembleBookingsReport(db, { series: "tnc", horizon: "2026-12-31" });
    const lines = rows.find((r) => r.eventId === ev.id)!.bookings;
    // The one who played is booked; the one who did not is kept — the check was written — but declined,
    // which the hub never counts as filling the slot.
    expect(lines.find((l) => l.performer === "Dee Fiddle")?.status).toBe("proposed");
    expect(lines.find((l) => l.performer === "Ann Fiddle")?.status).toBe("declined");
  });

  // 087 walk-through (migration 0059): ECD does not use a sound tech, so its dances never want one.
  it("wants no sound tech on an ECD dance, and still wants one on a TNC dance", async () => {
    const ecd = await makeEvent({ seriesKey: "ecd", eventDate: "2026-10-04" });
    const tnc = await makeEvent({ seriesKey: "tnc", eventDate: "2026-10-01" });

    const { rows } = await assembleBookingsReport(db, { horizon: "2026-12-31" });
    expect(rows.find((r) => r.eventId === ecd.id)?.hasSoundTech).toBe(false);
    expect(rows.find((r) => r.eventId === tnc.id)?.hasSoundTech).toBe(true);
  });

  it("is readable by a base (non-Booker) staff actor", async () => {
    await seed();
    const { token } = await makeActor({ email: "staff.reader@cdrochester.org" });
    const res = await REPORT(jsonReqAs(token, "GET", "/api/bookings/report"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.length).toBeGreaterThan(0);
  });
});
