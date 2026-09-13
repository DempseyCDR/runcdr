import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbOrTx } from "@/server/db/client";
import {
  attendance,
  contactEmails,
  contacts,
  membershipAccounts,
  mergeAudit,
  mergeReversals,
} from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { parseManifest, type ReversalManifest, type SkippedEntry } from "./mergeManifest";

/**
 * Feature 074 (FR-007 to FR-011, FR-026 to FR-028): reading the merge record, and judging whether a
 * merge can still be undone.
 *
 * `merge_audit` has been written since feature 033 and read by nothing — there was no merge history
 * surface at all, because there was nothing to do with one. This is that surface.
 */

/** Why a merge cannot be undone. FR-028 requires the reason, not just a refusal. */
export const IRREVERSIBLE_VERDICTS = [
  "no_manifest",
  "survivor_merged",
  "contact_archived",
  "already_undone",
] as const;

export type IrreversibleVerdict = (typeof IRREVERSIBLE_VERDICTS)[number];
export type Verdict = "reversible" | IrreversibleVerdict;

/**
 * The four refusals above are EXHAUSTIVE for a merge that exists.
 *
 * A fifth, "the retired contact is gone", looks obviously necessary and is not, because a merge record can
 * never outlive either of its contacts. The reason changed in feature 077: before it, `merge_audit`
 * refused the delete outright; since it, `merge_audit.canonical_id` and `merged_id` are ON DELETE
 * CASCADE, so deleting either contact deletes the merge record with it. Either way there is no merge row
 * whose contact is missing, so the branch is unreachable. Do not add it back unless those keys are ever
 * changed to SET NULL.
 */
export type Reversibility =
  | { verdict: "reversible"; manifest: ReversalManifest; canonicalId: string; mergedId: string }
  | { verdict: IrreversibleVerdict; reason: string; canonicalId: string; mergedId: string };

/** What to tell Mel. Kept beside the verdicts so a new verdict cannot ship without an explanation. */
export const VERDICT_REASON: Record<IrreversibleVerdict, string> = {
  no_manifest:
    "This merge was recorded before undo existed, so there is no record of what moved. It cannot be undone.",
  survivor_merged:
    "The surviving contact has since been merged into another. Undo that later merge first.",
  contact_archived: "One of these contacts has been archived since the merge.",
  already_undone: "This merge has already been undone.",
};

/**
 * Can this merge be undone right now, and if not, why not?
 *
 * Computed on every call and never stored. A stored flag would be wrong the moment the survivor is
 * merged again or either contact is archived, and FR-028 needs the reason rather than a boolean.
 *
 * Deliberately the ONLY implementation of this question: the history view renders from it and the undo
 * route refuses from it. Feature 072 is the cautionary tale — its held-merge auto-close and its merge
 * detection asked subtly different versions of "can both of these sign in?", so a hold would close and
 * the next attempt would raise it again, forever.
 */
export async function reversibilityOf(db: DbOrTx, mergeId: string): Promise<Reversibility> {
  const merge = await db.query.mergeAudit.findFirst({ where: eq(mergeAudit.id, mergeId) });
  // Not a verdict — the verdicts describe a merge that exists. A missing one is a 404.
  if (!merge) throw errors.mergeNotFound();

  const { canonicalId, mergedId } = merge;
  const irreversible = (verdict: IrreversibleVerdict): Reversibility => ({
    verdict,
    reason: VERDICT_REASON[verdict],
    canonicalId,
    mergedId,
  });

  // FR-007. Checked first and cheapest: without a manifest nothing else matters.
  const manifest = parseManifest(merge.reversalManifest);
  if (!manifest) return irreversible("no_manifest");

  // FR-010. Before the contact checks, because "already undone" is the more useful thing to say about a
  // merge that was reversed and whose contacts have since moved on.
  const reversal = await db.query.mergeReversals.findFirst({
    where: eq(mergeReversals.mergeAuditId, mergeId),
  });
  if (reversal) return irreversible("already_undone");

  const pair = await db
    .select({
      id: contacts.id,
      mergedIntoId: contacts.mergedIntoId,
      archivedAt: contacts.archivedAt,
    })
    .from(contacts)
    .where(inArray(contacts.id, [canonicalId, mergedId]));

  const canonical = pair.find((c) => c.id === canonicalId);
  const merged = pair.find((c) => c.id === mergedId);
  // Both are guaranteed present: the merge record cascades away with either contact (feature 077), so a
  // loaded merge always has both. This satisfies the type checker without inventing a verdict for a state
  // the database forbids.
  if (!canonical || !merged) throw errors.mergeNotFound();

  // FR-009. Reviving an archived record by undoing a merge would be a surprise, not a restoration.
  if (canonical.archivedAt !== null || merged.archivedAt !== null) {
    return irreversible("contact_archived");
  }

  // FR-008. Chains unwind most-recent-first or not at all: returning rows to a contact that is itself
  // retired would strand them exactly the way feature 072 existed to stop.
  if (canonical.mergedIntoId !== null) return irreversible("survivor_merged");

  return { verdict: "reversible", manifest, canonicalId, mergedId };
}

/**
 * FR-027: how much has landed on either contact since the merge.
 *
 * A risk INDICATOR, not an audit. The set is closed to the three tables that carry a plain `created_at`
 * on the contact itself: a new way to reach them, a dance they came to, a membership they took out.
 *
 * Deliberately excluded, and why: `membership_members` timestamps as `attached_at`; `gate_sales` has no
 * timestamp of its own at all and would need a join through `door_records` (and attendance already
 * registers that they turned up); the audit tables record what was done *to* a contact rather than
 * activity *by* one. A number that is directionally right and is one uniform query serves the judgement
 * this exists for. An exhaustive one would not serve it better, and would drift the moment a table was
 * added.
 */
