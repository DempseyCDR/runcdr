import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/client";
import { bookings, events, paymentBookings, performerPayments } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { centsToDollars } from "@/server/lib/money";
import { performerCashFor, type PerformerCashLine } from "@/server/domain/door/doorRecordService";

/**
 * Feature 081 (FR-004, FR-005, research R10): what an event's performers are booked for, what has been paid,
 * and what is still to pay — one computation for /payments and /gate alike.
 *
 * Invariant (SC-006): `booked = paid + stillToPay − difference`.
 */
export type PaymentSummary = {
  /** Booked amounts of the event's counted bookings. */
  booked: number;
  /** Live payments settling them, wherever the payment was recorded. */
  paid: number;
  /** Booked amounts of counted bookings with a booked amount and no live payment. */
  stillToPay: number;
  stillToPayCount: number;
  /** Σ (paid − booked) over the bookings that have a live payment. */
  difference: number;
  /** Live payments recorded at this event that settle other (earlier) events' bookings. */
  earlierPaidHere: number;
  /** Live cash paid to performers from this event's takings. */
  performerCash: PerformerCashLine[];
};

export async function getPaymentSummary(db: DbOrTx, eventId: string): Promise<PaymentSummary> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();

  const rows = await db
    .select({ id: bookings.id, payCents: bookings.payCents, status: bookings.status })
    .from(bookings)
    .where(eq(bookings.eventId, eventId));

  const paidByBooking = new Map<string, number>();
  if (rows.length > 0) {
    const lines = await db
      .select({ bookingId: paymentBookings.bookingId, amountCents: paymentBookings.amountCents })
      .from(paymentBookings)
      .where(
        and(
          eq(paymentBookings.live, true),
          inArray(
            paymentBookings.bookingId,
            rows.map((r) => r.id),
          ),
        ),
      );
    for (const l of lines) paidByBooking.set(l.bookingId, l.amountCents);
  }

  let booked = 0;
  let paid = 0;
  let stillToPay = 0;
  let stillToPayCount = 0;
  let difference = 0;
  for (const b of rows) {
    const paidCents = paidByBooking.get(b.id);
    // A performer who declined and was never paid is neither owed nor listed; a paid no-show counts as paid.
    if (b.status === "declined" && paidCents === undefined) continue;
    booked += b.payCents;
    if (paidCents === undefined) {
      if (b.payCents > 0) {
        stillToPay += b.payCents;
        stillToPayCount += 1;
      }
    } else {
      paid += paidCents;
      difference += paidCents - b.payCents;
    }
  }

  const [earlier] = await db
    .select({ cents: sumCents() })
    .from(paymentBookings)
    .innerJoin(performerPayments, eq(performerPayments.id, paymentBookings.paymentId))
    .innerJoin(bookings, eq(bookings.id, paymentBookings.bookingId))
    .where(
      and(
        eq(performerPayments.eventId, eventId),
        eq(paymentBookings.live, true),
        ne(bookings.eventId, eventId),
      ),
    );

  return {
    booked: centsToDollars(booked),
    paid: centsToDollars(paid),
    stillToPay: centsToDollars(stillToPay),
    stillToPayCount,
    difference: centsToDollars(difference),
    earlierPaidHere: centsToDollars(Number(earlier?.cents ?? 0)),
    performerCash: await performerCashFor(db, eventId),
  };
}

function sumCents() {
  return sql<string>`coalesce(sum(${paymentBookings.amountCents}), 0)`;
}
