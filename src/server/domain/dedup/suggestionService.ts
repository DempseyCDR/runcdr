import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { normalizeName } from "@/server/domain/contacts/normalize";

/** Escape LIKE/ILIKE wildcards in a user needle (Postgres default '\' escape char). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Feature 067 (FR-018): a pair already linked as a SHARED HOUSEHOLD is suppressed in both directions.
// Suggestions pair on NAME similarity, never on email, so a household that shares a surname would
// otherwise re-surface on every pass through the queue. Derived from the pointer itself — no dismissal
// record and no new table. Narrower than, and unrelated to, the general "not a duplicate" flag (M-R18):
// a same-surname pair that is NOT linked (Lydia and Richard Dempsey) keeps being suggested (FR-019).
// Feature 033 (P5-R7): each candidate also carries phone (canonical, feature 032) + ACTIVE emails, so the
// reviewer can tell a real duplicate from a coincidental same-name match.
// Feature 069 (FR-001): and record age, membership standing and shared-household facts, so the whole
// decision can be made from the row without opening either record.
export type MergeSuggestionContact = {
  id: string;
  displayName: string;
  /**
   * Feature 076: the structured names beneath the display name. Pairing runs on first + last, so when the
   * display name is CUSTOM it can hide the very name the pair was proposed on — the row shows these
   * whenever `displayNameOverride` is set. Names are not PII, so projection keeps them.
   */
  firstName: string;
  lastName: string | null;
  displayNameOverride: string | null;
  membershipStatus: string;
  membershipLevel: string | null;
  phone: string | null;
  emails: string[];
  createdAt: string;
  updatedAt: string;
  /** Shown on the row; blocks MERGING in place, since choosing a surviving sign-in is not the row's. */
  hasLogin: boolean;
  /**
   * Feature 067: the address this contact RIDES rather than owns. Shown on the row — without it a
   * contact reached only through a household address renders as "No email", which reads as a sparse
   * record when it is in fact strong evidence of a distinct person.
   */
  messageRecipient: { address: string | null; ownerDisplayName: string } | null;
  /**
   * The row shows ACTIVE owned addresses (plus the ridden one above). This says the contact holds an
   * address the row is NOT showing — a retired or transitioning one, which may be the very thing that
   * proves these are the same person. The route also sets it when PII is projected away.
   */
  hasUnshownAddress: boolean;
};
export type MergeSuggestion = {
  a: MergeSuggestionContact;
  b: MergeSuggestionContact;
  similarity: number;
  /** Evidence AGAINST a merge: two real people who share an address (067) or an account (068). */
  sharedHousehold: { email: boolean; account: boolean };
  /** Present only when `includeRejected` asked for suppressed pairs (FR-004a). */
  rejected: { at: string; byDisplayName: string | null } | null;
  /** FR-005: derived from the projected fields above — see `deriveRowSafety`. */
  safeToReject: boolean;
  safeToMerge: boolean;
};

/**
 * Feature 069 (FR-005/FR-006). A row may be resolved in place EXACTLY when the row already carries the
 * decision. Deriving that here — from the projected fields themselves, in the same file that decides what
 * those fields are — is the point: adding a fact to the row can make a decision safe, and removing one
 * cannot leave a stale rule pointing at a field that no longer exists.
 *
 * The pair's two answers are OPPOSITES, so they are blocked by different things and must be derived
 * separately. (The first version of this conflated them, and refused to offer "not duplicates" on a pair
 * whose phone numbers differed — which is the strongest evidence a row can carry that they are two
 * people, i.e. an argument FOR the very action it was blocking.)
 *
 *  - **Rejecting** says "different people". Only one thing can undermine it: an address the row is not
 *    showing, which might have proved the opposite.
 *  - **Merging** says "one person", retires a contact, and must pick winners. It is blocked by anything
 *    that makes the pair look like two people, and by any collision the row cannot resolve — two
 *    sign-ins (FR-011, not this user's choice to make) or two membership accounts. Those go to the
 *    comparison, where the records are visible and the held-merge path exists.
 */
