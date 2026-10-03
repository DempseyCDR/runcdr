import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { bands, events, series, venues } from "@/server/db/schema";
import type { BookingStatus, PerformerType } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { getBookingsForEvent } from "./bookingService";

/**
 * Feature 018 (B24): a read-across-events bookings report. Feature 087: this is now **Booking Central's**
 * read — one row per dance, newest first — evolved rather than replaced, so the codebase keeps one answer
 * to "who is booked for this dance". Read-only. Cancelled events are INCLUDED, flagged. All booking
 * statuses are shown (this is the staff view; the public site is confirmed-only).
 *
 * Feature 087 (FR-001b): the caller, band and musician filters and the ascending sort are RETIRED; "where
 * has this performer played" is a performer's own history.
 *
 * Feature 091 (research R1): the hub opens on the next dance and scrolls BOTH ways, so the read pages from
 * a split date in either direction. 087's horizon (an upper date bound) is retired.
 */
export type BookingsReportFilters = {
  /** Series keys — the dances of any of them (feature 091: a Booker of two series sees both). */
  series?: string[];
  /** `older` reads the dances before it; `newer` those on or after it. YYYY-MM-DD. */
  split?: string;
  /** `older` (the default): newest first. `newer`: nearest first — the older order exactly reversed. */
  direction?: "older" | "newer";
  /** Opaque — the `nextCursor` of the page before, in the same direction. */
  cursor?: string;
  /** Page size. Absent means every row, in one answer. */
  limit?: number;
};

export type BookingsReportBookingLine = {
  bookingId: string; // feature 020: so the report UI can open THIS booking's modal (US2)
  performerId: string;
  performer: string;
  type: PerformerType;
  status: BookingStatus;
  /** Feature 087 (FR-015): the booking's own note — `bookings.note`, which already existed. */
  note: string | null;
  /**
   * Feature 087 (FR-012): which band this booking was made for, if any. The hub shows a band with ONE
   * status — its lead's, which cascades — while loose musicians each show their own; without this a row
   * with a band and a loose musician could not tell them apart.
   */
  bandId: string | null;
};

export type BookingsReportRow = {
  eventId: string;
  date: string;
  /** Feature 087: the hub shows date, time and venue together — two dances can share a date AND a time. */
  startTime: string | null;
  label: string | null;
  series: string;
  /** Feature 087: so the venue's short code can open the venue itself. */
  venueId: string | null;
  /**
   * Feature 091 (Rich, 2026-10-01): the venue's full name. 020's short code (FR-002) fit the table's narrow
   * Venue column; the table is retired, and a card has room for the name.
   */
  venueName: string | null;
  hasSoundTech: boolean; // feature 020 US1 (FR-004); false → no sound-tech slot (the community dance, cdob)
  caller: string | null;
  /** Feature 087 (FR-003a): shares the caller's cell on the hub. Never makes a gap (FR-004a). */
  instructor: string | null;
  band: string | null; // first named band, if any
  bandId: string | null; // feature 024 US2: the band on the event, so the report can offer a re-point
  musicians: string[];
  soundTech: string | null;
  cancelled: boolean;
  /** Feature 087 (FR-014): the Booker's PRIVATE note on the dance — never `description`, the public blurb. */
  note: string | null;
  bookings: BookingsReportBookingLine[];
};

const MUSICIAN_TYPES: ReadonlySet<PerformerType> = new Set(["lead_musician", "musician"]);

/**
 * Feature 087 (FR-007): open-band musicians turn up; they are not booked and not paid. They appeared among
 * a dance's musicians until 087, which overstated what the club engaged — a defect, corrected here. They
 * stay in the database and in attendance; they are simply not a booking the hub shows.
 */
const NOT_A_BOOKING: ReadonlySet<PerformerType> = new Set(["open_band_musician"]);

/** A page boundary: the last row's position in the `(date, start time, id)` descending order. */
type Cursor = { date: string; time: string | null; id: string };

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString("base64url");

/** A cursor the client made up, or mangled, is a bad request — never a server error (091 R8). */
function decodeCursor(s: string): Cursor {
  try {
    const c: unknown = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (
      c &&
      typeof c === "object" &&
      "date" in c &&
      typeof c.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(c.date) &&
      "time" in c &&
      (c.time === null || typeof c.time === "string") &&
      "id" in c &&
      typeof c.id === "string"
    ) {
      return { date: c.date, time: c.time, id: c.id };
    }
  } catch {
    // fall through: not base64url JSON at all
  }
  throw errors.validation("cursor is not valid");
}

/**
 * Rows that come AFTER the cursor in `event_date desc, start_time desc nulls last, id desc` order.
 *
 * The id tie-break is not optional: two dances share a date routinely, and two can share a date AND a
 * start time, told apart only by venue (research R2). Order and cursor MUST agree exactly, or a dance is
 * dropped or repeated at a page boundary — which is why they are written next to each other.
 */
