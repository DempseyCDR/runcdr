import { and, asc, count, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { events, venues } from "@/server/db/schema";
import type { VenueRow } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { writeAudit } from "@/server/lib/audit";
import type { VenueCreateInput, VenuePatchInput } from "@/server/validation/venues";

/**
 * Feature 020 US5 (FR-024): the default short name for a venue — the uppercased first letter of each
 * whitespace-delimited word ("German House" → "GH"). Pure; mirrored by the migration 0025 backfill SQL.
 * Display-only and non-unique. Empty/whitespace name → "".
 */
export function venueShortNameDefault(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export async function createVenue(
  db: Db,
  input: VenueCreateInput,
  actor: string | null = null,
): Promise<VenueRow> {
  const shortName =
    input.shortName && input.shortName.length > 0
      ? input.shortName
      : venueShortNameDefault(input.name);
  // Feature 052 (P7-R8): a public venue MUST have an address (FR-007).
  if (input.isPublic && input.address.trim() === "") {
    throw errors.validation("A public venue must have an address.");
  }
  const [row] = await db
    .insert(venues)
    .values({
      name: input.name,
      shortName,
      address: input.address,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      isPublic: input.isPublic ?? false,
      directions: input.directions ?? null,
    })
    .returning();
  if (!row) throw new Error("venue insert failed");
  writeAudit({ kind: "venue.created", actor, details: { venueId: row.id, name: row.name } });
  return row;
}

/** Feature 084 (FR-010): the venues on OFFER — an archived hall is not one of them. */
export async function listVenues(db: Db, includeArchived = false): Promise<VenueRow[]> {
  return db
    .select()
    .from(venues)
    .where(includeArchived ? undefined : isNull(venues.archivedAt))
    .orderBy(venues.name);
}

/** Today, as the database sees an event date. */
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Feature 084 (FR-014): what still expects this venue — how many events are to come, and the next one.
 * Archiving warns with this and proceeds when the Booker confirms; the bookings themselves are untouched.
 */
export async function venueStillInUse(
  db: Db,
  venueId: string,
): Promise<{ futureCount: number; nextDate: string | null }> {
  const upcoming = and(eq(events.venueId, venueId), gte(events.eventDate, today()));
  const [tally] = await db.select({ n: count() }).from(events).where(upcoming);
  const [next] = await db
    .select({ eventDate: events.eventDate })
    .from(events)
    .where(upcoming)
    .orderBy(asc(events.eventDate))
    .limit(1);
  return { futureCount: tally?.n ?? 0, nextDate: next?.eventDate ?? null };
}

/**
 * Feature 084 (FR-010, FR-013): retire a venue without deleting it. A no-op when already archived, as
 * `archiveBand` is. Events that already name it keep naming it — archiving touches nothing but this row.
 */
export async function archiveVenue(db: Db, id: string, actor: string | null = null): Promise<void> {
  const existing = await getVenue(db, id);
  if (existing.archivedAt) return;
  await db
    .update(venues)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(venues.id, id));
  writeAudit({ kind: "venue.archived", actor, details: { venueId: id } });
}

/** Feature 084 (FR-012): put an archived venue back. A no-op when it is already active. */
export async function restoreVenue(db: Db, id: string, actor: string | null = null): Promise<void> {
  const existing = await getVenue(db, id);
  if (!existing.archivedAt) return;
  await db.update(venues).set({ archivedAt: null, updatedAt: new Date() }).where(eq(venues.id, id));
  writeAudit({ kind: "venue.restored", actor, details: { venueId: id } });
}

export async function getVenue(db: Db, id: string): Promise<VenueRow> {
  const row = await db.query.venues.findFirst({ where: eq(venues.id, id) });
  if (!row) throw errors.venueNotFound();
  return row;
}

export async function patchVenue(
  db: Db,
  id: string,
  input: VenuePatchInput,
  actor: string | null = null,
): Promise<VenueRow> {
  const existing = await db.query.venues.findFirst({ where: eq(venues.id, id) });
  if (!existing) throw errors.venueNotFound();
  // Feature 052 (P7-R8): reject any change that would leave the venue public without an address (FR-007).
  const effectiveIsPublic = input.isPublic ?? existing.isPublic;
  const effectiveAddress = input.address ?? existing.address;
  if (effectiveIsPublic && effectiveAddress.trim() === "") {
    throw errors.validation("A public venue must have an address.");
  }
  const [row] = await db
    .update(venues)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
      ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
      ...(input.landlordContactId !== undefined
        ? { landlordContactId: input.landlordContactId }
        : {}),
      ...(input.shortName !== undefined ? { shortName: input.shortName } : {}),
      ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
      ...(input.directions !== undefined ? { directions: input.directions } : {}),
      updatedAt: new Date(),
    })
    .where(eq(venues.id, id))
    .returning();
  if (!row) throw errors.venueNotFound();
  writeAudit({ kind: "venue.updated", actor, details: { venueId: id } });
  return row;
}

/** Assign (or clear, with null) a venue on an event. 404s on unknown event or venue. */
export async function assignVenueToEvent(
  db: Db,
  eventId: string,
  venueId: string | null,
): Promise<void> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();
  if (venueId !== null) {
    const venue = await db.query.venues.findFirst({ where: eq(venues.id, venueId) });
    if (!venue) throw errors.venueNotFound();
  }
  await db.update(events).set({ venueId }).where(eq(events.id, eventId));
}

/** Set (or clear, with null) an event's per-event rent override (feature 011). 404s on unknown event. */
export async function setEventRent(
  db: Db,
  eventId: string,
  rentCents: number | null,
  actor: string | null = null,
): Promise<void> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();
  await db.update(events).set({ rentCents }).where(eq(events.id, eventId));
  writeAudit({ kind: "event.rent_set", actor, details: { eventId, rentCents } });
}
