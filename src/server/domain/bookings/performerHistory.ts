import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { bookings, events, series } from "@/server/db/schema";
import type { BookingStatus, PerformerType } from "@/server/db/schema";

/**
 * Feature 087 US3 (FR-019): a performer's history with the club — every dance they have played or are
 * booked to play, newest first.
 *
 * This is what answers "where has Bob played?" now that the old report's caller and musician filters are
 * retired (FR-001b): a question about a performer, answered from the performer. The phone surface will
 * ask the same question, so it is built once here.
 *
 * A declined booking is KEPT, marked — "declined twice this year" is part of their history with the club.
 */
export type PerformerHistoryItem = {
  eventId: string;
  date: string;
  startTime: string | null;
  label: string | null;
  series: string;
  role: PerformerType;
  status: BookingStatus;
  cancelled: boolean;
};

export async function performerHistory(
  db: Db,
  performerId: string,
): Promise<PerformerHistoryItem[]> {
  const rows = await db
    .select({
      eventId: events.id,
      date: events.eventDate,
      startTime: events.startTime,
      label: events.label,
      series: series.name,
      role: bookings.performerType,
      status: bookings.status,
      eventStatus: events.status,
    })
    .from(bookings)
    .innerJoin(events, eq(events.id, bookings.eventId))
    .innerJoin(series, eq(series.id, events.seriesId))
    .where(eq(bookings.performerId, performerId))
    // The same order the hub uses, so a performer's history reads in step with the table.
    .orderBy(desc(events.eventDate), sql`${events.startTime} desc nulls last`, desc(events.id));

  return rows.map(({ eventStatus, ...r }) => ({ ...r, cancelled: eventStatus === "cancelled" }));
}