async function activitySince(db: DbOrTx, contactIds: string[], since: Date): Promise<number> {
  const counts = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(contactEmails)
      .where(and(inArray(contactEmails.contactId, contactIds), gt(contactEmails.createdAt, since))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(attendance)
      .where(and(inArray(attendance.contactId, contactIds), gt(attendance.createdAt, since))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(membershipAccounts)
      .where(
        and(
          inArray(membershipAccounts.payerContactId, contactIds),
          gt(membershipAccounts.createdAt, since),
        ),
      ),
  ]);
  return counts.reduce((total, [row]) => total + (row?.n ?? 0), 0);
}

export type MergeHistoryEntry = {
  mergeId: string;
  mergedContact: { id: string; displayName: string };
  /**
   * The contact this merge actually went INTO. Usually the contact being viewed, but not for an
   * indirect merge earlier in a chain — Emily was merged into Amy, who was later merged into Jacob, and
   * saying "Emily was merged into Jacob" on Jacob's record would be a lie.
   */
  intoContact: { id: string; displayName: string };
  /** False when this merge went into a contact that has since been merged onward into the one viewed. */
  direct: boolean;
  actor: string;
  mergedAt: Date;
  ageDays: number;
  activitySince: number;
  verdict: Verdict;
  /** Present for every verdict except `reversible` — what to show instead of an undo control. */
  reason?: string;
  reversal: { actor: string; undoneAt: Date; skipped: SkippedEntry[] } | null;
};

/**
 * FR-026: every merge that produced this contact, newest first — the WHOLE chain, not just the last hop.
 *
 * ## Why the chain and not only direct merges
 *
 * An earlier version listed merges where `canonical_id` was this contact, which looked right and was
 * not. Found walking the manual pass: three contacts merged A → B → C. All three sets of emails end up
 * on C, but C's history showed only B → C. The A → B merge names B as its survivor, and B is retired
 * and cannot be opened in the UI — so that merge was invisible and unreachable, and so was the
 * `survivor_merged` verdict, which is computed and tested but had nowhere to appear.
 *
 * The rule is therefore "every merge whose survivor is this contact, or is a contact that has since
 * become this contact". Newest first, which is also the order they must be undone in (FR-008).
 *
 * A contact's OWN retirement still does not appear on its record — the undo control belongs with the
 * survivor.
 */
export async function listMergesForContact(
  db: DbOrTx,
  contactId: string,
): Promise<MergeHistoryEntry[]> {
  const intoContacts = alias(contacts, "into_contact");
  const rows = await db
    .select({
      mergeId: mergeAudit.id,
      mergedId: mergeAudit.mergedId,
      mergedDisplayName: contacts.displayName,
      canonicalId: mergeAudit.canonicalId,
      canonicalDisplayName: intoContacts.displayName,
      actor: mergeAudit.actor,
      mergedAt: mergeAudit.createdAt,
    })
    .from(mergeAudit)
    .innerJoin(contacts, eq(contacts.id, mergeAudit.mergedId))
    .innerJoin(intoContacts, eq(intoContacts.id, mergeAudit.canonicalId))
    // Walk `merged_into_id` backwards from this contact to gather everything that has become it, then
    // take every merge whose survivor is any of them. `UNION` (not `UNION ALL`) terminates the walk on
    // a cycle rather than looping forever — merge chains are trees in practice, but the data does not
    // enforce it and an infinite recursion here would hang a page load.
    .where(
      sql`${mergeAudit.canonicalId} IN (
      WITH RECURSIVE absorbed(id) AS (
        SELECT ${contactId}::uuid
        UNION
        SELECT c.id FROM contacts c JOIN absorbed a ON c.merged_into_id = a.id
      )
      SELECT id FROM absorbed
    )`,
    )
    .orderBy(desc(mergeAudit.createdAt));

  const out: MergeHistoryEntry[] = [];
  for (const row of rows) {
    const [state, reversalRow, activity] = await Promise.all([
      reversibilityOf(db, row.mergeId),
      db.query.mergeReversals.findFirst({
        where: eq(mergeReversals.mergeAuditId, row.mergeId),
      }),
      // The merge's OWN pair, not the contact being viewed: for an indirect merge, "what has happened
      // since" is about the two records that merge joined.
      activitySince(db, [row.canonicalId, row.mergedId], row.mergedAt),
    ]);

    out.push({
      mergeId: row.mergeId,
      mergedContact: { id: row.mergedId, displayName: row.mergedDisplayName },
      intoContact: { id: row.canonicalId, displayName: row.canonicalDisplayName },
      direct: row.canonicalId === contactId,
      actor: row.actor,
      mergedAt: row.mergedAt,
      ageDays: Math.floor((Date.now() - row.mergedAt.getTime()) / 86_400_000),
      activitySince: activity,
      verdict: state.verdict,
      ...(state.verdict === "reversible" ? {} : { reason: state.reason }),
      reversal: reversalRow
        ? {
            actor: reversalRow.actor,
            undoneAt: reversalRow.createdAt,
            skipped: (reversalRow.skipped ?? []) as SkippedEntry[],
          }
        : null,
    });
  }
  return out;
}

/**
 * FR-029: is a merge performed right now going to be reversible?
 *
 * Trivially yes, and that is the point — the answer is a constant because every merge from this feature
 * onward records a manifest. It exists as a named export so the confirmation copy states the fact rather
 * than hard-coding an assumption that would quietly rot if recording ever became conditional.
 */
export const NEW_MERGES_ARE_REVERSIBLE = true;
