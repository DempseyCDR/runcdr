import { and, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { bookings, contactEmails, contacts, events, performers } from "@/server/db/schema";
import type { PerformerRow, PerformerType } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { centsToDollars } from "@/server/lib/money";
import { deriveContactNames } from "@/server/domain/contacts/normalize";
import { normalizePhone } from "@/server/domain/contacts/phone";
import { addEmailInTx } from "@/server/domain/contacts/emailService";
import { mailtoEmailFor } from "@/server/domain/contacts/mailtoEmail";
import type { PerformerCreateInput, PerformerPatchInput } from "@/server/validation/performers";

/**
 * Every performer MUST have a contact so the door can check them in (FR-015).
 * If no contact is linked, create one from the performer's name, seeded with
 * the given email/phone. Neither is required — missing both flags the contact
 * for admin follow-up rather than blocking performer creation.
 */
export async function createPerformer(db: Db, input: PerformerCreateInput): Promise<PerformerRow> {
  return db.transaction(async (tx) => {
    let contactId = input.contactId ?? null;
    let performerDisplayName: string;
    if (!contactId) {
      // Feature 026: build the new contact from STRUCTURED names (first/last/override) — the same
      // deriveContactNames the directory/check-in use — instead of stuffing a single name into first_name.
      const firstName = input.firstName;
      if (!firstName)
        throw errors.validation("A first name is required to create a performer's contact.");
      const names = deriveContactNames({
        firstName,
        lastName: input.lastName ?? null,
        displayNameOverride: input.displayNameOverride ?? null,
      });
      const [contact] = await tx
        .insert(contacts)
        .values({
          firstName,
          lastName: input.lastName ?? null,
          displayNameOverride: input.displayNameOverride ?? null,
          displayName: names.displayName,
          nameNormalized: names.nameNormalized,
          dedupNormalized: names.dedupNormalized,
          phone: input.phone ? normalizePhone(input.phone) : null, // feature 032: canonical E.164
          needsReview: !input.email && !input.phone,
          source: "performer",
        })
        .returning();
      if (!contact) throw new Error("contact insert failed");
      contactId = contact.id;
      performerDisplayName = names.displayName;

      if (input.email) {
        await addEmailInTx(tx, contact, {
          address: input.email,
          purposes: [input.emailPurpose ?? "personal"],
          consentTopics: ["contact_tracing"],
          status: "active",
          isLogin: false,
        });
      }
    } else {
      // Link path: the performer's display name comes from the linked contact (never free-typed).
      const existing = await tx.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
      if (!existing) throw errors.contactNotFound();
      performerDisplayName = existing.displayName;
    }
    const [row] = await tx
      .insert(performers)
      .values({
        displayName: performerDisplayName,
        contactId,
        bio: input.bio ?? null,
        photoUrl: input.photoUrl ?? null,
        // Feature 053 (P7-R9): public roster fields.
        ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
        ...(input.isCaller !== undefined ? { isCaller: input.isCaller } : {}),
        ...(input.styles !== undefined ? { styles: input.styles } : {}),
        ...(input.links !== undefined ? { links: input.links } : {}),
      })
      .returning();
    if (!row) throw new Error("performer insert failed");
    return row;
  });
}

export async function listPerformers(db: Db): Promise<PerformerRow[]> {
  return db.select().from(performers);
}

export type PerformerSummary = {
  id: string;
  displayName: string;
  /** Feature 081 (FR-024): the role this performer is booked in on the event asked about, if any. */
  bookedAs?: PerformerType | null;
};

/**
 * Feature 020 US2 (FR-012): typeahead over performers by display name — ILIKE, ordered by display name.
 * ~30 performers, so a plain ILIKE (no trigram/normalized column) is ample. LIKE metacharacters in the
 * query are escaped so a stray `%`/`_` matches literally, not as a wildcard (analyze L1). Empty query
 * browses the full list ordered by display name. Returns a performer id — what a booking references.
 */
export async function searchPerformers(
  db: Db,
  q: string,
  limit = 20,
  eventId?: string,
): Promise<PerformerSummary[]> {
  const cols = { id: performers.id, displayName: performers.displayName };
  const needle = q.trim();
  const escaped = needle.replace(/[\\%_]/g, (c) => `\\${c}`);
  const found = await db
    .select(cols)
    .from(performers)
    .where(needle ? ilike(performers.displayName, `%${escaped}%`) : undefined)
    .orderBy(performers.displayName)
    .limit(limit);
  if (!eventId) return found;
  // Feature 081 (FR-024): say who is already booked on the evening, and as what.
  const booked = found.length
    ? await db
        .select({ performerId: bookings.performerId, performerType: bookings.performerType })
        .from(bookings)
        .where(
          and(
            eq(bookings.eventId, eventId),
            inArray(
              bookings.performerId,
              found.map((p) => p.id),
            ),
          ),
        )
    : [];
  const roleOf = new Map(booked.map((b) => [b.performerId, b.performerType]));
  return found.map((p) => ({ ...p, bookedAs: roleOf.get(p.id) ?? null }));
}

/**
 * Feature 020 US2 (FR-011): the email to put behind a performer's mailto link, or null. PII — the route
 * exposing this is gated by `contact.pii.read` (the Booker holds it); the booking report itself is `base`
 * and never carries emails.
 */
export async function getPerformerMailtoEmail(db: Db, performerId: string): Promise<string | null> {
  const performer = await db.query.performers.findFirst({ where: eq(performers.id, performerId) });
  if (!performer?.contactId) return null;
  const rows = await db.query.contactEmails.findMany({
    where: eq(contactEmails.contactId, performer.contactId),
  });
  return mailtoEmailFor(
    rows.map((r) => ({ email: r.email, purposes: r.purposes, status: r.status })),
  );
}

export type PerformerDetail = PerformerRow & {
  appearanceCount: number;
  ytdEarnings: number; // dollars; excludes donated and $0
};

/** Appearance history = all bookings; YTD earnings = paid, non-donated bookings this calendar year. */
export async function getPerformer(db: Db, id: string): Promise<PerformerDetail> {
  const performer = await db.query.performers.findFirst({ where: eq(performers.id, id) });
  if (!performer) throw errors.performerNotFound();

  const [appearances] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(eq(bookings.performerId, id));

  const year = new Date().getUTCFullYear();
  const [earned] = await db
    .select({ total: sql<number>`coalesce(sum(${bookings.payCents}), 0)::int` })
    .from(bookings)
    .innerJoin(events, eq(events.id, bookings.eventId))
    .where(
      and(
        eq(bookings.performerId, id),
        eq(bookings.isDonated, false),
        gte(events.eventDate, `${year}-01-01`),
        lte(events.eventDate, `${year}-12-31`),
      ),
    );

  return {
    ...performer,
    appearanceCount: appearances?.count ?? 0,
    ytdEarnings: centsToDollars(earned?.total ?? 0),
  };
}

export async function patchPerformer(
  db: Db,
  id: string,
  input: PerformerPatchInput,
): Promise<PerformerRow> {
  const [row] = await db
    .update(performers)
    .set({
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl } : {}),
      // Feature 053 (P7-R9): public roster fields.
      ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
      ...(input.isCaller !== undefined ? { isCaller: input.isCaller } : {}),
      ...(input.styles !== undefined ? { styles: input.styles } : {}),
      ...(input.links !== undefined ? { links: input.links } : {}),
      updatedAt: new Date(),
    })
    .where(eq(performers.id, id))
    .returning();
  if (!row) throw errors.performerNotFound();
  return row;
}
