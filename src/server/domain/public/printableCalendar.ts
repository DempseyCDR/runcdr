import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { bands, bookings, events, performers } from "@/server/db/schema";
import { getPublicSchedule } from "@/server/domain/public/publicSchedule";
import { pricingSummary, resolveEventPricing } from "@/server/domain/public/publicPricing";
import { isSeriesKey, SERIES_KEYS, type SeriesKey } from "@/server/domain/series/seriesKeys";

// Feature 058 (P7-R15): the printable-calendar view model. Render-only, SINGLE-SOURCED — upcoming events from
// getPublicSchedule (already PII-gated on venue + confirmed-only), each event's confirmed band/caller, its public
// description, the standing schedule from each series' scheduleSentence, and prices from resolveEventPricing →
// pricingSummary. Nothing is stored. The one input is the ?start date, validated with a LOCAL YYYY-MM-DD check
// (no shared isoDate export) and falling back to today. The table is compact: Date · Series (short code) ·
// Band/Caller · Venue, with the event's description on a full-width indented sub-line under rows that have one.
// The one-page fit is a DYNAMIC, weight-aware cap: each row costs one line, plus up to two more for a
// description, and rows are taken until a page's line BUDGET is used — so fewer rows fit when more carry a blurb.

/** ~Line-units that fit one US Letter page below the header / above the footer. Tuned in-browser. */
export const PAGE_LINE_BUDGET = 22;
/** Never consider more than this many upcoming events (no page fits more; bounds the description fetch). */
const MAX_SCAN = 40;
/** A full-width description wraps at ~this many characters on Letter; clamped to 2 lines by the CSS + the cost. */
const DESC_CHARS_PER_LINE = 90;
const DESC_MAX_LINES = 2;

/** How many description lines a blurb takes (0 if none), clamped to DESC_MAX_LINES. */
function descLines(description: string | null): number {
  if (!description) return 0;
  return Math.min(DESC_MAX_LINES, Math.max(1, Math.ceil(description.length / DESC_CHARS_PER_LINE)));
}
/** A row's page cost in line-units: 1 for the event line + its description lines. */
function rowCost(description: string | null): number {
  return 1 + descLines(description);
}

/** Short codes for the table's Series column (the full name is in the footer standing schedule). */
// Feature 088: typed over SeriesKey; the community dance keeps "CD" — what visitors read, not its key.
const SERIES_SHORT: Record<SeriesKey, string> = {
  [SERIES_KEYS.tnc]: "TNC",
  [SERIES_KEYS.ecd]: "ECD",
  [SERIES_KEYS.cdob]: "CD",
  [SERIES_KEYS.general]: "Joint",
};
function seriesShort(seriesKey: string): string {
  return isSeriesKey(seriesKey) ? SERIES_SHORT[seriesKey] : seriesKey.toUpperCase();
}

export type PrintableRow = {
  dateISO: string;
  dateDisplay: string; // "Nov 27"
  series: string; // short code, e.g. "TNC"
  band: string | null; // confirmed band name(s) for the event, or null (none / ad-hoc)
  caller: string | null; // confirmed caller name(s), or null — the column reads "<band> w/<caller>"
  venue: string | null;
  cancelled: boolean;
  description: string | null; // the event's public blurb → a full-width sub-line under the row, or null
};

export type SeriesSchedule = {
  seriesKey: string;
  name: string;
  sentence: string;
  price: string | null; // pricingSummary — "$5–$15" | "Free" | null (unpriced)
};

export type PrintableCalendar = {
  startISO: string; // the effective start actually used (validated ?start, or today)
  rows: PrintableRow[];
  truncated: boolean;
  seriesSchedules: SeriesSchedule[];
};

/** The app's date convention — today as a UTC YYYY-MM-DD string (matches getPublicSchedule's `today`). */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// A local YYYY-MM-DD + real-date check (there is no shared `isoDate` export; same pattern as 054/057).
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()));

/** The `?start` boundary: a valid YYYY-MM-DD passes through; missing/malformed/non-date → today. Never throws. */
export function resolveStart(raw: string | undefined): string {
  const parsed = isoDate.safeParse(raw);
  return parsed.success ? parsed.data : todayISO();
}

/** Pure, weight-aware: take items in order while their running `cost` stays within `budget` (always at least
 *  one), and report whether any were left out. This is the DYNAMIC one-page cap — a described row costs more,
 *  so fewer fit. `truncated` is relative to `items`; the caller ORs it with "more events beyond the scan". */
