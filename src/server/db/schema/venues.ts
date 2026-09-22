import { boolean, doublePrecision, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";

export const venues = pgTable("venues", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Feature 020 (US5): compact label for the bookings report. Display-only, non-unique; defaults to the
  // name's initials (venueShortNameDefault), with a runtime fallback to those initials when null.
  shortName: text("short_name"),
  address: text("address").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  // Feature 052 (P7-R8): opt-in public exposure (default off) + a public directions/transit/parking note.
  // A venue's address/map/directions are exposed publicly ONLY when is_public AND it has an address.
  isPublic: boolean("is_public").notNull().default(false),
  directions: text("directions"),
  // Feature 018 (B22): optional landlord contact (the party the Booker negotiates rent with).
  landlordContactId: uuid("landlord_contact_id").references(() => contacts.id, {
    onDelete: "set null",
  }),
  // Feature 084: retired without deleting — null means active, as on bands. Reads that OFFER a
  // record gate on it; reads that REPORT one (history) deliberately do not.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VenueRow = typeof venues.$inferSelect;
