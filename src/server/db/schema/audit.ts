import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import { membershipStatusEnum } from "./enums";

/**
 * The general audit trail (feature 016).
 *
 * `writeAudit` wrote only log lines until now, and said so: "For the MVP the audit sink is the
 * structured log; dedicated audit tables are introduced with those stories." This is that story —
 * "which volunteer saw the most contacts' PII last month, and how many" must be answerable in SQL
 * without scanning application logs, and the grant/revoke trail must be durable.
 *
 * `kind` is text, not an enum: the union already has ~40 values and grows every feature, and nothing
 * joins on it. An enum would mean an ALTER TYPE per feature for no gain.
 *
 * The two tables below it (status_change_audit, merge_audit) predate this and stay as they are: they
 * carry typed, queried columns rather than a generic detail bag.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    actorContactId: uuid("actor_contact_id").references(() => contacts.id),
    details: jsonb("details").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    occurredIdx: index("audit_events_occurred_idx").on(t.occurredAt),
    kindIdx: index("audit_events_kind_idx").on(t.kind, t.occurredAt),
    // SC-014's question is "which volunteer, last month, how many" — this is that index.
    actorIdx: index("audit_events_actor_idx").on(t.actorContactId, t.occurredAt),
  }),
);

export type AuditEventRow = typeof auditEvents.$inferSelect;

export const statusChangeAudit = pgTable("status_change_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  fromStatus: membershipStatusEnum("from_status"),
  toStatus: membershipStatusEnum("to_status").notNull(),
  reason: text("reason").notNull(),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StatusChangeAuditRow = typeof statusChangeAudit.$inferSelect;

/**
 * An append-only record that a merge happened.
 *
 * `relinked_counts` is exactly that — COUNTS ("contact_emails": 2), not identifiers. On its own it can
 * tell you a merge occurred, when, by whom, and how much moved, but not WHAT moved. Feature 074 adds the
 * missing half in `reversal_manifest`, which is what makes a merge reversible.
 *
 * ⚠️ `reversal_manifest` is NULL for every merge recorded before feature 074, and that NULL is
 * load-bearing: it is the "permanently un-reversible" signal (FR-007). There is no backfill and no
 * default, because nothing can reconstruct which rows moved after the fact — a moved `contact_emails`
 * row is indistinguishable from one the survivor always had.
 *
 * Still append-only. An undo writes `merge_reversals` and does NOT touch this table (FR-006): rewriting
 * the record of a merge would erase the event it exists to record.
 *
 * Feature 077: append-only forbids REWRITING a merge record, not removing it with its contact. Deleting
 * either contact deletes the merge records that name it (and their reversals), matching `held_merges`
 * and `dedup_rejections`. Before 077 this table refused such deletes forever, which made undo — a
 * short-term recovery — leave both contacts permanently undeletable.
 */
export const mergeAudit = pgTable("merge_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Feature 077: CASCADE — a contact's merge history is deleted with the contact (migration 0048).
  canonicalId: uuid("canonical_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  mergedId: uuid("merged_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  actor: text("actor").notNull(),
  relinkedCounts: jsonb("relinked_counts").notNull().default({}),
  /** Feature 074: see `mergeManifest.ts` for the shape. Parsed with Zod on read, never trusted raw. */
  reversalManifest: jsonb("reversal_manifest"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MergeAuditRow = typeof mergeAudit.$inferSelect;

/**
 * Feature 074: one row per undo — who reversed a merge, when, and what it could and could not restore.
 *
 * The EXISTENCE of a row here is the "already undone" fact (FR-010), which is why `merge_audit` needed no
 * new flag. The UNIQUE on `mergeAuditId` is load-bearing rather than hygiene: "has this been undone?"
 * followed by undoing it is a check-then-act race, and the constraint settles it — two simultaneous
 * undos mean one INSERT wins and the other is reported as already undone.
 */
export const mergeReversals = pgTable("merge_reversals", {
  id: uuid("id").primaryKey().defaultRandom(),
  mergeAuditId: uuid("merge_audit_id")
    .notNull()
    .unique()
    .references(() => mergeAudit.id, { onDelete: "cascade" }),
  actor: text("actor").notNull(),
  /** Per table, how many manifest entries were applied. */
  restoredCounts: jsonb("restored_counts").notNull().default({}),
  /** Every entry NOT applied, with its reason — `gone`, `occupied` or `not_authorized` (FR-018). */
  skipped: jsonb("skipped").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MergeReversalRow = typeof mergeReversals.$inferSelect;
