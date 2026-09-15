import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/client";
import {
  attendance,
  bookings,
  contacts,
  doorRecords,
  eventAttendanceRollups,
  events,
  performers,
  type PerformerType,
} from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { payingDancers } from "@/server/domain/organizer/danceResult";

export type PerformerCounts = {
  caller: number;
  band: number;
  soundTech: number;
  instructor: number;
};

/** A checked-in person booked more than once for the event — usually a booking mistake (FR-033). */
export type DoubleBooking = { contactId: string; displayName: string; kinds: PerformerType[] };

/**
 * Feature 079 (FR-022–FR-026): an event's attendance, broken down. Computed here and nowhere else — the door's
 * checked-in dialog, the gate page, the treasurer report and the organizer report all read it, so the four
 * can never disagree (FR-027, research R1).
 */
export type AttendanceBreakdown = {
  /** Everyone admitted, children included (`events.attendance_count`, kept through the purge). */
  attendance: number;
  /** attendance − performers checked in − door attendant − comps, never below zero. */
  paying: number;
  children: number;
  performers: PerformerCounts;
  doorAttendant: number;
  /** Manual comps plus open-band musicians. */
  comps: number;
  giftCards: number;
  doubleBookings: DoubleBooking[];
};

/** Each booked kind's bucket. Band is everyone playing: lead, musician, and a musician booked to lead the open band. */
const BUCKET: Record<PerformerType, keyof PerformerCounts> = {
  caller: "caller",
  lead_musician: "band",
  musician: "band",
  open_band_musician: "band",
  sound_tech: "soundTech",
  instructor: "instructor",
};
/** Which bucket wins for someone booked under several kinds (spec, Edge Cases). */
const BUCKET_ORDER: (keyof PerformerCounts)[] = ["caller", "band", "soundTech", "instructor"];
/** The enum's own order, so a double booking always lists its kinds the same way. */
const KIND_ORDER: PerformerType[] = [
  "caller",
  "lead_musician",
  "musician",
  "open_band_musician",
  "sound_tech",
  "instructor",
];

export const zeroPerformers = (): PerformerCounts => ({
  caller: 0,
  band: 0,
  soundTech: 0,
  instructor: 0,
});

/**
 * Which of these checked-in contacts are performers booked FOR THIS EVENT, and of what kind (FR-024, research
 * R3). A performer counts through their contact — once per person, under the first matching bucket — and a
 * booking in any status counts, as the organizer report always has.
 *
 * Exported because the purge must classify the check-ins it is about to delete the same way, and a second
 * copy of this rule is how the two would drift.
 */
export async function classifyCheckedInPerformers(
  db: DbOrTx,
  eventId: string,
  contactIds: string[],
): Promise<{ counts: PerformerCounts; doubleBookings: DoubleBooking[] }> {
  const counts = zeroPerformers();
  if (contactIds.length === 0) return { counts, doubleBookings: [] };

  const rows = await db
    .select({
      contactId: performers.contactId,
      kind: bookings.performerType,
      displayName: contacts.displayName,
    })
    .from(bookings)
    .innerJoin(performers, eq(performers.id, bookings.performerId))
    .innerJoin(contacts, eq(contacts.id, performers.contactId))
    .where(and(eq(bookings.eventId, eventId), inArray(performers.contactId, contactIds)));

  const byContact = new Map<string, { displayName: string; kinds: PerformerType[] }>();
  for (const r of rows) {
    const entry = byContact.get(r.contactId!) ?? { displayName: r.displayName, kinds: [] };
    entry.kinds.push(r.kind);
    byContact.set(r.contactId!, entry);
  }

  const doubleBookings: DoubleBooking[] = [];
  for (const [contactId, { displayName, kinds }] of byContact) {
    const buckets = new Set(kinds.map((k) => BUCKET[k]));
    counts[BUCKET_ORDER.find((b) => buckets.has(b))!] += 1;
    if (kinds.length > 1) {
      doubleBookings.push({
        contactId,
        displayName,
        kinds: KIND_ORDER.filter((k) => kinds.includes(k)),
      });
    }
  }
  doubleBookings.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { counts, doubleBookings };
}

export async function getAttendanceBreakdown(
  db: DbOrTx,
  eventId: string,
): Promise<AttendanceBreakdown> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();

  const [door, rollup, present] = await Promise.all([
    db.query.doorRecords.findFirst({ where: eq(doorRecords.eventId, eventId) }),
    db.query.eventAttendanceRollups.findFirst({
      where: eq(eventAttendanceRollups.eventId, eventId),
    }),
    db
      .select({
        contactId: attendance.contactId,
        children: attendance.childrenCount,
      })
      .from(attendance)
      .where(eq(attendance.eventId, eventId)),
  ]);

  // Research R2: what the purge rolled up, plus what the check-ins still present say.
  const contactIds = present.flatMap((r) => (r.contactId ? [r.contactId] : []));
  const { counts, doubleBookings } = await classifyCheckedInPerformers(db, eventId, contactIds);
  const performersCheckedIn: PerformerCounts = {
    caller: counts.caller + (rollup?.callerCount ?? 0),
    band: counts.band + (rollup?.bandCount ?? 0),
    soundTech: counts.soundTech + (rollup?.soundTechCount ?? 0),
    instructor: counts.instructor + (rollup?.instructorCount ?? 0),
  };
  const children = present.reduce((a, r) => a + r.children, 0) + (rollup?.childrenCount ?? 0);
  const comps = (door?.compCount ?? 0) + (door?.openBandCount ?? 0);
  const doorAttendant = 1;
  const performerTotal = BUCKET_ORDER.reduce((a, b) => a + performersCheckedIn[b], 0);

  return {
    attendance: event.attendanceCount,
    paying: payingDancers(event.attendanceCount, performerTotal, comps),
    children,
    performers: performersCheckedIn,
    doorAttendant,
    comps,
    giftCards: door?.giftCardRedemptionCount ?? 0,
    doubleBookings,
  };
}
