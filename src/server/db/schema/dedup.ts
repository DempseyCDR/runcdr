import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";

// Feature 069 (M-R21): a merge the survivor cannot absorb — two sign-in identities, or two membership
// accounts. Structurally one problem: only one of the thing may survive, so a person must choose.
export const heldMergeReasonEnum = pgEnum("held_merge_reason", [
  "two_logins",
  "two_accounts",
  "role_conflict",
  // Feature 078: the merged contact is a volunteer and the survivor is not — an officer decides.
  "volunteer_status",
  // Feature 078: the merged contact is a super-user and the survivor is not — no answer in the app.
  "super_user",
]);

/**
 * Feature 069 (M-R18 / FR-002, FR-003a): "not duplicates".
 *
 * Stores the two `dedup_normalized` values AS JUDGED, because pairs are proposed on name similarity alone
 * — so that is the only thing a rejection can sensibly be judged against. Suppression holds while both
 * still match, which makes the lapse a property of the data rather than of remembering to clear a flag:
 * four code paths write that column, and a missed hook would hide a duplicate forever with no error.
 */
export const dedupRejections = pgTable("dedup_rejections", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactAId: uuid("contact_a_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  contactBId: uuid("contact_b_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  aDedupNormalized: text("a_dedup_normalized").notNull(),
  bDedupNormalized: text("b_dedup_normalized").notNull(),
  rejectedBy: uuid("rejected_by").references(() => contacts.id),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Feature 069 (M-R21/M-R22): a merge held for a decision, surfaced in the needs-review queue. */
export const heldMerges = pgTable("held_merges", {
  id: uuid("id").primaryKey().defaultRandom(),
  canonicalId: uuid("canonical_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  mergedId: uuid("merged_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  reason: heldMergeReasonEnum("reason").notNull(),
  attemptedBy: uuid("attempted_by").references(() => contacts.id),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  /**
   * Feature 078: every answer given so far for this pair, by whoever gave it — parsed through
   * `heldMergeAnswersSchema`, never trusted raw. A retry re-checks every obstacle, so it needs them all,
   * and they come from different people at different times. `reason` is always the decision still
   * outstanding; `held_merges_pair_open` keeps one open hold per pair.
   */
  answers: jsonb("answers").notNull().default({}),
});

export type DedupRejectionRow = typeof dedupRejections.$inferSelect;
export type HeldMergeRow = typeof heldMerges.$inferSelect;
export type HeldMergeReason = (typeof heldMergeReasonEnum.enumValues)[number];