function deriveRowSafety(
  a: MergeSuggestionContact,
  b: MergeSuggestionContact,
  sharedHousehold: { email: boolean; account: boolean },
): { safeToReject: boolean; safeToMerge: boolean } {
  const somethingUnshown = a.hasUnshownAddress || b.hasUnshownAddress;
  const looksLikeTwoPeople =
    (!!a.phone && !!b.phone && a.phone !== b.phone) ||
    (!!a.membershipLevel && !!b.membershipLevel && !sharedHousehold.account);
  const collides = a.hasLogin && b.hasLogin;
  return {
    safeToReject: !somethingUnshown,
    safeToMerge: !somethingUnshown && !looksLikeTwoPeople && !collides,
  };
}

/**
 * Feature 069 (FR-003a). A rejection is stored with the two names as they stood when it was made, and
 * suppresses the pair only while BOTH still match. Comparing them here — in the query that proposes the
 * pair — is what makes the lapse a property of the data rather than a flag to maintain: rename either
 * contact through any path and the pair returns, with nothing written anywhere.
 */
const rejectionJoin = sql`
  LEFT JOIN dedup_rejections dr
         ON dr.contact_a_id = a.id
        AND dr.contact_b_id = b.id
        AND dr.a_dedup_normalized = a.dedup_normalized
        AND dr.b_dedup_normalized = b.dedup_normalized
`;

/**
 * The criteria that PROPOSE a pair — name similarity alone. Shared verbatim by the queue and its count so
 * the badge cannot disagree with the list it opens.
 */
const pairCriteria = (threshold: number): SQL => sql`
    FROM contacts a
    JOIN contacts b
      ON a.id < b.id
     AND a.merged_into_id IS NULL
     AND b.merged_into_id IS NULL
     AND a.archived_at IS NULL
     AND b.archived_at IS NULL
     AND a.dedup_normalized % b.dedup_normalized
     AND NOT EXISTS (
           SELECT 1 FROM contact_emails ce
            WHERE (ce.id = a.message_recipient_email_id AND ce.contact_id = b.id)
               OR (ce.id = b.message_recipient_email_id AND ce.contact_id = a.id)
         )
    ${rejectionJoin}
    WHERE similarity(a.dedup_normalized, b.dedup_normalized) >= ${threshold}
`;

/** Every address a contact can actually be reached at: what it owns, plus what it rides (067). */
const reachedAt = (alias: string): SQL =>
  sql.raw(`
    SELECT ce.email FROM contact_emails ce
     WHERE (ce.contact_id = ${alias}.id AND ce.status = 'active')
        OR ce.id = ${alias}.message_recipient_email_id
  `);

const contactCols = (alias: string): SQL =>
  sql.raw(`
    ${alias}.id AS ${alias}_id,
    ${alias}.display_name AS ${alias}_name,
    ${alias}.first_name AS ${alias}_first,
    ${alias}.last_name AS ${alias}_last,
    ${alias}.display_name_override AS ${alias}_override,
    ${alias}.membership_status AS ${alias}_status,
    ${alias}.phone AS ${alias}_phone,
    ${alias}.created_at AS ${alias}_created,
    ${alias}.updated_at AS ${alias}_updated,
    ARRAY(SELECT ce.email::text FROM contact_emails ce
           WHERE ce.contact_id = ${alias}.id AND ce.status = 'active'
           ORDER BY ce.is_login DESC, ce.created_at) AS ${alias}_emails,
    (SELECT ma.level::text FROM membership_members mm
       JOIN membership_accounts ma ON ma.id = mm.account_id
      WHERE mm.contact_id = ${alias}.id
      ORDER BY ma.expiry_date DESC NULLS LAST LIMIT 1) AS ${alias}_level,
    EXISTS (SELECT 1 FROM contact_emails ce
             WHERE ce.contact_id = ${alias}.id AND ce.is_login) AS ${alias}_has_login,
    EXISTS (SELECT 1 FROM contact_emails ce
             WHERE ce.contact_id = ${alias}.id AND ce.status <> 'active') AS ${alias}_unshown,
    (SELECT ce.email::text FROM contact_emails ce
      WHERE ce.id = ${alias}.message_recipient_email_id) AS ${alias}_ridden_address,
    (SELECT oc.display_name FROM contact_emails ce
       JOIN contacts oc ON oc.id = ce.contact_id
      WHERE ce.id = ${alias}.message_recipient_email_id) AS ${alias}_ridden_owner
  `);

