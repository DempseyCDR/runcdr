import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db, Tx } from "@/server/db/client";
import {
  attendance,
  bookings,
  contactEmails,
  contacts,
  doorRecords,
  events,
  performers,
  series,
} from "@/server/db/schema";
import type { AttendanceRow } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { writeAudit } from "@/server/lib/audit";
import { deriveContactNames } from "@/server/domain/contacts/normalize";
import { normalizePhone } from "@/server/domain/contacts/phone";
import { ensureDoorRecord } from "@/server/domain/door/doorRecordService";
import { linkMessageRecipientIn } from "@/server/domain/contacts/referenceService";
import type { AttendanceInput, AttendancePatchInput } from "@/server/validation/attendance";

const UNIQUE_VIOLATION = "23505";

/**
 * Record attendance against an event (not a door record). Three paths: existing
 * contact, new door-created contact (flagged needs_review), or unmatched.
 *
 * Feature 079: one transaction. A door-created contact, its email or shared-address link, the check-in and
 * the counts land together or not at all — so a refused check-in never leaves a half-made contact behind.
 */
export async function recordAttendance(
  db: Db,
  eventId: string,
  input: AttendanceInput,
  actor: string | null = null,
): Promise<AttendanceRow> {
  return db.transaction((tx) => recordAttendanceIn(tx, eventId, input, actor));
}

