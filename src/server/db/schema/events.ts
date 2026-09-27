import { boolean, date, integer, pgTable, text, time, timestamp, uuid } from "drizzle-orm/pg-core";
import { venues } from "./venues";
import { eventStatusEnum } from "./enums";

export const series = pgTable("series", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  hasSoundTech: boolean("has_sound_tech").notNull().default(true),
  // Feature 054 (P7-R10): curated standing-schedule sentence (no recurrence engine; carries the DST note).
  scheduleSentence: text("schedule_sentence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eventGroups = pgTable("event_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Free-text, optional category (feature 010; was the event_group_kind enum).
  kind: text("kind"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  seriesId: uuid("series_id")
    .notNull()
    .references(() => series.id),
  groupId: uuid("group_id").references(() => eventGroups.id),
  venueId: uuid("venue_id").references(() => venues.id, { onDelete: "set null" }),
  eventDate: date("event_date").notNull(),
  // Display/identification fields (feature 013), all optional. start_time is a venue-local wall-clock
  // time (no time zone); label distinguishes same-day group members; description is a public blurb.
  label: text("label"),
  startTime: time("start_time"),
  description: text("description"),
  // Feature 087 (FR-014): the Booker's PRIVATE note on a dance. Never the public blurb above — a note
  // typed into `description` would be published (FR-016). Named to match `bookings.note`.
  note: text("note"),
  chargesAdmission: boolean("charges_admission").notNull().default(true),
  // Feature 018 (B25): cancelled is a retained, public-visible state (not a delete).
  status: eventStatusEnum("status").notNull().default("scheduled"),
  // Feature 018 (B27): public display admission price; NEVER an accounting input. Nullable = not shown.
  advertisedPriceCents: integer("advertised_price_cents"),
  // Per-event rent override / direct rent (feature 011). NULL = resolve from venue_rents layers.
  rentCents: integer("rent_cents"),
  // Persisted per-event attendance count (survives the 90-day purge); source for paying dancers.
  attendanceCount: integer("attendance_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SeriesRow = typeof series.$inferSelect;
export type EventGroupRow = typeof eventGroups.$inferSelect;
export type EventRow = typeof events.$inferSelect;