type Row = {
  a_id: string;
  a_name: string;
  a_first: string;
  a_last: string | null;
  a_override: string | null;
  a_status: string;
  a_phone: string | null;
  a_emails: string[];
  a_created: string;
  a_updated: string;
  a_level: string | null;
  b_id: string;
  b_name: string;
  b_first: string;
  b_last: string | null;
  b_override: string | null;
  b_status: string;
  b_phone: string | null;
  b_emails: string[];
  b_created: string;
  b_updated: string;
  b_level: string | null;
  a_has_login: boolean;
  b_has_login: boolean;
  a_unshown: boolean;
  b_unshown: boolean;
  a_ridden_address: string | null;
  b_ridden_address: string | null;
  a_ridden_owner: string | null;
  b_ridden_owner: string | null;
  sim: number;
  shared_email: boolean;
  shared_account: boolean;
  rejected_at: string | null;
  rejected_by_name: string | null;
};

/**
 * Surface likely-duplicate contact pairs via pg_trgm similarity on the structured-name dedup key
 * (`dedup_normalized` = first+last), so a display-name override cannot mask a duplicate (feature 012).
 * Only non-merged contacts; each unordered pair appears once (a.id<b.id). Suggestions only — no merges.
 *
 * Feature 062 (M-R4): an optional `q` scopes the pairs to those where a member's name matches the query
 * (hybrid — empty `q` is the global queue). Matched on both the display key and the structured-name key,
 * so a display-name override cannot hide a duplicate from the scoped view either.
 */
export async function getMergeSuggestions(
  db: Db,
  threshold = 0.4,
  limit = 50,
  q?: string,
  opts?: { includeRejected?: boolean },
): Promise<MergeSuggestion[]> {
  const needle = q?.trim() ? `%${escapeLike(normalizeName(q))}%` : null;
  const qFilter = needle
    ? sql` AND (a.name_normalized ILIKE ${needle} OR a.dedup_normalized ILIKE ${needle}
              OR b.name_normalized ILIKE ${needle} OR b.dedup_normalized ILIKE ${needle})`
    : sql``;
  // Without `includeRejected`, a matched rejection removes the pair. With it, the pair comes back
  // carrying who rejected it — which is what makes a mistaken rejection findable from the queue (FR-004a).
  const rejectedFilter = opts?.includeRejected ? sql`` : sql` AND dr.id IS NULL`;

  const rows = await db.execute<Row>(sql`
    SELECT ${contactCols("a")},
           ${contactCols("b")},
           similarity(a.dedup_normalized, b.dedup_normalized) AS sim,
           EXISTS (SELECT 1 FROM (${reachedAt("a")}) ra
                     JOIN (${reachedAt("b")}) rb ON ra.email = rb.email) AS shared_email,
           EXISTS (SELECT 1 FROM membership_members ma
                     JOIN membership_members mb ON mb.account_id = ma.account_id
                    WHERE ma.contact_id = a.id AND mb.contact_id = b.id) AS shared_account,
           dr.rejected_at AS rejected_at,
           (SELECT rc.display_name FROM contacts rc WHERE rc.id = dr.rejected_by) AS rejected_by_name
    ${pairCriteria(threshold)}${qFilter}${rejectedFilter}
    ORDER BY sim DESC
    LIMIT ${limit}
  `);

  const side = (r: Row, k: "a" | "b"): MergeSuggestionContact => ({
    id: r[`${k}_id`],
    displayName: r[`${k}_name`],
    firstName: r[`${k}_first`],
    lastName: r[`${k}_last`],
    displayNameOverride: r[`${k}_override`],
    membershipStatus: r[`${k}_status`],
    membershipLevel: r[`${k}_level`],
    phone: r[`${k}_phone`],
    emails: r[`${k}_emails`] ?? [],
    createdAt: String(r[`${k}_created`]),
    updatedAt: String(r[`${k}_updated`]),
    hasLogin: !!r[`${k}_has_login`],
    hasUnshownAddress: !!r[`${k}_unshown`],
    messageRecipient: r[`${k}_ridden_owner`]
      ? { address: r[`${k}_ridden_address`], ownerDisplayName: r[`${k}_ridden_owner`]! }
      : null,
  });

  return [...rows].map((r) => {
    const a = side(r, "a");
    const b = side(r, "b");
    const sharedHousehold = { email: !!r.shared_email, account: !!r.shared_account };
    return {
      a,
      b,
      similarity: Number(r.sim),
      sharedHousehold,
      rejected: r.rejected_at
        ? { at: String(r.rejected_at), byDisplayName: r.rejected_by_name }
        : null,
      ...deriveRowSafety(a, b, sharedHousehold),
    };
  });
}