function afterCursor(c: Cursor): SQL {
  if (c.time === null) {
    // An untimed dance sorts last on its day, so only other untimed dances with a smaller id follow it.
    return sql`(${events.eventDate} < ${c.date}
      OR (${events.eventDate} = ${c.date} AND ${events.startTime} IS NULL AND ${events.id} < ${c.id}))`;
  }
  return sql`(${events.eventDate} < ${c.date}
    OR (${events.eventDate} = ${c.date} AND (${events.startTime} < ${c.time} OR ${events.startTime} IS NULL))
    OR (${events.eventDate} = ${c.date} AND ${events.startTime} = ${c.time} AND ${events.id} < ${c.id}))`;
}

/**
 * Feature 091 (research R1): rows that come AFTER the cursor in the REVERSED order — `event_date asc,
 * start_time asc nulls first, id asc` — the `newer` direction. The exact mirror of `afterCursor`, written
 * beside it so the two cannot drift: going forward, an untimed dance comes FIRST on its day.
 */
function beforeCursor(c: Cursor): SQL {
  if (c.time === null) {
    return sql`(${events.eventDate} > ${c.date}
      OR (${events.eventDate} = ${c.date} AND ${events.startTime} IS NOT NULL)
      OR (${events.eventDate} = ${c.date} AND ${events.startTime} IS NULL AND ${events.id} > ${c.id}))`;
  }
  return sql`(${events.eventDate} > ${c.date}
    OR (${events.eventDate} = ${c.date} AND ${events.startTime} > ${c.time})
    OR (${events.eventDate} = ${c.date} AND ${events.startTime} = ${c.time} AND ${events.id} > ${c.id}))`;
}

export async function assembleBookingsReport(
  db: Db,
  filters: BookingsReportFilters = {},
): Promise<{ rows: BookingsReportRow[]; nextCursor: string | null }> {
  const newer = filters.direction === "newer";
  const conds: SQL[] = [];
  if (filters.series?.length) conds.push(inArray(series.key, filters.series));
  // The two directions partition the dances at the split: before it, or on and after it (091 A3).
  if (filters.split) {
    conds.push(newer ? gte(events.eventDate, filters.split) : lt(events.eventDate, filters.split));
  }
  if (filters.cursor) {
    const c = decodeCursor(filters.cursor);
    conds.push(newer ? beforeCursor(c) : afterCursor(c));
  }

  const eventRows = await db
    .select({
      id: events.id,
      date: events.eventDate,
      startTime: events.startTime,
      label: events.label,
      note: events.note,
      venueId: events.venueId,
      seriesName: series.name,
      hasSoundTech: series.hasSoundTech,
      status: events.status,
      venueName: venues.name,
    })
    .from(events)
    .innerJoin(series, eq(series.id, events.seriesId))
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(conds.length ? and(...conds) : undefined)
    // The same order `listEvents` uses, so no two screens disagree about which dance comes first; `newer`
    // reads it exactly reversed, nearest first.
    .orderBy(
      ...(newer
        ? [asc(events.eventDate), sql`${events.startTime} asc nulls first`, asc(events.id)]
        : [desc(events.eventDate), sql`${events.startTime} desc nulls last`, desc(events.id)]),
    )
    // One extra row tells us whether another page exists, without a second count query.
    .limit(filters.limit === undefined ? Number.MAX_SAFE_INTEGER : filters.limit + 1);

  const more = filters.limit !== undefined && eventRows.length > filters.limit;
  const pageRows = more ? eventRows.slice(0, filters.limit) : eventRows;

  const rows: BookingsReportRow[] = [];
  for (const ev of pageRows) {
    const all = (await getBookingsForEvent(db, ev.id)).bookings;
    const bookings = all.filter((b) => !NOT_A_BOOKING.has(b.performerType));

    const caller = bookings.find((b) => b.performerType === "caller")?.performerName ?? null;
    const soundTech = bookings.find((b) => b.performerType === "sound_tech")?.performerName ?? null;
    const instructor =
      bookings.find((b) => b.performerType === "instructor")?.performerName ?? null;
    const musicians = bookings
      .filter((b) => MUSICIAN_TYPES.has(b.performerType))
      .map((b) => b.performerName);

    let band: string | null = null;
    const bandId = bookings.find((b) => b.bandId !== null)?.bandId ?? null;
    if (bandId) {
      const bandRow = await db.query.bands.findFirst({ where: eq(bands.id, bandId) });
      band = bandRow?.name ?? null;
    }

    rows.push({
      eventId: ev.id,
      date: ev.date,
      startTime: ev.startTime,
      label: ev.label,
      series: ev.seriesName,
      venueId: ev.venueId,
      venueName: ev.venueName ?? null,
      hasSoundTech: ev.hasSoundTech,
      caller,
      instructor,
      band,
      bandId,
      musicians,
      soundTech,
      cancelled: ev.status === "cancelled",
      // An empty string is "no note": the booking modal has saved `''` for a blank box (51 rows today).
      note: ev.note || null,
      bookings: bookings.map((b) => ({
        bookingId: b.id,
        performerId: b.performerId,
        performer: b.performerName,
        type: b.performerType,
        status: b.status,
        note: b.note || null,
        bandId: b.bandId,
      })),
    });
  }

  const last = pageRows[pageRows.length - 1];
  return {
    rows,
    nextCursor:
      more && last ? encodeCursor({ date: last.date, time: last.startTime, id: last.id }) : null,
  };
}
