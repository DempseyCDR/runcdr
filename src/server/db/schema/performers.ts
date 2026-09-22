import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import type { PromoLink } from "@/server/domain/public/promoLinks";

export const performers = pgTable("performers", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  bio: text("bio"),
  photoUrl: text("photo_url"),
  // Feature 053 (P7-R9): public roster fields. is_public opts the performer into public exposure; is_caller
  // lists them individually in the callers roster; styles/links drive grouping + promo links (see promoLinks.ts).
  isPublic: boolean("is_public").notNull().default(false),
  isCaller: boolean("is_caller").notNull().default(false),
  styles: text("styles").array().notNull().default([]),
  links: jsonb("links").$type<PromoLink[]>().notNull().default([]),
  // Feature 084: retired without deleting — null means active, as on bands. Reads that OFFER a
  // record gate on it; reads that REPORT one (history) deliberately do not.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PerformerRow = typeof performers.$inferSelect;
