import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import {
  attendance,
  eventAttendanceRollups,
  events,
  quarterlyAttendanceCounts,
} from "@/server/db/schema";
import { classifyCheckedInPerformers } from "./breakdownService";
import { writeAudit } from "@/server/lib/audit";

const RETENTION_DAYS = 90;

/**
 * Roll up >90-day attendance into permanent quarterly counts, then delete those
 * rows — in one transaction. Idempotent: only still-present, >90-day rows are
 * counted, and they are deleted in the same transaction, so a re-run is a no-op.
 */
export async function purgeOldAttendance(db: Db): Promise<{ rolledUp: number; purged: number }> {
  return db.transaction(async (tx) => {
    const cutoff = sql`now() - interval '${sql.raw(String(RETENTION_DAYS))} days'`;

    // Aggregate purge-eligible attendance by series / year / quarter of the event date.
    const groups = await tx
      .select({
        seriesId: events.seriesId,
        year: sql<number>`extract(year from ${events.eventDate})::int`,
        quarter: sql<number>`extract(quarter from ${events.eventDate})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(attendance)
      .innerJoin(events, sql`${events.id} = ${attendance.eventId}`)
      .where(sql`${attendance.createdAt} < ${cutoff}`)
      .groupBy(
        events.seriesId,
        sql`extract(year from ${events.eventDate})`,
        sql`extract(quarter from ${events.eventDate})`,
      );

    let rolledUp = 0;
    for (const g of groups) {
      rolledUp += g.count;
      await tx
        .insert(quarterlyAttendanceCounts)
        .values({
          seriesId: g.seriesId,
          year: g.year,
          quarter: g.quarter,
          attendeeCount: g.count,
        })
        .onConflictDoUpdate({
          target: [
            quarterlyAttendanceCounts.seriesId,
            quarterlyAttendanceCounts.year,
            quarterlyAttendanceCounts.quarter,
          ],
          set: {
            attendeeCount: sql`${quarterlyAttendanceCounts.attendeeCount} + ${g.count}`,
          },
        });
    }

    // Feature 079 (research R2): the rows about to go are the only record of how many children came and which
    // booked performers were checked in. Roll those up first, ADDING to what an earlier run kept — an
    // evening's check-ins span hours, so one event's rows can straddle two runs. The breakdown classifies
    // the rows still present the same way, through the same function.
    const doomed = await tx
      .select({
        eventId: attendance.eventId,
        contactId: attendance.contactId,
        childrenCount: attendance.childrenCount,
      })
      .from(attendance)
      .where(sql`${attendance.createdAt} < ${cutoff}`);
    const byEvent = new Map<string, { children: number; contactIds: string[] }>();
    for (const r of doomed) {
      const e = byEvent.get(r.eventId) ?? { children: 0, contactIds: [] };
      e.children += r.childrenCount;
      if (r.contactId) e.contactIds.push(r.contactId);
      byEvent.set(r.eventId, e);
    }
    for (const [eventId, { children, contactIds }] of byEvent) {
      const { counts } = await classifyCheckedInPerformers(tx, eventId, contactIds);
      const add = {
        childrenCount: children,
        callerCount: counts.caller,
        bandCount: counts.band,
        soundTechCount: counts.soundTech,
        instructorCount: counts.instructor,
      };
      await tx
        .insert(eventAttendanceRollups)
        .values({ eventId, ...add })
        .onConflictDoUpdate({
          target: eventAttendanceRollups.eventId,
          set: {
            childrenCount: sql`${eventAttendanceRollups.childrenCount} + ${add.childrenCount}`,
            callerCount: sql`${eventAttendanceRollups.callerCount} + ${add.callerCount}`,
            bandCount: sql`${eventAttendanceRollups.bandCount} + ${add.bandCount}`,
            soundTechCount: sql`${eventAttendanceRollups.soundTechCount} + ${add.soundTechCount}`,
            instructorCount: sql`${eventAttendanceRollups.instructorCount} + ${add.instructorCount}`,
            updatedAt: new Date(),
          },
        });
    }

    const deleted = await tx
      .delete(attendance)
      .where(sql`${attendance.createdAt} < ${cutoff}`)
      .returning({ id: attendance.id });

    writeAudit({
      kind: "attendance.purge",
      actor: null,
      details: { rolledUp, purged: deleted.length },
    });
    return { rolledUp, purged: deleted.length };
  });
}
