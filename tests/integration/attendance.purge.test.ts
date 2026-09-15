import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makePerformer } from "./helpers/factories";
import {
  attendance,
  eventAttendanceRollups,
  events,
  quarterlyAttendanceCounts,
  series,
} from "@/server/db/schema";
import { purgeOldAttendance } from "@/server/domain/attendance/retentionService";
import { recordAttendance } from "@/server/domain/attendance/attendanceService";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { getAttendanceBreakdown } from "@/server/domain/attendance/breakdownService";

// FR-011
describe("purgeOldAttendance", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function seedOldAttendance(eventId: string, n: number) {
    for (let i = 0; i < n; i++) {
      await db.insert(attendance).values({ eventId, contactId: null });
    }
    // age all attendance for this event past the 90-day window
    await db
      .update(attendance)
      .set({ createdAt: sql`now() - interval '100 days'` })
      .where(eq(attendance.eventId, eventId));
  }

  it("rolls >90-day attendance into quarterly counts, deletes rows, and is idempotent", async () => {
    // event in Q2 2026 (June)
    const evt = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    await seedOldAttendance(evt.id, 5);

    const first = await purgeOldAttendance(db);
    expect(first.rolledUp).toBe(5);
    expect(first.purged).toBe(5);

    const tnc = await db.query.series.findFirst({ where: eq(series.key, "tnc") });
    const counts = await db
      .select()
      .from(quarterlyAttendanceCounts)
      .where(eq(quarterlyAttendanceCounts.seriesId, tnc!.id));
    expect(counts).toHaveLength(1);
    expect(counts[0]?.year).toBe(2026);
    expect(counts[0]?.quarter).toBe(2);
    expect(counts[0]?.attendeeCount).toBe(5);

    // rows deleted
    const remaining = await db.select().from(attendance).where(eq(attendance.eventId, evt.id));
    expect(remaining).toHaveLength(0);

    // idempotent: second run changes nothing, count unchanged
    const second = await purgeOldAttendance(db);
    expect(second.purged).toBe(0);
    const countsAfter = await db
      .select()
      .from(quarterlyAttendanceCounts)
      .where(eq(quarterlyAttendanceCounts.seriesId, tnc!.id));
    expect(countsAfter[0]?.attendeeCount).toBe(5);
  });

  /**
   * Feature 079 (FR-029, SC-006; research R2). The purge deletes the check-ins that children and checked-in
   * performers are counted from, so it first rolls them up — and an event's breakdown must not move.
   */
  describe("keeps an event's attendance breakdown (079)", () => {
    async function evening() {
      const evt = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
      for (const [name, kind] of [
        ["Cal Caller", "caller"],
        ["Mo Musician", "musician"],
        ["Sam Sound", "sound_tech"],
      ] as const) {
        const p = await makePerformer(name);
        await createBooking(db, evt.id, { performerId: p.id, performerType: kind, pay: 0 });
        await recordAttendance(db, evt.id, { contactId: p.contactId! });
      }
      await recordAttendance(db, evt.id, { unmatched: true, childrenCount: 3, isComp: true });
      for (let i = 0; i < 10; i++) await recordAttendance(db, evt.id, { unmatched: true });
      return evt;
    }
    const age = (where: ReturnType<typeof sql>) =>
      db
        .update(attendance)
        .set({ createdAt: sql`now() - interval '100 days'` })
        .where(where);

    it("is identical before and after the purge", async () => {
      const evt = await evening();
      const before = await getAttendanceBreakdown(db, evt.id);
      expect(before.performers).toEqual({ caller: 1, band: 1, soundTech: 1, instructor: 0 });

      await age(sql`${attendance.eventId} = ${evt.id}`);
      await purgeOldAttendance(db);
      expect(await db.select().from(attendance).where(eq(attendance.eventId, evt.id))).toEqual([]);
      expect(await getAttendanceBreakdown(db, evt.id)).toEqual(before);
    });

    it("adds, rather than overwrites, when an evening's check-ins are purged across two runs", async () => {
      const evt = await evening();
      const before = await getAttendanceBreakdown(db, evt.id);

      // The first run catches the performers and the family; the second, everyone else.
      await age(
        sql`${attendance.eventId} = ${evt.id} AND (${attendance.contactId} IS NOT NULL OR ${attendance.childrenCount} > 0)`,
      );
      await purgeOldAttendance(db);
      expect(await getAttendanceBreakdown(db, evt.id)).toEqual(before);

      await age(sql`${attendance.eventId} = ${evt.id}`);
      await purgeOldAttendance(db);
      expect(await getAttendanceBreakdown(db, evt.id)).toEqual(before);

      const again = await purgeOldAttendance(db);
      expect(again.purged).toBe(0);
      expect(await getAttendanceBreakdown(db, evt.id)).toEqual(before);
    });

    it("goes with its event", async () => {
      const evt = await evening();
      await age(sql`${attendance.eventId} = ${evt.id}`);
      await purgeOldAttendance(db);
      expect(
        await db
          .select()
          .from(eventAttendanceRollups)
          .where(eq(eventAttendanceRollups.eventId, evt.id)),
      ).toHaveLength(1);
      await db.delete(events).where(eq(events.id, evt.id));
      expect(await db.select().from(eventAttendanceRollups)).toEqual([]);
    });
  });
});