/**
 * Feature 064: the global count of candidate duplicate pairs for the launcher button — the same criteria
 * as `getMergeSuggestions` (no query, no limit), so the count matches the global queue. Feature 069: that
 * now includes rejection suppression, which is exactly why the criteria are shared rather than restated.
 */
export async function countMergeSuggestions(db: Db, threshold = 0.4): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n ${pairCriteria(threshold)} AND dr.id IS NULL
  `);
  return [...rows][0]?.n ?? 0;
}

/**
 * Feature 069 (FR-004a): how many pairs a rejection is currently suppressing — the same criteria again,
 * asked the other way round. A queue that simply omitted them would make a mistaken rejection findable
 * only by knowing to look; a queue that can say "3 hidden" makes the absence itself visible, which is
 * what the requirement asks for. Scoped by `q` so the scoped list can say it too.
 */
export async function countSuppressedPairs(db: Db, threshold = 0.4, q?: string): Promise<number> {
  const needle = q?.trim() ? `%${escapeLike(normalizeName(q))}%` : null;
  const qFilter = needle
    ? sql` AND (a.name_normalized ILIKE ${needle} OR a.dedup_normalized ILIKE ${needle}
              OR b.name_normalized ILIKE ${needle} OR b.dedup_normalized ILIKE ${needle})`
    : sql``;
  const rows = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n ${pairCriteria(threshold)}${qFilter} AND dr.id IS NOT NULL
  `);
  return [...rows][0]?.n ?? 0;
}

/**
 * Feature 016's PII rule applied to a pair (FR-016), and feature 069's row-safety rule applied to what
 * survives it. `projectContact` is a denylist over a contact record; a suggestion is a different shape,
 * so the same decision is made here explicitly rather than by a spread that would leak a new field the
 * day one is added.
 *
 * Withholding the reach also withholds the decision: a reader who cannot see addresses or phone numbers
 * cannot tell these two apart from the row, so `hasUnshownAddress` becomes true for both sides and the
 * safety flags fall out of that on their own — no second rule to keep in step with the first.
 */
export function projectSuggestion(p: MergeSuggestion, disclosing: boolean): MergeSuggestion {
  if (disclosing) return p;
  const strip = (c: MergeSuggestionContact): MergeSuggestionContact => ({
    ...c,
    phone: null,
    emails: [],
    // The OWNER'S NAME is kept: "reached via David Jones" discloses nothing this reader could not
    // already look up, and explains why the contact shows no address of its own (feature 067).
    messageRecipient: c.messageRecipient ? { ...c.messageRecipient, address: null } : null,
    hasUnshownAddress: true,
  });
  const a = strip(p.a);
  const b = strip(p.b);
  return { ...p, a, b, ...deriveRowSafety(a, b, p.sharedHousehold) };
}
