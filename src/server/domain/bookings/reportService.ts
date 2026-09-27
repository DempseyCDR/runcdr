import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { bands, events, series, venues } from "@/server/db/schema";
import type { BookingStatus, PerformerType } from "@/server/db/schema";
import { venueShortNameDefault } from "@/server/domain/venues/venueService";
import { getBookingsForEvent } from "./bookingService";

/**
 * Feature 018 (B24): a read-across-events bookings report. Feature 087: this is now **Booking Central's**
 * read — one row per dance, newest first — evolved rather than replaced, so the codebase keeps one answer
 * to "who is booked for this dance". Read-only. Cancelled events are INCLUDED, flagged. All booking
 * statuses are shown (this is the staff view; the public site is confirmed-only).
 *
 * Feature 087 (FR-001b): the caller, band and musician filters and the ascending sort are RETIRED. The
 * hub has one control, the horizon; "where has this performer played" is a performer's own history.
 */
export type BookingsReportFilters = {
  series?: string; // series key
  /** The upper bound, YYYY-MM-DD inclusive. No lower bound: the Booker scrolls back without limit. */
  horizon?: string;
  /** Opaque — the `nextCursor` of the page before. */
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
  venueShortName: string | null; // feature 020 US1 (FR-002); derived initials when short_name is null
  hasSoundTech: boolean; // feature 020 US1 (FR-004); false → no sound-tech slot (community_dance)
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
const decodeCursor = (s: string): Cursor =>
  JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

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

export async function assembleBookingsReport(
  db: Db,
  filters: BookingsReportFilters = {},
): Promise<{ rows: BookingsReportRow[]; nextCursor: string | null }> {
  const conds: SQL[] = [];
  if (filters.series) conds.push(eq(series.key, filters.series));
  if (filters.horizon) conds.push(lte(events.eventDate, filters.horizon));
  if (filters.cursor) conds.push(afterCursor(decodeCursor(filters.cursor)));

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
      venueShort: venues.shortName,
    })
    .from(events)
    .innerJoin(series, eq(series.id, events.seriesId))
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(conds.length ? and(...conds) : undefined)
    // The same order `listEvents` uses, so no two screens disagree about which dance comes first.
    .orderBy(desc(events.eventDate), sql`${events.startTime} desc nulls last`, desc(events.id))
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

    const venueShortName = ev.venueName
      ? (ev.venueShort ?? (venueShortNameDefault(ev.venueName) || null))
      : null;

    rows.push({
      eventId: ev.id,
      date: ev.date,
      startTime: ev.startTime,
      label: ev.label,
      series: ev.seriesName,
      venueId: ev.venueId,
      venueShortName,
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
