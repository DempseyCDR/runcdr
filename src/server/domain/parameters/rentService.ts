import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import type { Db, DbOrTx } from "@/server/db/client";
import { events, series, venueRentAudit, venueRents, venues } from "@/server/db/schema";
import type { VenueRentRow } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { writeAudit } from "@/server/lib/audit";
import { dollarsToCents } from "@/server/lib/money";
import type { VenueRentCreateInput } from "@/server/validation/venueRents";

type EventRentInput = {
  rentCents: number | null;
  venueId: string | null;
  seriesId: string;
  eventDate: string;
};

async function latestVenueRent(
  db: DbOrTx,
  venueId: string,
  seriesId: string | null,
  onDate: string,
): Promise<number | null> {
  const [row] = await db
    .select({ amountCents: venueRents.amountCents })
    .from(venueRents)
    .where(
      and(
        eq(venueRents.venueId, venueId),
        seriesId === null ? isNull(venueRents.seriesId) : eq(venueRents.seriesId, seriesId),
        lte(venueRents.effectiveDate, onDate),
      ),
    )
    .orderBy(desc(venueRents.effectiveDate))
    .limit(1);
  return row?.amountCents ?? null;
}

/**
 * Resolve an event's rent (cents), most specific first (FR-005):
 * per-event override → series-at-venue → venue default → 0.
 */
export async function resolveEventRentCents(db: DbOrTx, event: EventRentInput): Promise<number> {
  if (event.rentCents != null) return event.rentCents;
  if (!event.venueId) return 0;
  const seriesAtVenue = await latestVenueRent(db, event.venueId, event.seriesId, event.eventDate);
  if (seriesAtVenue != null) return seriesAtVenue;
  const venueDefault = await latestVenueRent(db, event.venueId, null, event.eventDate);
  return venueDefault ?? 0;
}

/**
 * Feature 020 US4 (FR-019): the resolved rent (cents) for a HYPOTHETICAL (series, venue, date) with no
 * per-event override — what the event modal shows as the default and re-computes when Sean changes the
 * venue, before anything is saved. A null venue resolves to 0.
 */
export async function resolveRentForVenue(
  db: DbOrTx,
  seriesId: string,
  venueId: string | null,
  onDate: string,
): Promise<number> {
  return resolveEventRentCents(db, { rentCents: null, venueId, seriesId, eventDate: onDate });
}

/** Create a venue rent (venue default when seriesKey omitted; else series-at-venue). */
/**
 * Feature 084 (FR-030): what would be lost by removing this rent — events at that venue, in that rent's
 * series (or any series, for a venue-wide row), on or after the date it takes effect.
 *
 * Deliberately conservative: refusing a deletion the Booker wanted is recoverable by adding a newer row;
 * allowing one that moves the rent a past report resolved is not (SC-006).
 */
export async function venueRentInUse(
  db: Db,
  rentId: string,
): Promise<{ futureCount: number; nextDate: string | null }> {
  const rent = await db.query.venueRents.findFirst({ where: eq(venueRents.id, rentId) });
  if (!rent) throw errors.validation("That rent no longer exists.");
  const used = and(
    eq(events.venueId, rent.venueId),
    gte(events.eventDate, rent.effectiveDate),
    rent.seriesId ? eq(events.seriesId, rent.seriesId) : undefined,
  );
  const rows = await db
    .select({ eventDate: events.eventDate })
    .from(events)
    .where(used)
    .orderBy(asc(events.eventDate));
  return { futureCount: rows.length, nextDate: rows[0]?.eventDate ?? null };
}

/**
 * Feature 084 (FR-030): remove a rent nothing has used — a figure typed wrongly a moment ago. A rent an
 * event has already resolved is corrected by adding a newer one instead (FR-029), which is how this table
 * has always worked.
 */
export async function deleteVenueRent(
  db: Db,
  rentId: string,
  actor: string | null = null,
): Promise<void> {
  const rent = await db.query.venueRents.findFirst({ where: eq(venueRents.id, rentId) });
  if (!rent) throw errors.validation("That rent no longer exists.");
  await db.delete(venueRents).where(eq(venueRents.id, rentId));
  writeAudit({
    kind: "venue_rent.deleted",
    actor,
    details: { venueId: rent.venueId, seriesId: rent.seriesId, amountCents: rent.amountCents },
  });
}

export async function createVenueRent(
  db: Db,
  input: VenueRentCreateInput,
  actor: string | null = null,
): Promise<VenueRentRow> {
  const venue = await db.query.venues.findFirst({ where: eq(venues.id, input.venueId) });
  if (!venue) throw errors.venueNotFound();
  let seriesId: string | null = null;
  if (input.seriesKey) {
    const s = await db.query.series.findFirst({ where: eq(series.key, input.seriesKey) });
    if (!s) throw errors.seriesNotFound();
    seriesId = s.id;
  }
  const amountCents = dollarsToCents(input.amount);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(venueRents)
      .values({ venueId: input.venueId, seriesId, amountCents, effectiveDate: input.effectiveDate })
      .returning();
    if (!row) throw new Error("venue rent insert failed");
    await tx.insert(venueRentAudit).values({
      venueId: input.venueId,
      seriesId,
      amountCents,
      effectiveDate: input.effectiveDate,
      actor,
    });
    writeAudit({
      kind: "venue_rent.created",
      actor,
      details: { venueId: input.venueId, seriesId, amountCents },
    });
    return row;
  });
}
