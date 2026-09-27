import { and, asc, count, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { contactEmails, contacts, events, venues } from "@/server/db/schema";
import type { VenueRow } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { writeAudit } from "@/server/lib/audit";
import { mailtoEmailFor } from "@/server/domain/contacts/mailtoEmail";
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

/**
 * A venue as it is read, with its landlord's NAME (feature 087). A display name, readable by any volunteer
 * as a performer's contact name is; the landlord's address stays behind `contact.pii.read`
 * (`getLandlordMailtoEmail`). Without it the venue form could only say the landlord was "set".
 */
export type VenueView = VenueRow & { landlordName: string | null };

/** Feature 084 (FR-010): the venues on OFFER — an archived hall is not one of them. */
export async function listVenues(db: Db, includeArchived = false): Promise<VenueView[]> {
  const rows = await db
    .select({ venue: venues, landlordName: contacts.displayName })
    .from(venues)
    .leftJoin(contacts, eq(contacts.id, venues.landlordContactId))
    .where(includeArchived ? undefined : isNull(venues.archivedAt))
    .orderBy(venues.name);
  return rows.map((r) => ({ ...r.venue, landlordName: r.landlordName }));
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

export async function getVenue(db: Db, id: string): Promise<VenueView> {
  const [row] = await db
    .select({ venue: venues, landlordName: contacts.displayName })
    .from(venues)
    .leftJoin(contacts, eq(contacts.id, venues.landlordContactId))
    .where(eq(venues.id, id));
  if (!row) throw errors.venueNotFound();
  return { ...row.venue, landlordName: row.landlordName };
}

/**
 * Feature 087: the address to email a venue's landlord at, or null — chosen as a performer's is
 * (`mailtoEmailFor`). PII, so its route requires `contact.pii.read`.
 */
export async function getLandlordMailtoEmail(db: Db, venueId: string): Promise<string | null> {
  const venue = await db.query.venues.findFirst({ where: eq(venues.id, venueId) });
  if (!venue) throw errors.venueNotFound();
  if (!venue.landlordContactId) return null;
  const rows = await db.query.contactEmails.findMany({
    where: eq(contactEmails.contactId, venue.landlordContactId),
  });
  return mailtoEmailFor(
    rows.map((r) => ({ email: r.email, purposes: r.purposes, status: r.status })),
  );
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
