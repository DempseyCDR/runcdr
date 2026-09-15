import { boolean, integer, pgTable, smallint, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import { events, series } from "./events";

export const attendance = pgTable("attendance", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  // Feature 017 (B35): children accompanying the parent on this check-in. Counted as paying via
  // events.attendance_count; the row is for roster display and correct decrement on correction.
  childrenCount: integer("children_count").notNull().default(0),
  // Feature 017 (B36): this check-in is an open-band musician (community_dance only). Roster marker;
  // the persisted comp quantity lives on door_records.open_band_count (this row purges at 90 days).
  isOpenBand: boolean("is_open_band").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quarterlyAttendanceCounts = pgTable(
  "quarterly_attendance_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => series.id),
    year: integer("year").notNull(),
    quarter: smallint("quarter").notNull(),
    attendeeCount: integer("attendee_count").notNull().default(0),
  },
  (t) => ({
    uniqQuarter: unique().on(t.seriesId, t.year, t.quarter),
  }),
);

/**
 * Feature 079 (research R2): what an event's check-ins said, kept after the purge deletes them — children,
 * and booked performers checked in by kind. Written ONLY by the purge, which adds what it is about to
 * delete; the attendance breakdown is this plus what the check-ins still present say.
 */
export const eventAttendanceRollups = pgTable("event_attendance_rollups", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => events.id, { onDelete: "cascade" }),
  childrenCount: integer("children_count").notNull().default(0),
  callerCount: integer("caller_count").notNull().default(0),
  bandCount: integer("band_count").notNull().default(0),
  soundTechCount: integer("sound_tech_count").notNull().default(0),
  instructorCount: integer("instructor_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AttendanceRow = typeof attendance.$inferSelect;
export type EventAttendanceRollupRow = typeof eventAttendanceRollups.$inferSelect;
export type QuarterlyAttendanceCountRow = typeof quarterlyAttendanceCounts.$inferSelect;