async function recordAttendanceIn(
  db: Tx,
  eventId: string,
  input: AttendanceInput,
  actor: string | null,
): Promise<AttendanceRow> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();

  // B36: an open-band musician is flagged manually at check-in (never sourced from bookings).
  const isOpenBand = "isOpenBand" in input ? (input.isOpenBand ?? false) : false;
  if (isOpenBand) {
    // FR-022: the open-band rule is the community_dance series' own; reject it elsewhere.
    const evtSeries = await db.query.series.findFirst({ where: eq(series.id, event.seriesId) });
    if (evtSeries?.key !== "community_dance") {
      throw errors.validation("Open-band musicians can only be checked in at a community dance.");
    }
  }

  let contactId: string | null = null;

  if ("contactId" in input) {
    contactId = input.contactId;
    const dup = await db.query.attendance.findFirst({
      where: and(eq(attendance.eventId, eventId), eq(attendance.contactId, contactId)),
    });
    if (dup) throw errors.alreadyCheckedIn();
    // FR-022a: a booked performer is already counted in the performer subtraction; flagging them as an
    // unpaid open-band comp too would double-subtract from paying dancers.
    if (isOpenBand) {
      const booked = await db
        .select({ id: bookings.id })
        .from(bookings)
        .innerJoin(performers, eq(performers.id, bookings.performerId))
        .where(and(eq(bookings.eventId, eventId), eq(performers.contactId, contactId)))
        .limit(1);
      if (booked.length > 0) {
        throw errors.validation(
          "A booked performer cannot also be checked in as an open-band musician.",
        );
      }
    }
  } else if ("newContact" in input) {
    const { email, shareEmail } = input.newContact;
    // Feature 079 (FR-016, research R6): an address already reaching someone else is a question, not a
    // detail to drop. Ask BEFORE writing anything; with `shareEmail` the answer is "a different person who
    // shares it", so the new contact rides that address instead of owning it.
    const owner = email ? await ownerOfEmail(db, email) : null;
    if (owner && !shareEmail) throw errors.emailActiveElsewhere(owner);

    const names = deriveContactNames({
      firstName: input.newContact.firstName,
      lastName: input.newContact.lastName ?? null,
      displayNameOverride: input.newContact.displayNameOverride ?? null,
    });
    const [created] = await db
      .insert(contacts)
      .values({
        firstName: input.newContact.firstName,
        lastName: input.newContact.lastName ?? null,
        displayNameOverride: input.newContact.displayNameOverride ?? null,
        displayName: names.displayName,
        nameNormalized: names.nameNormalized,
        dedupNormalized: names.dedupNormalized,
        phone: input.newContact.phone ? normalizePhone(input.newContact.phone) : null, // feature 032
        needsReview: true,
        source: "door",
      })
      .returning();
    if (!created) throw new Error("contact insert failed");
    contactId = created.id;

    if (owner) {
      // Linking at creation needs no `contact.mailing.write`: it records the walk-in's address, which the
      // door attendant already may — the contact simply rides the address rather than owning it (R6).
      await linkMessageRecipientIn(db, created.id, { emailId: owner.emailId }, actor);
    } else if (email) {
      // The owner check above is not a lock: an address claimed a moment later still reaches the unique
      // index. It is refused rather than dropped — the transaction is already aborted, so the owner cannot
      // be looked up; Meg retries and is then asked about them.
      await db
        .insert(contactEmails)
        .values({ contactId: created.id, email })
        .catch((err: unknown) => {
          if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw errors.emailDuplicate();
          throw err;
        });
    }
  }
  // else unmatched → contactId stays null

  // B35: a family checks in as the parent's row plus a children count; children are paying, so they
  // ride inside events.attendance_count (the persisted source for the report — no formula change).
  const childrenCount = "childrenCount" in input ? (input.childrenCount ?? 0) : 0;

  // Feature 079 (research R12): two attendants can both pass the "already in?" check above before either
  // inserts. The unique index refuses the second; say so the way the check would have.
  const [row] = await db
    .insert(attendance)
    .values({ eventId, contactId, childrenCount, isOpenBand })
    .returning()
    .catch((err: unknown) => {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw errors.alreadyCheckedIn();
      throw err;
    });
  if (!row) throw new Error("attendance insert failed");
  // Persisted per-event count for the organizer report; survives the 90-day purge.
  await db
    .update(events)
    .set({ attendanceCount: sql`${events.attendanceCount} + ${1 + childrenCount}` })
    .where(eq(events.id, eventId));

  // B29/B36: comp, gift-card redemption, and open-band are per-check-in booleans that MATERIALIZE into
  // persisted door-record counts (counts-only, never attributed — so nothing is stored on the row). All
  // survive the 90-day attendance purge; the FS may override comp/gift on /gate. open_band_count is kept
  // separate so the report can read effective comps = comp_count + open_band_count.
  const isComp = "isComp" in input ? (input.isComp ?? false) : false;
  const redeemedGiftCard = "redeemedGiftCard" in input ? (input.redeemedGiftCard ?? false) : false;
  if (isOpenBand || isComp || redeemedGiftCard) {
    const dr = await ensureDoorRecord(db, eventId, "door");
    await db
      .update(doorRecords)
      .set({
        ...(isOpenBand ? { openBandCount: sql`${doorRecords.openBandCount} + 1` } : {}),
        ...(isComp ? { compCount: sql`${doorRecords.compCount} + 1` } : {}),
        ...(redeemedGiftCard
          ? { giftCardRedemptionCount: sql`${doorRecords.giftCardRedemptionCount} + 1` }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(doorRecords.id, dr.id));
  }
  return row;
}

/** Who, if anyone, an address still reaches (active or in transition — what the uniqueness index guards). */
async function ownerOfEmail(
  db: Tx,
  email: string,
): Promise<{ contactId: string; displayName: string; emailId: string } | null> {
  const [hit] = await db
    .select({
      contactId: contactEmails.contactId,
      displayName: contacts.displayName,
      emailId: contactEmails.id,
    })
    .from(contactEmails)
    .innerJoin(contacts, eq(contacts.id, contactEmails.contactId))
    .where(
      and(
        sql`lower(trim(${contactEmails.email}::text)) = lower(trim(${email}))`,
        inArray(contactEmails.status, ["active", "transition"]),
      ),
    )
    .limit(1);
  return hit ?? null;
}

export type AttendeeView = {
  id: string;
  contactId: string | null;
  firstName: string | null; // null for unmatched placeholders
  lastName: string | null;
  displayName: string | null; // null for unmatched placeholders
  displayNameOverride: string | null; // feature 079: non-null means the display name is custom (076's rule)
  childrenCount: number; // B35: children on this check-in
  isOpenBand: boolean; // B36: open-band musician marker
  createdAt: string;
};

export type EventAttendanceView = {
  count: number;
  attendees: AttendeeView[];
};

/**
 * Roster sort field (B33): by first or by last name; the other name is the tiebreak. Feature 079 adds
 * `display` — the checked-in dialog's default, by the name the door shows (FR-018).
 */
export type RosterSort = "display" | "first" | "last";

/**
 * The checked-in attendee list for an event. Serves both contact-tracing (FR-001b — count + display
 * name) and the Door Attendant roster (B33 — structured first/last names, sortable). Ordered by the
 * requested name field (default last), the other name as tiebreak, unmatched placeholders last. After
 * the 90-day purge there are no attendance rows, so this returns count 0 / empty list.
 */
export async function listEventAttendance(
  db: Db,
  eventId: string,
  sort: RosterSort = "last",
): Promise<EventAttendanceView> {
  const orderBy =
    sort === "display"
      ? sql`lower(${contacts.displayName}) asc nulls last, lower(${contacts.firstName}) asc nulls last, lower(${contacts.lastName}) asc nulls last, ${attendance.createdAt} asc`
      : sort === "first"
        ? sql`lower(${contacts.firstName}) asc nulls last, lower(${contacts.lastName}) asc nulls last, ${attendance.createdAt} asc`
        : sql`lower(${contacts.lastName}) asc nulls last, lower(${contacts.firstName}) asc nulls last, ${attendance.createdAt} asc`;

  const rows = await db
    .select({
      id: attendance.id,
      contactId: attendance.contactId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      displayName: contacts.displayName,
      displayNameOverride: contacts.displayNameOverride,
      childrenCount: attendance.childrenCount,
      isOpenBand: attendance.isOpenBand,
      createdAt: attendance.createdAt,
    })
    .from(attendance)
    .leftJoin(contacts, eq(contacts.id, attendance.contactId))
    .where(eq(attendance.eventId, eventId))
    .orderBy(orderBy);

  const attendees: AttendeeView[] = rows.map((r) => ({
    id: r.id,
    contactId: r.contactId,
    firstName: r.firstName ?? null,
    lastName: r.lastName ?? null,
    displayName: r.displayName ?? null,
    displayNameOverride: r.displayNameOverride ?? null,
    childrenCount: r.childrenCount,
    isOpenBand: r.isOpenBand,
    createdAt: r.createdAt.toISOString(),
  }));
  return { count: attendees.length, attendees };
}

// ---- Feature 025 US1: per-record roster corrections. The denormalized events.attendance_count (and, for
// open-band, door_records.open_band_count) MUST stay exact after every operation. attendance.write only
// (the route enforces it); each op is audited. ----

/** Adjust a door record's open_band_count by ±1 (floor 0), ensuring the record. */
async function bumpOpenBand(db: Db, eventId: string, delta: 1 | -1, actor: string | null) {
  const dr = await ensureDoorRecord(db, eventId, actor);
  await db
    .update(doorRecords)
    .set({
      openBandCount: sql`greatest(0, ${doorRecords.openBandCount} + ${delta})`,
      updatedAt: new Date(),
    })
    .where(eq(doorRecords.id, dr.id));
}

/** Is this contact a booked performer on the event? (mirrors recordAttendance's open-band guard.) */
async function isBookedPerformer(db: Db, eventId: string, contactId: string): Promise<boolean> {
  const booked = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(performers, eq(performers.id, bookings.performerId))
    .where(and(eq(bookings.eventId, eventId), eq(performers.contactId, contactId)))
    .limit(1);
  return booked.length > 0;
}

/** FR-002: delete a not-present admission; `attendance_count -= (1 + children)`; release open-band if set. */
export async function deleteAttendance(
  db: Db,
  id: string,
  actor: string | null = null,
): Promise<void> {
  const row = await db.query.attendance.findFirst({ where: eq(attendance.id, id) });
  if (!row) throw errors.attendanceNotFound();
  await db.delete(attendance).where(eq(attendance.id, id));
  await db
    .update(events)
    .set({
      attendanceCount: sql`greatest(0, ${events.attendanceCount} - ${1 + row.childrenCount})`,
    })
    .where(eq(events.id, row.eventId));
  if (row.isOpenBand) await bumpOpenBand(db, row.eventId, -1, actor);
  writeAudit({
    kind: "attendance.deleted",
    actor,
    details: { attendanceId: id, eventId: row.eventId },
  });
}

/**
 * FR-003/004/008: edit children (head count moves by the delta), reassign an unmatched admission to a contact
 * (refused if that contact is already on the event), and/or toggle open-band (community-dance-only + not a
 * booked performer; moves door_records.open_band_count ±1). Head count is unchanged by reassign/open-band.
 */
export async function patchAttendance(
  db: Db,
  id: string,
  input: AttendancePatchInput,
  actor: string | null = null,
): Promise<AttendanceRow> {
  const row = await db.query.attendance.findFirst({ where: eq(attendance.id, id) });
  if (!row) throw errors.attendanceNotFound();

  if (input.contactId !== undefined && input.contactId !== row.contactId) {
    const dup = await db.query.attendance.findFirst({
      where: and(eq(attendance.eventId, row.eventId), eq(attendance.contactId, input.contactId)),
    });
    if (dup) throw errors.alreadyCheckedIn();
  }

  let openBandDelta: 1 | -1 | 0 = 0;
  if (input.isOpenBand !== undefined && input.isOpenBand !== row.isOpenBand) {
    if (input.isOpenBand) {
      const event = await db.query.events.findFirst({ where: eq(events.id, row.eventId) });
      const evtSeries = event
        ? await db.query.series.findFirst({ where: eq(series.id, event.seriesId) })
        : null;
      if (evtSeries?.key !== "community_dance") {
        throw errors.validation("Open-band musicians can only be marked at a community dance.");
      }
      const contactId = input.contactId ?? row.contactId;
      if (contactId && (await isBookedPerformer(db, row.eventId, contactId))) {
        throw errors.validation("A booked performer cannot also be an open-band musician.");
      }
      openBandDelta = 1;
    } else {
      openBandDelta = -1;
    }
  }

  const childrenDelta =
    input.childrenCount !== undefined ? input.childrenCount - row.childrenCount : 0;

  const [updated] = await db
    .update(attendance)
    .set({
      ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
      ...(input.childrenCount !== undefined ? { childrenCount: input.childrenCount } : {}),
      ...(input.isOpenBand !== undefined ? { isOpenBand: input.isOpenBand } : {}),
    })
    .where(eq(attendance.id, id))
    .returning();
  if (!updated) throw errors.attendanceNotFound();
  if (childrenDelta !== 0) {
    await db
      .update(events)
      .set({ attendanceCount: sql`greatest(0, ${events.attendanceCount} + ${childrenDelta})` })
      .where(eq(events.id, row.eventId));
  }
  if (openBandDelta !== 0) await bumpOpenBand(db, row.eventId, openBandDelta, actor);
  writeAudit({
    kind: "attendance.updated",
    actor,
    details: { attendanceId: id, fields: Object.keys(input) },
  });
  return updated;
}

/**
 * FR-005/006 (analyze L1/G1/G2): move an admission to a same-group sibling event. The target is
 * re-derived and validated server-side (never trust the client); a dancer already on the target is refused
 * (no duplicate); moving an open-band admission to a non-community-dance sibling clears its open-band marker
 * and releases the source open_band_count (open-band is community-dance-only). Source head count decreases
 * and the target's increases by `(1 + children)`.
 */
export async function moveAttendance(
  db: Db,
  id: string,
  toEventId: string,
  actor: string | null = null,
): Promise<AttendanceRow> {
  const row = await db.query.attendance.findFirst({ where: eq(attendance.id, id) });
  if (!row) throw errors.attendanceNotFound();
  const source = await db.query.events.findFirst({ where: eq(events.id, row.eventId) });
  const target = await db.query.events.findFirst({ where: eq(events.id, toEventId) });
  if (!source || !target) throw errors.eventNotFound();
  if (!source.groupId || target.groupId !== source.groupId || target.id === source.id) {
    throw errors.validation("The move target must be another event in the same group.");
  }
  if (row.contactId) {
    const dup = await db.query.attendance.findFirst({
      where: and(eq(attendance.eventId, toEventId), eq(attendance.contactId, row.contactId)),
    });
    if (dup) throw errors.alreadyCheckedIn();
  }
  const targetSeries = await db.query.series.findFirst({ where: eq(series.id, target.seriesId) });
  const targetIsCommunityDance = targetSeries?.key === "community_dance";
  const clearsOpenBand = row.isOpenBand && !targetIsCommunityDance;
  const headDelta = 1 + row.childrenCount;

  const [moved] = await db
    .update(attendance)
    .set({ eventId: toEventId, ...(clearsOpenBand ? { isOpenBand: false } : {}) })
    .where(eq(attendance.id, id))
    .returning();
  if (!moved) throw errors.attendanceNotFound();
  await db
    .update(events)
    .set({ attendanceCount: sql`greatest(0, ${events.attendanceCount} - ${headDelta})` })
    .where(eq(events.id, row.eventId));
  await db
    .update(events)
    .set({ attendanceCount: sql`${events.attendanceCount} + ${headDelta}` })
    .where(eq(events.id, toEventId));
  if (row.isOpenBand) {
    await bumpOpenBand(db, row.eventId, -1, actor); // release from the source
    if (!clearsOpenBand) await bumpOpenBand(db, toEventId, 1, actor); // carry to a community-dance target
  }
  writeAudit({
    kind: "attendance.updated",
    actor,
    details: { attendanceId: id, movedFrom: row.eventId, movedTo: toEventId },
  });
  return moved;
}
