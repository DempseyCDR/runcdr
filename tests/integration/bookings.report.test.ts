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

  // Feature 087: the series narrowing survives. Feature 091: the horizon is retired; a SPLIT date divides
  // the dances — older reads those before it, newer those on or after it (contracts/report-api.md A5).
  it("narrows to a series, on either side of the split", async () => {
    const { a, c } = await seed();
    const older = await assembleBookingsReport(db, { series: ["tnc"], split: "2026-07-01" });
    expect(older.rows.map((r) => r.eventId)).toEqual([a.id]);
    expect(older.rows[0]?.caller).toBe("Cal Caller");
    expect(older.rows[0]?.musicians).toContain("Bob Fabinski");

    const newer = await assembleBookingsReport(db, {
      series: ["tnc"],
      split: "2026-07-01",
      direction: "newer",
    });
    expect(newer.rows.map((r) => r.eventId)).toEqual([c.id]); // the ECD dance on 07-05 is not TNC's
  });

  it("includes cancelled events, flagged", async () => {
    const { c } = await seed();
    const { rows } = await assembleBookingsReport(db, { series: ["tnc"] });
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

    const { rows } = await assembleBookingsReport(db, { series: ["tnc"] });
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

    const { rows } = await assembleBookingsReport(db, { series: ["tnc"] });
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

    const { rows } = await assembleBookingsReport(db, {});
    expect(rows.find((r) => r.eventId === ecd.id)?.hasSoundTech).toBe(false);
    expect(rows.find((r) => r.eventId === tnc.id)?.hasSoundTech).toBe(true);
  });

  /**
   * Feature 091 (contracts/report-api.md A1–A4): the hub opens on the next dance and scrolls both ways, so
   * its read pages FORWARDS from a split as well as back. Forwards is the exact reverse of the older order
   * — or a dance would be dropped or repeated where the pages meet.
   */
  describe("both ways from a split (091)", () => {
    async function season() {
      const hall = await createVenue(db, { name: "Alpha Hall", address: "1 A" });
      const other = await createVenue(db, { name: "Beta Hall", address: "2 B" });
      const mk = async (date: string, time: string | null, venueId: string | null) => {
        const e = await makeEvent({ seriesKey: "tnc", eventDate: date });
        await db.update(events).set({ startTime: time, venueId }).where(eq(events.id, e.id));
        return e.id;
      };
      return [
        await mk("2026-07-09", "19:30:00", hall.id),
        await mk("2026-07-02", "19:30:00", hall.id),
        await mk("2026-07-02", null, null),
        await mk("2026-06-18", "19:30:00", hall.id),
        await mk("2026-06-18", "19:30:00", other.id), // same date AND time, another hall
        await mk("2026-06-18", "13:00:00", hall.id),
        await mk("2026-06-18", null, null),
        await mk("2026-06-04", "19:30:00", hall.id),
      ];
    }

    async function pageAll(direction: "older" | "newer", split: string): Promise<string[]> {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Awaited<ReturnType<typeof assembleBookingsReport>> =
          await assembleBookingsReport(db, {
            split,
            direction,
            limit: 2,
            ...(cursor ? { cursor } : {}),
          });
        seen.push(...page.rows.map((r) => r.eventId));
        cursor = page.nextCursor;
      } while (cursor);
      return seen;
    }

    it("pages newer from the split, nearest first, each dance once — the older order reversed (A2)", async () => {
      await season();
      const all = (await assembleBookingsReport(db, {})).rows; // newest first, every dance
      const ahead = all.filter((r) => r.date >= "2026-06-18").map((r) => r.eventId);

      const first = await assembleBookingsReport(db, {
        split: "2026-06-18",
        direction: "newer",
        limit: 2,
      });
      expect(first.rows).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      expect(await pageAll("newer", "2026-06-18")).toEqual([...ahead].reverse());
    });

    it("pages older from the split, newest first, each dance once (A1)", async () => {
      await season();
      const all = (await assembleBookingsReport(db, {})).rows;
      const behind = all.filter((r) => r.date < "2026-07-02").map((r) => r.eventId);
      expect(await pageAll("older", "2026-07-02")).toEqual(behind);
    });

    it("lists every dance exactly once across the two directions (A3)", async () => {
      const ids = await season();
      for (const split of ["2026-06-04", "2026-06-18", "2026-07-02", "2026-07-10"]) {
        const seen = [...(await pageAll("older", split)), ...(await pageAll("newer", split))];
        expect(new Set(seen).size, split).toBe(seen.length);
        expect([...seen].sort(), split).toEqual([...ids].sort());
      }
    });

    it("starts newer on the first dance dated on or after the split, else older on the most recent (A4)", async () => {
      const [, , untimedJul2] = await season();
      const next = await assembleBookingsReport(db, {
        split: "2026-06-19",
        direction: "newer",
        limit: 1,
      });
      // On 07-02 the untimed dance comes first going forward (it is last going back): research R1.
      expect(next.rows[0]?.eventId).toBe(untimedJul2);

      const none = await assembleBookingsReport(db, {
        split: "2027-01-01",
        direction: "newer",
        limit: 1,
      });
      expect(none.rows).toEqual([]);
      expect(none.nextCursor).toBeNull();
      const latest = await assembleBookingsReport(db, { split: "2027-01-01", limit: 1 });
      expect(latest.rows[0]?.date).toBe("2026-07-09");
    });

    it("ignores a horizon, and refuses a bad split, direction, limit or cursor with 422 (A6)", async () => {
      await season();
      const { token } = await makeActor({ email: "split.reader@cdrochester.org" });
      const get = (q: string) =>
        REPORT(jsonReqAs(token, "GET", `/api/bookings/report?${q}`), ctx());

      const all = await (await get("horizon=2026-06-10")).json();
      expect(all.rows).toHaveLength(8);

      for (const q of [
        "split=tomorrow",
        "direction=sideways",
        "limit=0",
        "limit=201",
        "cursor=not-a-cursor",
      ]) {
        expect((await get(q)).status, q).toBe(422);
      }
    });
  });

  // Feature 091 (Rich, 2026-10-02): Sean books contra and the community dance — he sees those two
  // series and not ECD. The read takes several series.
  it("narrows to several series at once, through the service and the route", async () => {
    const tnc = await makeEvent({ seriesKey: "tnc", eventDate: "2026-07-02" });
    const cdob = await makeEvent({ seriesKey: "cdob", eventDate: "2026-07-03" });
    const ecd = await makeEvent({ seriesKey: "ecd", eventDate: "2026-07-05" });

    const { rows } = await assembleBookingsReport(db, { series: ["tnc", "cdob"] });
    expect(rows.map((r) => r.eventId).sort()).toEqual([tnc.id, cdob.id].sort());

    const { token } = await makeActor({ email: "two.series@cdrochester.org" });
    const res = await REPORT(
      jsonReqAs(token, "GET", "/api/bookings/report?series=tnc,cdob"),
      ctx(),
    );
    const ids = ((await res.json()).rows as { eventId: string }[]).map((r) => r.eventId);
    expect(ids).toContain(tnc.id);
    expect(ids).toContain(cdob.id);
    expect(ids).not.toContain(ecd.id);
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