export function fitRows<T>(
  items: T[],
  budget: number,
  cost: (item: T) => number,
): { rows: T[]; truncated: boolean } {
  const rows: T[] = [];
  let used = 0;
  for (const item of items) {
    const next = used + cost(item);
    if (next > budget && rows.length > 0) break;
    rows.push(item);
    used = next;
  }
  return { rows, truncated: rows.length < items.length };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Pure: a YYYY-MM-DD string → display date + weekday (UTC-parsed, matching the app's date convention). */
export function formatCalendarDate(dateISO: string): { dateDisplay: string; weekday: string } {
  const d = new Date(`${dateISO}T00:00:00Z`);
  return {
    dateDisplay: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
    weekday: WEEKDAYS[d.getUTCDay()]!,
  };
}

/** Collapse `{eventId, name}` rows into one comma-joined, de-duplicated string per event. */
function joinByEvent(rows: { eventId: string; name: string }[]): Map<string, string> {
  const names = new Map<string, string[]>();
  for (const r of rows) {
    const list = names.get(r.eventId) ?? [];
    if (!list.includes(r.name)) list.push(r.name);
    names.set(r.eventId, list);
  }
  return new Map([...names].map(([id, list]) => [id, list.join(", ")]));
}

/** The confirmed band name(s) per event (public shows only confirmed, 018). One query over the window's ids. */
async function bandsByEvent(db: Db, eventIds: string[]): Promise<Map<string, string>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .select({ eventId: bookings.eventId, name: bands.name })
    .from(bookings)
    .innerJoin(bands, eq(bands.id, bookings.bandId)) // bandId != null ⇒ a booked band
    .where(and(inArray(bookings.eventId, eventIds), eq(bookings.status, "confirmed")));
  return joinByEvent(rows);
}

/** The confirmed caller name(s) per event (public shows only confirmed, 018). One query over the window's ids. */
async function callersByEvent(db: Db, eventIds: string[]): Promise<Map<string, string>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .select({ eventId: bookings.eventId, name: performers.displayName })
    .from(bookings)
    .innerJoin(performers, eq(performers.id, bookings.performerId))
    .where(
      and(
        inArray(bookings.eventId, eventIds),
        eq(bookings.status, "confirmed"),
        eq(bookings.performerType, "caller"),
      ),
    );
  return joinByEvent(rows);
}

/** Each event's non-empty public description (blurb) by id. One query. */
async function descriptionsByEvent(db: Db, eventIds: string[]): Promise<Map<string, string>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .select({ id: events.id, description: events.description })
    .from(events)
    .where(inArray(events.id, eventIds));
  const map = new Map<string, string>();
  for (const r of rows) if (r.description && r.description.trim()) map.set(r.id, r.description);
  return map;
}

/** Assemble the printable view model from `startISO` onward — capped rows + the per-series footer. Read-only. */
export async function getPrintableCalendar(db: Db, startISO: string): Promise<PrintableCalendar> {
  const upcoming = await getPublicSchedule(db, startISO);
  // Descriptions drive the dynamic cap, so fetch them (bounded by MAX_SCAN) before deciding how many rows fit.
  const scan = upcoming.slice(0, MAX_SCAN);
  const descMap = await descriptionsByEvent(
    db,
    scan.map((it) => it.eventId),
  );
  const { rows: capped } = fitRows(scan, PAGE_LINE_BUDGET, (it) =>
    rowCost(descMap.get(it.eventId) ?? null),
  );
  const truncated = capped.length < upcoming.length;

  const eventIds = capped.map((it) => it.eventId);
  const [bandMap, callerMap] = await Promise.all([
    bandsByEvent(db, eventIds),
    callersByEvent(db, eventIds),
  ]);
  const rows: PrintableRow[] = capped.map((it) => {
    const { dateDisplay } = formatCalendarDate(it.date);
    return {
      dateISO: it.date,
      dateDisplay,
      series: seriesShort(it.seriesKey),
      band: bandMap.get(it.eventId) ?? null,
      caller: callerMap.get(it.eventId) ?? null,
      venue: it.venueShortName ?? it.venueName,
      cancelled: it.cancelled,
      description: descMap.get(it.eventId) ?? null,
    };
  });

  // Footer: each series WITH a standing-schedule sentence, plus its current admission price (as of today).
  const today = todayISO();
  const seriesRows = (await db.query.series.findMany())
    .filter((s) => s.scheduleSentence)
    .sort((a, b) => a.name.localeCompare(b.name));
  const seriesSchedules: SeriesSchedule[] = [];
  for (const s of seriesRows) {
    const pricing = await resolveEventPricing(db, {
      seriesId: s.id,
      eventDate: today,
      advertisedPriceCents: null,
    });
    seriesSchedules.push({
      seriesKey: s.key,
      name: s.name,
      sentence: s.scheduleSentence!,
      price: pricingSummary(pricing),
    });
  }

  return { startISO, rows, truncated, seriesSchedules };
}
