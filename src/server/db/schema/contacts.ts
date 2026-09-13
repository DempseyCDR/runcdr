import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { membershipStatusEnum } from "./enums";

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Structured names (feature 012): first_name required, last_name optional (dancers may decline one).
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  // Optional override; when non-blank it is the effective display name.
  displayNameOverride: text("display_name_override"),
  pronouns: text("pronouns"),
  // display_name is the MAINTAINED effective display name (override, else "first last"); used by all
  // name-display readers. name_normalized is the search key; dedup_normalized is the dedup key.
  displayName: text("display_name").notNull(),
  nameNormalized: text("name_normalized").notNull(),
  dedupNormalized: text("dedup_normalized").notNull(),
  membershipStatus: membershipStatusEnum("membership_status").notNull().default("never"),
  listMember: boolean("list_member").notNull().default(false),
  statusRecomputedAt: timestamp("status_recomputed_at", { withTimezone: true }),
  // Eligibility to sign in (feature 015). Roles themselves moved OUT of this row in feature 016:
  // scope cannot live in an array, so they are `role_grants` rows keyed by contact_id.
  isVolunteer: boolean("is_volunteer").notNull().default(false),
  // Annual Presidential review (feature 016, FR-034). ADVISORY: nothing on the session path may read
  // these — doing so would turn a governance ritual into a lockout on a forgotten meeting.
  volunteerApprovedAt: timestamp("volunteer_approved_at", { withTimezone: true }),
  volunteerApprovedBy: uuid("volunteer_approved_by"),
  // ⚠️ Feature 077: the database FK is ON DELETE CASCADE (migration 0048) — deleting a survivor deletes every
  // contact merged into it, down the chain. Never SET NULL: null here is what marks a contact ACTIVE, so
  // nulling it would resurrect merged-away duplicates. The safe delete refuses a survivor with any.
  mergedIntoId: uuid("merged_into_id"),
  // Feature 065 (M-R9): reversible soft-archive marker (mirrors bands.archived_at). Archived ⇔ non-null;
  // excluded from every active-contact read, independent of merged_into_id.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  // Feature 067 (M-R23): shared/family email pointer. A contact with no owned address may RIDE another
  // contact's owned email as its message recipient. On `contacts` — not `contact_emails` — so active-email
  // uniqueness, sign-in, and is_login stay owner-only by construction (M-R24/M-R25).
  messageRecipientEmailId: uuid("message_recipient_email_id"),
  needsReview: boolean("needs_review").notNull().default(false),
  source: text("source"),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ContactRow = typeof contacts.$inferSelect;
export type NewContactRow = typeof contacts.$inferInsert;
