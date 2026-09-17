import { and, desc, eq, gte, lt, ne } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { bookings, events, paymentBookings } from "@/server/db/schema";
import type { PerformerType } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { actorCan } from "@/server/auth/can";
import type { Actor } from "@/server/auth/actor";
import { centsToDollars } from "@/server/lib/money";

/** Feature 081 (FR-036, clarification Q2): how far back "Pay an earlier booking" looks. */
export const EARLIER_BOOKING_DAYS = 90;

export type UnpaidBooking = {
  bookingId: string;
  eventId: string;
  eventDate: string;
  performerType: PerformerType;
  booked: number;
};

/** `date` (YYYY-MM-DD) moved back by `days`, in calendar days. */
function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Feature 081 (FR-035, FR-036, research R14): a performer's bookings at events in the 90 days before the event
 * being paid from, that have a booked amount, are not donated or declined, have no live payment, and are in a
 * series the payer may pay — newest first. An older unpaid booking is paid from its own event's page.
 */
export async function listUnpaidEarlierBookings(
  db: Db,
  performerId: string,
  forEventId: string,
  actor?: Actor,
): Promise<UnpaidBooking[]> {
  const forEvent = await db.query.events.findFirst({ where: eq(events.id, forEventId) });
  if (!forEvent) throw errors.eventNotFound();

  const rows = await db
    .select({
      bookingId: bookings.id,
      eventId: events.id,
      eventDate: events.eventDate,
      seriesId: events.seriesId,
      groupId: events.groupId,
      performerType: bookings.performerType,
      payCents: bookings.payCents,
      paidLine: paymentBookings.bookingId,
    })
    .from(bookings)
    .innerJoin(events, eq(events.id, bookings.eventId))
    .leftJoin(
      paymentBookings,
      and(eq(paymentBookings.bookingId, bookings.id), eq(paymentBookings.live, true)),
    )
    .where(
      and(
        eq(bookings.performerId, performerId),
        gte(events.eventDate, daysBefore(forEvent.eventDate, EARLIER_BOOKING_DAYS)),
        lt(events.eventDate, forEvent.eventDate),
        ne(bookings.status, "declined"),
        eq(bookings.isDonated, false),
      ),
    )
    .orderBy(desc(events.eventDate));

  return rows
    .filter((r) => r.payCents > 0 && r.paidLine === null)
    .filter(
      (r) =>
        !actor ||
        actorCan(actor, "performer_payment.write", { seriesId: r.seriesId, groupId: r.groupId }),
    )
    .map((r) => ({
      bookingId: r.bookingId,
      eventId: r.eventId,
      eventDate: r.eventDate,
      performerType: r.performerType,
      booked: centsToDollars(r.payCents),
    }));
}
