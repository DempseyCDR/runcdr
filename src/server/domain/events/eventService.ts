import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import {
  attendance,
  doorRecords,
  eventGroups,
  events,
  gateSales,
  performerPayments,
  series,
} from "@/server/db/schema";
import type { EventGroupRow, EventRow, EventStatus } from "@/server/db/schema";
import { eventHasLiveSettlement } from "@/server/domain/payments/performerPaymentService";
import { errors } from "@/server/lib/apiError";
import { assertScope, assertEventScope } from "@/server/auth/can";
import type { Actor } from "@/server/auth/actor";
import { writeAudit } from "@/server/lib/audit";
import { isEmptyDoorRecord } from "@/server/domain/door/calc";
import type { EventCreateInput, EventGroupCreateInput } from "@/server/validation/door";

export async function listSeries(db: Db): Promise<{ id: string; key: string; name: string }[]> {
  return db.select({ id: series.id, key: series.key, name: series.name }).from(series);
}

/**
 * Feature 020 US4 (FR-018): defaults for a NEW single event — the venue and start time of the latest event
 * in the same series with `event_date < beforeDate`. Nulls when there is no prior event. Recurrence
 * generation does not use this (it takes explicit venue/start time). Isolated so the "prior" rule can be
 * revised in one place (spec Assumptions).
 */
export async function priorEventDefaults(
  db: Db,
  seriesId: string,
  beforeDate: string,
): Promise<{ venueId: string | null; startTime: string | null }> {
  const [row] = await db
    .select({ venueId: events.venueId, startTime: events.startTime })
    .from(events)
    .where(and(eq(events.seriesId, seriesId), lt(events.eventDate, beforeDate)))
    .orderBy(desc(events.eventDate))
    .limit(1);
  return { venueId: row?.venueId ?? null, startTime: row?.startTime ?? null };
}

export async function listEventGroups(db: Db): Promise<EventGroupRow[]> {
  return db.select().from(eventGroups);
}

export async function createEventGroup(
  db: Db,
  input: EventGroupCreateInput,
): Promise<EventGroupRow> {
  const [row] = await db
    .insert(eventGroups)
    .values({ name: input.name, kind: input.kind })
    .returning();
  if (!row) throw new Error("event group insert failed");
  return row;
}

export async function createEvent(
  db: Db,
  input: EventCreateInput,
  actor?: Actor,
): Promise<EventRow> {
  const s = await db.query.series.findFirst({ where: eq(series.key, input.seriesKey) });
  if (!s) throw errors.seriesNotFound();

  if (input.groupId) {
    const g = await db.query.eventGroups.findFirst({ where: eq(eventGroups.id, input.groupId) });
    if (!g) throw errors.eventGroupNotFound();
  }

  // Layer 2 (research R5): the scoped check lands HERE, where the target is finally known — the route
  // wrapper only saw `seriesKey`, a string, and could not have resolved it without reading the body it
  // may only read once. Series and group are passed as independent filters, never a tree.
  if (actor) assertScope(actor, "event.write", { seriesId: s.id, groupId: input.groupId ?? null });

  const [row] = await db
    .insert(events)
    .values({
      seriesId: s.id,
      groupId: input.groupId ?? null,
      eventDate: input.eventDate,
      chargesAdmission: input.chargesAdmission,
      label: input.label ?? null,
      startTime: input.startTime ?? null,
      description: input.description ?? null,
    })
    .returning();
  if (!row) throw new Error("event insert failed");
  return row;
}

/**
 * Set/clear an event's editable fields. Only provided keys are applied; null clears (feature 013 display
 * fields; feature 018 adds eventDate reschedule, status cancel/revive, and the advertised price). The
 * FIELD-LEVEL authorization (which role may write which field) is enforced by `assertFields` in the route
 * before this is called.
 */
export async function updateEventDetails(
  db: Db,
  eventId: string,
  input: {
    label?: string | null;
    startTime?: string | null;
    description?: string | null;
    /** Feature 087 (FR-014): the Booker's private note. */
    note?: string | null;
    eventDate?: string;
    status?: EventStatus;
    advertisedPriceCents?: number | null;
  },
): Promise<void> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();
  await db
    .update(events)
    .set({
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.eventDate !== undefined ? { eventDate: input.eventDate } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.advertisedPriceCents !== undefined
        ? { advertisedPriceCents: input.advertisedPriceCents }
        : {}),
    })
    .where(eq(events.id, eventId));
}

/**
 * Feature 018 (B25): hard-delete an event, but ONLY when it has no history. Refuses (409) if the event has
 * a door record, any attendance row, or a booking with a check number (an actual recorded payment — a
 * non-zero booked rate alone does not block). For a real event that will not happen, use cancel (status).
 */
/**
 * Feature 019 US4 (FR-017..FR-020): delete an event that has NO real history. History means real
 * financial or booking substance: a non-EMPTY door record (any gate sale or non-zero money/count — the
 * seed float excluded), a booking with a check number, or a recorded performer payment. Each blocker is
 * NAMED in the refusal. Attendance no longer hard-blocks (FR-018): it is discarded on an explicit
 * confirm (FR-018a), and until then the count is surfaced. Everything cascades on delete.
 */
