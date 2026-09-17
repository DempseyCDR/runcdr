import { logger } from "@/server/lib/logger";
import type { DbOrTx } from "@/server/db/client";
import { auditEvents } from "@/server/db/schema";

/**
 * Append-only audit writer (Constitution Principle IV).
 *
 * TWO WRITERS, and the choice between them is not a matter of taste:
 *
 *   • `recordAudit(db, …)` — async; writes an `audit_events` ROW and logs. **Use this.** It is what
 *     SC-014 needs ("which volunteer saw the most contacts' PII last month, and how many" must be
 *     answerable in SQL, without scanning logs) and what FR-032 needs (a durable grant/revoke trail).
 *     Pass a `tx` when the audited change is in a transaction, so a rolled-back change leaves no row
 *     claiming it happened.
 *
 *   • `writeAudit(…)` — sync; logs ONLY. The legacy path, kept because 31 call sites across 10
 *     transactional files call it synchronously, several without a `db` handle in scope, and because
 *     its `actor` is free text ("admin", "operator", sometimes a uuid) which `audit_events`'
 *     `actor_contact_id` FK cannot accept. Converting them is a real refactor that no requirement
 *     asks for; they migrate when their own features next touch them.
 *
 * RULE: if you have an Actor and a `db` handle, use `recordAudit`. New code should never reach for
 * `writeAudit` — it is being retired, not maintained.
 */
export type AuditEvent = {
  kind:
    | "contact.merge"
    // Feature 074 (FR-021): a merge reversed. Carries what was restored and what was skipped.
    | "contact.merge.undone"
    // Feature 069 (M-R18/M-R21): triage decisions.
    | "dedup.pair_rejected"
    | "dedup.pair_unrejected"
    | "dedup.merge_held"
    | "dedup.merge_resolved"
    // Feature 072 (FR-017): a held merge withdrawn without merging and without changing access.
    | "dedup.merge_abandoned"
    | "contact.deleted" // feature 065 (M-R11/M-R12): a permanent contact deletion (safe or unrestricted)
    | "email.deleted" // feature 066 (M-R17): a permanent email-row deletion (super-user)
    // Feature 067 (M-R23): shared/family email reference lifecycle.
    | "contact.reference.linked"
    | "contact.reference.unlinked"
    | "contact.reference.cleared" // target deactivated/deleted → pointer cleared + needs_review (FR-012)
    | "membership.status_change"
    // Feature 068: the membership account lifecycle.
    | "membership.payment_recorded"
    | "membership.level_changed"
    | "membership.member_attached"
    | "membership.member_detached"
    | "contact.created"
    | "email.created"
    | "door_record.created"
    | "door_record.updated"
    | "attendance.purge"
    | "attendance.updated"
    | "attendance.deleted"
    | "booking.created"
    | "booking.updated"
    | "booking.deleted"
    | "booking.donated" // feature 030: donate-at-settlement (FS, payment-write)
    | "booking.settlement_added" // feature 030: add-a-performer at settlement (FS, payment-write)
    | "rate_parameter.created"
    | "door_parameter.created"
    | "treasurer_report.generated"
    | "qbo_mapping.updated"
    | "expense_parameter.created"
    | "admission_pricing.set" // feature 054 (P7-R10): a series' admission tiers or schedule sentence changed
    | "officer.set" // feature 055 (P7-R12): a board-seat role's officer assignment changed
    | "mailing_list.exported"
    | "band.created"
    | "band.updated"
    | "band.deleted"
    | "band.booked"
    | "venue.created"
    | "venue.updated"
    | "venue_rent.created"
    | "event.rent_set"
    | "event.deleted"
    | "event.generated"
    | "event.status_changed"
    // Feature 015 — staff authentication.
    | "auth.bootstrap.designated"
    | "auth.identity.created"
    | "auth.signin.succeeded"
    | "auth.signin.refused"
    | "auth.signout"
    // Feature 016 — authorization. These are the kinds that REQUIRE the table (FR-017b, FR-026b,
    // FR-032, SC-014), and every one is emitted from a signed-in request with a real contactId.
    | "authz.grant.created"
    | "authz.grant.revoked"
    | "authz.refused"
    | "volunteer.designated"
    | "volunteer.cleared"
    | "volunteer.approved"
    | "pii.disclosed"
    // Feature 019 — payments & membership acquisition.
    | "membership.door_enrollment"
    | "membership.online_enrollment"
    | "performer_payment.created"
    | "performer_payment.updated"
    | "performer_payment.voided"
    | "performer_payment.line_added" // feature 081 (R4)
    | "performer_payment.deleted"
    | "paypal.notification.parked"
    | "paypal.notification.rejected"
    | "paypal.notification.linked"
    // Feature 044 — one-time operator contact load (replace roster from iContact + membership workbook).
    | "contact.bulk_load"
    // Feature 051 (P7-R7) — the content-pages CMS.
    | "content.created"
    | "content.updated"
    | "content.published"
    | "content.unpublished"
    | "content.deleted"
    // Feature 056 (P7-R13) — the site-wide announcement banner.
    | "announcement.posted"
    | "announcement.cleared"
    // Feature 057 (P7-R14) — the home-page promotional campaign slot.
    | "campaign.created"
    | "campaign.updated"
    | "campaign.deleted";
  actor: string | null;
  details: Record<string, unknown>;
};

/** Legacy, log-only. See the module comment — new code uses `recordAudit`. */
export function writeAudit(event: AuditEvent): void {
  logger.info({ audit: true, ...event }, `audit:${event.kind}`);
}

export type AuditRecord = {
  kind: AuditEvent["kind"];
  /** The signed-in contact responsible, or null for system/CLI-issued events. */
  actorContactId: string | null;
  details?: Record<string, unknown>;
};

/**
 * Write a durable audit row (and log it).
 *
 * Pass the caller's `tx` when the audited change is transactional: an aborted change must not leave a
 * row claiming it happened. That matters most for the grant trail — FR-028b's cascade is atomic
 * precisely so that "revoked" and "actually revoked" cannot diverge.
 */
export async function recordAudit(db: DbOrTx, event: AuditRecord): Promise<void> {
  const details = event.details ?? {};
  await db.insert(auditEvents).values({
    kind: event.kind,
    actorContactId: event.actorContactId,
    details,
  });
  logger.info(
    { audit: true, kind: event.kind, actor: event.actorContactId, details },
    `audit:${event.kind}`,
  );
}