export async function deleteEvent(
  db: Db,
  eventId: string,
  actor: string | null = null,
  authz?: Actor,
  opts: { confirmDiscardAttendance?: boolean } = {},
): Promise<void> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();
  if (authz) {
    assertEventScope(authz, "event.write", { seriesId: event.seriesId, groupId: event.groupId });
  }

  // Blocker 1: a non-empty door record (real takings). An empty one is not history (FR-017).
  const door = await db.query.doorRecords.findFirst({ where: eq(doorRecords.eventId, eventId) });
  if (door) {
    const saleCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(gateSales)
      .where(eq(gateSales.doorRecordId, door.id));
    if (!isEmptyDoorRecord(door, saleCount[0]?.n ?? 0))
      throw errors.eventHasHistory("gate takings");
  }
  // Blocker 2 (feature 019): a recorded performer payment. (The old booking-side "check number" blocker
  // was removed in feature 021 — check numbers live only on performer_payments now, which this covers.)
  const payment = await db.query.performerPayments.findFirst({
    where: eq(performerPayments.eventId, eventId),
  });
  if (payment) throw errors.eventHasHistory("a recorded performer payment");
  // Blocker 2b (feature 023, H1 / FR-013): a booking of THIS event settled by a LIVE payment — including a
  // cross-event check recorded at another event. Without this, deleting the event would silently orphan the
  // paid line and break the check's line-sum total.
  if (await eventHasLiveSettlement(db, eventId))
    throw errors.eventHasHistory("a performer payment settling a booking");

  // Attendance no longer blocks — but is confirmed before being discarded (FR-018a).
  const attendanceCount = await db
    .select({ attendees: sql<number>`count(*)::int` })
    .from(attendance)
    .where(eq(attendance.eventId, eventId));
  const attendees = attendanceCount[0]?.attendees ?? 0;
  if (attendees > 0 && !opts.confirmDiscardAttendance) {
    throw errors.eventHasAttendance(attendees);
  }

  await db.delete(events).where(eq(events.id, eventId)); // FK cascades: door record, attendance, bookings
  writeAudit({ kind: "event.deleted", actor, details: { eventId, discardedAttendees: attendees } });
}

/**
 * Feature 018 (B26): the dates a recurrence run generates — from `firstDate`, stepping every
 * `everyNWeeks` weeks, through `lastDate` inclusive. Pure (UTC math, no TZ drift); empty when the range
 * yields nothing (e.g. last before first).
 */
export function recurringDates(firstDate: string, everyNWeeks: number, lastDate: string): string[] {
  const dates: string[] = [];
  const stepMs = everyNWeeks * 7 * 86_400_000;
  const last = new Date(`${lastDate}T00:00:00Z`).getTime();
  for (let t = new Date(`${firstDate}T00:00:00Z`).getTime(); t <= last; t += stepMs) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

const RECURRENCE_CAP = 60;

/**
 * Feature 018 (B26): generate many INDEPENDENT event rows over a date range (no live recurrence rule).
 * Refuses (422) a run that would exceed the per-run cap; an empty range creates nothing.
 */
export async function generateRecurringEvents(
  db: Db,
  input: {
    seriesKey: string;
    firstDate: string;
    lastDate: string;
    everyNWeeks: number;
    startTime?: string;
    groupId?: string;
    chargesAdmission: boolean;
  },
  actor?: Actor,
): Promise<EventRow[]> {
  const s = await db.query.series.findFirst({ where: eq(series.key, input.seriesKey) });
  if (!s) throw errors.seriesNotFound();
  if (input.groupId) {
    const g = await db.query.eventGroups.findFirst({ where: eq(eventGroups.id, input.groupId) });
    if (!g) throw errors.eventGroupNotFound();
  }
  if (actor) assertScope(actor, "event.write", { seriesId: s.id, groupId: input.groupId ?? null });

  const dates = recurringDates(input.firstDate, input.everyNWeeks, input.lastDate);
  if (dates.length === 0) return [];
  if (dates.length > RECURRENCE_CAP) throw errors.recurrenceTooLarge(RECURRENCE_CAP);

  const rows = await db
    .insert(events)
    .values(
      dates.map((eventDate) => ({
        seriesId: s.id,
        groupId: input.groupId ?? null,
        eventDate,
        chargesAdmission: input.chargesAdmission,
        startTime: input.startTime ?? null,
      })),
    )
    .returning();
  writeAudit({
    kind: "event.generated",
    actor: null,
    details: { seriesKey: input.seriesKey, count: rows.length },
  });
  return rows;
}

export async function listEvents(db: Db, from?: string, to?: string): Promise<EventRow[]> {
  const conds = [];
  if (from) conds.push(gte(events.eventDate, from));
  if (to) conds.push(lte(events.eventDate, to));
  // Feature 025 US2 (FR-012): newest-relevant-first — by date then start time, descending. NULL start
  // times sort last within a day so a timed event outranks an untimed one.
  const order = [desc(events.eventDate), sql`${events.startTime} desc nulls last`];
  return conds.length
    ? db
        .select()
        .from(events)
        .where(and(...conds))
        .orderBy(...order)
    : db
        .select()
        .from(events)
        .orderBy(...order);
}

/**
 * Feature 025 US1/US2 (FR-010): the OTHER events sharing this event's non-null `group_id` — the valid
 * targets for a roster move (e.g. a same-day community-dance ↔ contra pair). Empty when the event is
 * ungrouped. Ordered by date then start time so the door surface can list them predictably.
 */
export async function getGroupSiblings(
  db: Db,
  eventId: string,
): Promise<
  {
    id: string;
    eventDate: string;
    startTime: string | null;
    seriesKey: string;
    label: string | null;
  }[]
> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();
  if (!event.groupId) return [];
  return db
    .select({
      id: events.id,
      eventDate: events.eventDate,
      startTime: events.startTime,
      seriesKey: series.key,
      label: events.label,
    })
    .from(events)
    .innerJoin(series, eq(series.id, events.seriesId))
    .where(and(eq(events.groupId, event.groupId), sql`${events.id} <> ${eventId}`))
    .orderBy(desc(events.eventDate), sql`${events.startTime} desc nulls last`);
}
