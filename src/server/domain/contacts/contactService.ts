import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Db, DbOrTx } from "@/server/db/client";
import {
  auditEvents,
  clubSettings,
  dedupRejections,
  heldMerges,
  membershipAccounts,
  membershipMembers,
  attendance,
  contactEmails,
  contacts,
  doorRecords,
  gateChecks,
  gateSales,
  membershipCaptures,
  officers,
  performerPayments,
  performers,
  roleGrants,
  staffIdentities,
  venues,
} from "@/server/db/schema";
import type { ContactRow, MembershipLevel, MembershipStatus } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { recordAudit, writeAudit } from "@/server/lib/audit";
import { deriveContactNames, normalizeName } from "./normalize";
import { normalizePhone } from "./phone";
import { addEmailInTx } from "./emailService";
import { clearReferencesToOwner } from "./referenceService";
import { contactMembership } from "@/server/domain/membership/membershipStatus";
import { classifyMembership } from "@/server/domain/membership/classify";
import { deleteAccountOwnedBy } from "@/server/domain/membership/accountService";
import type { ContactCreateInput, ContactPatchInput } from "@/server/validation/contacts";

/** Feature 067 (FR-009/FR-016): the shared address this contact rides, if any. */
export type MessageRecipientView = {
  emailId: string;
  /** Contact PII — nulled for an actor without `contact.pii.read` (FR-016). */
  address: string | null;
  ownerContactId: string;
  ownerDisplayName: string;
};

export type ContactWithEmails = ContactRow & {
  emails: (typeof contactEmails.$inferSelect)[];
  /** Feature 067: set only when this contact rides someone else's address. */
  messageRecipient?: MessageRecipientView | null;
  /** Feature 067 (FR-010c): contacts that ride THIS contact's address. Names/ids only, no PII. */
  sharedWith?: { contactId: string; displayName: string }[];
  /**
   * Feature 068 (FR-018/FR-019): the MEMBERSHIP household — who paid, and who the payment covers.
   * Distinct from `sharedWith`, which is the EMAIL household (FR-020): they overlap often and are not the
   * same set. Names and ids only, so nothing here needs PII redaction.
   */
  membership?: {
    status: MembershipStatus;
    expiryDate: string | null;
    asPayer: {
      level: MembershipLevel;
      members: { contactId: string; displayName: string }[];
    } | null;
    asMember: { payerContactId: string; payerDisplayName: string } | null;
  };
};

export async function createContact(
  db: Db,
  input: ContactCreateInput,
  actor: string | null = null,
): Promise<ContactWithEmails> {
  return db.transaction(async (tx) => {
    const derived = deriveContactNames({
      firstName: input.firstName,
      lastName: input.lastName ?? null,
      displayNameOverride: input.displayNameOverride ?? null,
    });
    const [contact] = await tx
      .insert(contacts)
      .values({
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        displayNameOverride: input.displayNameOverride ?? null,
        pronouns: input.pronouns ?? null,
        displayName: derived.displayName,
        nameNormalized: derived.nameNormalized,
        dedupNormalized: derived.dedupNormalized,
        phone: input.phone ? normalizePhone(input.phone) : null, // feature 032: canonical E.164
        // No email and no phone: allow the contact but flag it for admin follow-up.
        needsReview: !input.email && !input.phone,
      })
      .returning();
    if (!contact) throw new Error("contact insert failed");

    const emails = input.email
      ? [
          await addEmailInTx(tx, contact, {
            address: input.email.address,
            purposes: input.email.purposes,
            consentTopics: input.email.consentTopics,
            status: input.email.status,
            isLogin: input.email.isLogin,
          }),
        ]
      : [];

    writeAudit({ kind: "contact.created", actor, details: { contactId: contact.id } });
    return { ...contact, emails };
  });
}

export async function getContact(db: Db, id: string): Promise<ContactWithEmails> {
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, id) });
  if (!contact) throw errors.contactNotFound();
  const emails = await db.select().from(contactEmails).where(eq(contactEmails.contactId, id));

  // Feature 067: the household view. `messageRecipient` is where THIS contact is reached when it owns
  // no address; `sharedWith` is who rides this contact's address (FR-010c) — the app is the only place
  // the roster is visible, since the export file carries only the owner's name.
  const [owner] = contact.messageRecipientEmailId
    ? await db
        .select({
          emailId: contactEmails.id,
          address: contactEmails.email,
          ownerContactId: contacts.id,
          ownerDisplayName: contacts.displayName,
        })
        .from(contactEmails)
        .innerJoin(contacts, eq(contacts.id, contactEmails.contactId))
        .where(eq(contactEmails.id, contact.messageRecipientEmailId))
        .limit(1)
    : [];

  const sharedWith = emails.length
    ? await db
        .select({ contactId: contacts.id, displayName: contacts.displayName })
        .from(contacts)
        .innerJoin(contactEmails, eq(contactEmails.id, contacts.messageRecipientEmailId))
        .where(eq(contactEmails.contactId, id))
    : [];

  // Feature 068: the membership household. Status comes from the DERIVATION, never the stored column —
  // which is a write-refreshed cache and may be a membership-year out of date (FR-015).
  const derived = await contactMembership(db, id);

  const ownAccount = await db.query.membershipAccounts.findFirst({
    where: eq(membershipAccounts.payerContactId, id),
  });
  const asPayer = ownAccount
    ? {
        level: ownAccount.level,
        members: await db
          .select({ contactId: contacts.id, displayName: contacts.displayName })
          .from(membershipMembers)
          .innerJoin(contacts, eq(contacts.id, membershipMembers.contactId))
          .where(
            and(
              eq(membershipMembers.accountId, ownAccount.id),
              sql`${membershipMembers.contactId} <> ${id}`,
            ),
          ),
      }
    : null;

  // Where someone ELSE pays for this contact. A contact can both pay and be covered, so this is
  // independent of `asPayer` rather than an alternative to it.
  const [coveredBy] = await db
    .select({ payerContactId: contacts.id, payerDisplayName: contacts.displayName })
    .from(membershipMembers)
    .innerJoin(membershipAccounts, eq(membershipAccounts.id, membershipMembers.accountId))
    .innerJoin(contacts, eq(contacts.id, membershipAccounts.payerContactId))
    .where(
      and(eq(membershipMembers.contactId, id), sql`${membershipAccounts.payerContactId} <> ${id}`),
    )
    .limit(1);

  return {
    ...contact,
    emails,
    messageRecipient: owner ?? null,
    sharedWith,
    membership: {
      status: derived.status,
      expiryDate: derived.expiryDate,
      asPayer,
      asMember: coveredBy ?? null,
    },
  };
}

export async function patchContact(
  db: Db,
  id: string,
  input: ContactPatchInput,
): Promise<ContactRow> {
  const existing = await db.query.contacts.findFirst({ where: eq(contacts.id, id) });
  if (!existing) throw errors.contactNotFound();

  // Roles are no longer a field on this row (feature 016): they are `role_grants`, because scope
  // cannot live in an array. Granting and revoking is the President/VP's job via the access screen,
  // not a side effect of editing a contact — so this endpoint no longer touches authority at all.
  const isVolunteer = input.isVolunteer ?? existing.isVolunteer;

  // Feature 064 (FR-012): `needs_review` auto-clears once the record has the required data — a phone or
  // an active email (the condition whose absence set the flag). Only ever clears; never re-flags.
  const resultingPhone =
    input.phone !== undefined ? (input.phone ? normalizePhone(input.phone) : null) : existing.phone;
  const emailRows = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM contact_emails
        WHERE contact_id = ${id} AND status IN ('active', 'transition')`,
  );
  const hasContactInfo = !!resultingPhone || ([...emailRows][0]?.n ?? 0) > 0;
  const needsReview = hasContactInfo ? false : existing.needsReview;

  // Recompute the maintained name values when any name field changes (an override edit, or first/last).
  const nameChanged =
    input.firstName !== undefined ||
    input.lastName !== undefined ||
    input.displayNameOverride !== undefined;
  const derived = nameChanged
    ? deriveContactNames({
        firstName: input.firstName ?? existing.firstName,
        lastName: input.lastName !== undefined ? input.lastName : existing.lastName,
        displayNameOverride:
          input.displayNameOverride !== undefined
            ? input.displayNameOverride
            : existing.displayNameOverride,
      })
    : null;

  const [updated] = await db
    .update(contacts)
    .set({
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.displayNameOverride !== undefined
        ? { displayNameOverride: input.displayNameOverride }
        : {}),
      ...(input.pronouns !== undefined ? { pronouns: input.pronouns } : {}),
      ...(derived
        ? {
            displayName: derived.displayName,
            nameNormalized: derived.nameNormalized,
            dedupNormalized: derived.dedupNormalized,
          }
        : {}),
      ...(input.phone !== undefined
        ? { phone: input.phone ? normalizePhone(input.phone) : input.phone } // feature 032
        : {}),
      isVolunteer,
      needsReview,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, id))
    .returning();
  if (!updated) throw errors.contactNotFound();
  return updated;
}

export type ContactSummary = Pick<
  ContactRow,
  "id" | "displayName" | "membershipStatus" | "listMember" | "pronouns" | "archivedAt"
>;

export type ContactSearchResult = { items: ContactSummary[]; truncated: boolean };

/**
 * Feature 069 (FR-001a). A needs-review row carries more than a search row does, because clearing the
 * flag is a JUDGEMENT that the record is complete enough — so the row must show what that rests on:
 * who the contact is, how they can be reached, and how old the record is.
 */
export type NeedsReviewRow = ContactSummary & {
  phone: string | null;
  emails: string[];
  createdAt: string;
  updatedAt: string;
  /** FR-005: derived from the fields above — see `deriveSafeToClear`. */
  safeToClear: boolean;
};

export type NeedsReviewResult = { items: NeedsReviewRow[]; truncated: boolean };

/**
 * FR-005/FR-006, the needs-review half of the same rule the duplicates queue applies to a pair: the row
 * offers its one action exactly when the row already carries the decision. A record with a name and no
 * way to reach anyone cannot be judged complete from a list — there is nothing on the row to judge — so
 * it offers "open to resolve" instead. Derived from the projected fields, so it cannot outlive them.
 *
 * Exported because PII projection happens at the route (feature 016): a volunteer without
 * `contact.pii.read` is handed rows with the phone and emails stripped, and must therefore be told the
 * row is NOT resolvable in place — the flag describes what THIS reader can see, which is what FR-005 says.
 */
export function deriveSafeToClear(row: { phone: string | null; emails: string[] }): boolean {
  return row.emails.length > 0 || !!row.phone;
}

/**
 * Feature 065 (M-R10): "active contact" = non-merged AND non-archived. Applied everywhere a merged
 * contact is already excluded. `includeArchived` drops ONLY the archived predicate (never the merged
 * one), for the search's "+ archived" toggle.
 */
function activeContact(includeArchived = false) {
  return and(
    isNull(contacts.mergedIntoId),
    includeArchived ? undefined : isNull(contacts.archivedAt),
  );
}

/** Below this many primary (substring) matches, we also surface fuzzy "did you mean" matches. */
const FUZZY_FLOOR = 5;

/**
 * Feature 068 (FR-015): search must report the DERIVED membership, not the cached column.
 *
 * This is the surface it matters most on — the contacts list and the check-in lookup are the most-used
 * screens in the app, and re-pointing only the record would have left them showing a status that was true
 * last membership year. The expiry is fetched in SQL (one round trip, no N+1) and classified in
 * `deriveSummary` below, because the lapse window is a club setting rather than a SQL constant.
 */
const SEARCH_COLS = {
  id: contacts.id,
  displayName: contacts.displayName,
  membershipStatus: contacts.membershipStatus, // cache; overwritten by deriveSummary
  listMember: contacts.listMember, // cache; overwritten by deriveSummary
  pronouns: contacts.pronouns,
  archivedAt: contacts.archivedAt, // feature 065: lets a result row be marked archived
  maxExpiry: sql<string | null>`(
    SELECT MAX(a.expiry_date) FROM membership_members mm
      JOIN membership_accounts a ON a.id = mm.account_id
     WHERE mm.contact_id = contacts.id)`.as("max_expiry"),
};

/** Replace the cached status/list-member on each search row with the derived truth (FR-015). */
async function deriveSummaries<T extends { maxExpiry?: string | null }>(
  db: Db,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const settings = await db.query.clubSettings.findFirst({ where: eq(clubSettings.id, 1) });
  return rows.map((r) => {
    const status = classifyMembership({
      mostRecentExpiry: r.maxExpiry ?? null,
      now: new Date(),
      longLapseCycles: settings?.longLapseCycles ?? 3,
      cycleDefinition: settings?.cycleDefinition ?? "1 year",
    });
    return { ...r, membershipStatus: status, listMember: r.maxExpiry !== null };
  });
}

/** Escape LIKE/ILIKE wildcards in a user needle (Postgres default '\' escape char). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Fetch one past `limit` to detect truncation; slice back to `limit`. */
function withTruncation(rows: ContactSummary[], limit: number): ContactSearchResult {
  const truncated = rows.length > limit;
  return { items: truncated ? rows.slice(0, limit) : rows, truncated };
}

/**
 * Contact search (feature 061 / X-R3). **Substring-PRIMARY and monotonic** — a longer query yields a
 * subset, so typing narrows predictably ("cat" → "Catherine"). Matches a contact by `name_normalized`
 * ∪ `dedup_normalized` (real first/last, ignoring any display override) ∪ a **prefix** of one of their
 * active emails. Trigram similarity is a **secondary** "did you mean" fallback, appended only when the
 * primary result is thin (< FUZZY_FLOOR) and ranked below the exact set. Non-merged only. Empty `q`
 * browses the roster. Returns `{ items, truncated }` (truncated = more matched than `limit`).
 */
export async function searchContacts(
  db: Db,
  q: string,
  limit = 20,
  opts: { orderBy?: "recent" | "name"; includeArchived?: boolean } = {},
): Promise<ContactSearchResult> {
  const active = activeContact(opts.includeArchived); // feature 065
  if (!q.trim()) {
    // Browse the roster: alphabetical by last then first name for the door, else most recent.
    const order =
      opts.orderBy === "name"
        ? [sql`${contacts.lastName} ASC NULLS LAST`, contacts.firstName]
        : [desc(contacts.createdAt)];
    const rows = await db
      .select(SEARCH_COLS)
      .from(contacts)
      .where(active)
      .orderBy(...order)
      .limit(limit + 1);
    return withTruncation(await deriveSummaries(db, rows), limit);
  }

  const needle = normalizeName(q);
  const esc = escapeLike(needle);
  const infix = `%${esc}%`;
  const prefix = `${esc}%`;

  // Primary: substring of the display name OR the dedup key (real first/last) OR an active email prefix.
  const primary = await db
    .select(SEARCH_COLS)
    .from(contacts)
    .where(
      and(
        active,
        sql`(${contacts.nameNormalized} ILIKE ${infix}
          OR ${contacts.dedupNormalized} ILIKE ${infix}
          OR EXISTS (
            SELECT 1 FROM contact_emails ce
            WHERE ce.contact_id = ${contacts.id}
              AND ce.status IN ('active', 'transition')
              AND lower(trim(ce.email::text)) LIKE ${prefix}
          ))`,
      ),
    )
    // Prefix (starts-with) matches before other substrings, then alphabetical — stable + intuitive.
    .orderBy(
      sql`CASE WHEN ${contacts.nameNormalized} ILIKE ${prefix} THEN 0 ELSE 1 END`,
      contacts.nameNormalized,
    )
    .limit(limit + 1);

  if (primary.length >= FUZZY_FLOOR) {
    return withTruncation(await deriveSummaries(db, primary), limit);
  }

  // Thin exact results → append trigram-similar names not already present, ranked after the exact set.
  const seen = new Set(primary.map((r) => r.id));
  const fuzzy = await db
    .select(SEARCH_COLS)
    .from(contacts)
    .where(and(active, sql`${contacts.nameNormalized} % ${needle}`))
    .orderBy(sql`similarity(${contacts.nameNormalized}, ${needle}) DESC`)
    .limit(limit + 1);
  const merged = [...primary];
  for (const r of fuzzy) {
    if (seen.has(r.id)) continue;
    merged.push(r);
    if (merged.length > limit) break;
  }
  return withTruncation(await deriveSummaries(db, merged), limit);
}

/** Feature 064: the needs-review count for the launcher button (active, flagged). */
export async function countNeedsReview(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(contacts)
    .where(and(activeContact(), eq(contacts.needsReview, true)));
  return row?.n ?? 0;
}

/** Feature 064: the needs-review worklist — flagged, active, bounded like search, name-ordered. */
export async function listNeedsReview(db: Db, limit = 20): Promise<NeedsReviewResult> {
  const rows = await db
    .select({
      ...SEARCH_COLS,
      // Feature 069 (FR-001a): the facts the "is this complete?" judgement actually rests on.
      phone: contacts.phone,
      createdAt: contacts.createdAt,
      updatedAt: contacts.updatedAt,
      emails: sql<string[]>`ARRAY(
        SELECT ce.email::text FROM contact_emails ce
         WHERE ce.contact_id = contacts.id AND ce.status = 'active'
         ORDER BY ce.is_login DESC, ce.created_at)`.as("emails"),
    })
    .from(contacts)
    .where(and(activeContact(), eq(contacts.needsReview, true)))
    .orderBy(sql`${contacts.lastName} ASC NULLS LAST`, contacts.firstName)
    .limit(limit + 1);

  // Derive standing the way every other list does — the column is a cache, and a review queue showing a
  // stale one would have Mel judging a record against a fact that is not true.
  const derived = await deriveSummaries(db, rows);
  const items = derived.map((r) => ({
    ...r,
    emails: r.emails ?? [],
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
    safeToClear: deriveSafeToClear({ phone: r.phone, emails: r.emails ?? [] }),
  }));
  const truncated = items.length > limit;
  return { items: truncated ? items.slice(0, limit) : items, truncated };
}

/** Feature 065 (M-R9): archive (retire, reversibly) — set archived_at. */
export async function archiveContact(db: Db, id: string): Promise<ContactRow> {
  const [row] = await db
    .update(contacts)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(contacts.id, id))
    .returning();
  if (!row) throw errors.contactNotFound();
  return row;
}

/** Feature 065 (M-R9): restore (unarchive) — clear archived_at. */
export async function restoreContact(db: Db, id: string): Promise<ContactRow> {
  const [row] = await db
    .update(contacts)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(contacts.id, id))
    .returning();
  if (!row) throw errors.contactNotFound();
  return row;
}

/**
 * Feature 065 (M-R11): the substantive tables whose reference blocks a SAFE delete — the SINGLE source
 * of truth for the guard and its parity test (C15). `contact_emails` (owned, cascades) and audit rows
 * (a log) are deliberately excluded, so a contact whose only references are its own emails is bare.
 *
 * Feature 077 adds two kinds, and one flag:
 *
 * - `merged_contacts` — contacts merged INTO this one. Deleting a survivor deletes them too (the database
 *   cascades down the chain), and if a merge was a mistake a merged-in record may be a different person.
 *   So it blocks the SAFE delete, with advice to undo first; the unrestricted delete may proceed.
 * - `staff_history` — any record of having ACTED as staff. `always` means it blocks the UNRESTRICTED delete
 *   too: anyone who has ever acted as staff is never deleted (decided 2026-09-13), and those five
 *   references refuse at the database regardless. Checked here so the refusal is clean rather than a raw
 *   foreign-key error — and checked across the whole merged-in chain, because deleting a survivor would
 *   reach a merged-in staff actor through the cascade.
 *
 * A parity guard (`contacts.deleteMergeHistory.test.ts`) reads `pg_constraint` and fails on any reference
 * into `contacts` that refuses a delete but is missing from this list — which is how `merge_audit` went
 * unnoticed from feature 003 to feature 077.
 */
export const CONTACT_DELETE_BLOCKERS = [
  // Feature 070: this pointed at the RETIRED `memberships` table, which nothing has written since 068's
  // cutover — so the guard silently stopped protecting household members, and `membership_members`
  // CASCADES on contact delete, quietly detaching them. Same category (the error contract and Mel's
  // label are unchanged); correct table.
  { category: "membership", table: membershipMembers, column: membershipMembers.contactId },
  {
    category: "membership_capture",
    table: membershipCaptures,
    column: membershipCaptures.contactId,
  },
  { category: "attendance", table: attendance, column: attendance.contactId },
  { category: "gate_sale", table: gateSales, column: gateSales.contactId },
  { category: "performer", table: performers, column: performers.contactId },
  { category: "officer", table: officers, column: officers.contactId },
  { category: "role_grant", table: roleGrants, column: roleGrants.contactId },
  { category: "staff_identity", table: staffIdentities, column: staffIdentities.contactId },
  { category: "venue_landlord", table: venues, column: venues.landlordContactId },
  // Feature 068 (FR-009): a payer's contact cannot be deleted from under their membership account. Unlike
  // 067's shared_email this IS a plain contact column, so it rides the generic list. The unrestricted
  // path clears it deliberately (`deleteAccountOwnedBy`) — the only blocking reference it clears.
  {
    category: "membership_account",
    table: membershipAccounts,
    column: membershipAccounts.payerContactId,
  },
  // Feature 077: contacts merged INTO this one. Safe path only — see above.
  { category: "merged_contacts", table: contacts, column: contacts.mergedIntoId },
  // Feature 077: having acted as staff. `always` — blocks the unrestricted delete too.
  {
    category: "staff_history",
    table: auditEvents,
    column: auditEvents.actorContactId,
    always: true,
  },
  { category: "staff_history", table: roleGrants, column: roleGrants.grantedBy, always: true },
  {
    category: "staff_history",
    table: dedupRejections,
    column: dedupRejections.rejectedBy,
    always: true,
  },
  { category: "staff_history", table: heldMerges, column: heldMerges.attemptedBy, always: true },
  {
    category: "staff_history",
    table: contacts,
    column: contacts.volunteerApprovedBy,
    always: true,
  },
  // Feature 082 (FR-033): recording the gate money, a sale, a check or a payment is acting as staff.
  {
    category: "staff_history",
    table: gateSales,
    column: gateSales.recordedByContactId,
    always: true,
  },
  {
    category: "staff_history",
    table: gateChecks,
    column: gateChecks.recordedByContactId,
    always: true,
  },
  {
    category: "staff_history",
    table: doorRecords,
    column: doorRecords.moneyRecordedByContactId,
    always: true,
  },
  {
    category: "staff_history",
    table: performerPayments,
    column: performerPayments.recordedByContactId,
    always: true,
  },
  // Feature 082 (FR-015, FR-038): a check's writer. `always` — the column is NOT NULL, and the books credit
  // the check to that person for as long as the gate record is kept, so no delete may take it.
  {
    category: "check_writer",
    table: gateChecks,
    column: gateChecks.writerContactId,
    always: true,
  },
] as const;

type Blocker = (typeof CONTACT_DELETE_BLOCKERS)[number];
const alwaysBlocks = (b: Blocker) => "always" in b && b.always;

/**
 * Mel reads the refusal, so it must name references in her language — the categories above are table
 * slugs (`gate_sale`, `staff_identity`, `shared_email`) and mean nothing to her. Category slugs stay the
 * machine-readable contract in `error.detail`; these are only for the message.
 */
const BLOCKER_LABELS: Record<string, string> = {
  membership: "a membership",
  membership_capture: "a membership payment",
  attendance: "check-in history",
  gate_sale: "door sales",
  performer: "a performer record",
  officer: "an officer role",
  role_grant: "staff role grants",
  staff_identity: "a staff sign-in",
  venue_landlord: "a venue landlord record",
  shared_email: "other contacts reached at this contact's email",
  membership_account: "a membership account",
  merged_contacts: "other contacts merged into it",
  staff_history: "a history of acting as staff",
  check_writer: "checks they wrote at the door",
};

export const blockerLabel = (category: string): string => BLOCKER_LABELS[category] ?? category;

async function referenced(
  db: DbOrTx,
  table: PgTable,
  column: AnyPgColumn,
  ids: string[],
): Promise<boolean> {
  const rows = await db
    .select({ x: sql`1` })
    .from(table)
    .where(inArray(column, ids))
    .limit(1);
  return rows.length > 0;
}

/**
 * Every contact merged into this one, at any depth. Feature 077: the database cascades a survivor's delete
 * down this chain, so anything that must never be deleted has to be checked across all of it.
 */
async function absorbedChain(db: DbOrTx, id: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE absorbed(id) AS (
      SELECT c.id FROM contacts c WHERE c.merged_into_id = ${id}
      UNION
      SELECT c.id FROM contacts c JOIN absorbed a ON c.merged_into_id = a.id
    )
    SELECT id FROM absorbed
  `);
  return [...rows].map((r) => r.id);
}

/**
 * Feature 065 (M-R11): which substantive categories reference this contact (empty ⇒ bare, safe-delete).
 * Feature 077: `always` blockers are checked across the contact AND everything merged into it.
 */
export async function contactDeleteBlockers(db: DbOrTx, id: string): Promise<string[]> {
  const present = new Set<string>();
  const chain = [id, ...(await absorbedChain(db, id))];
  for (const b of CONTACT_DELETE_BLOCKERS) {
    if (present.has(b.category)) continue;
    if (await referenced(db, b.table, b.column, alwaysBlocks(b) ? chain : [id])) {
      present.add(b.category);
    }
  }
  // Feature 067: other contacts ride this contact's address, so deleting it would leave a household
  // unreachable. Not a plain contact_id column, so it cannot ride the generic blocker list.
  const [riders] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .innerJoin(contactEmails, eq(contactEmails.id, contacts.messageRecipientEmailId))
    .where(eq(contactEmails.contactId, id))
    .limit(1);
  if (riders) present.add("shared_email");
  return [...present];
}

const ALWAYS_CATEGORIES = new Set<string>(
  CONTACT_DELETE_BLOCKERS.filter(alwaysBlocks).map((b) => b.category),
);

/**
 * Feature 065 (M-R11/M-R12): permanently delete a contact. The SAFE path refuses unless the contact is
 * bare; the UNRESTRICTED path (super_user) bypasses the guard — except for `always` blockers, which it
 * never bypasses. Both audit `contact.deleted`.
 *
 * Feature 077: ONE transaction. The unrestricted path clears references and deletes the membership account
 * before deleting the contact, and without a transaction a failure after those writes left them done —
 * observed: the account destroyed and the contact still present.
 */
export async function deleteContact(
  db: Db,
  id: string,
  opts: { unrestricted?: boolean; actor?: string | null } = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await tx.query.contacts.findFirst({ where: eq(contacts.id, id) });
    if (!existing) throw errors.contactNotFound();

    const found = await contactDeleteBlockers(tx, id);
    const blocking = opts.unrestricted ? found.filter((c) => ALWAYS_CATEGORIES.has(c)) : found;
    if (blocking.length > 0) {
      throw errors.contactHasReferences(blocking.map(blockerLabel), blocking);
    }

    // Feature 067 (FR-012): the unrestricted path bypasses the guard above, so referrers must still be
    // cleared AND flagged before the cascade takes this contact's emails. The FK alone would null their
    // pointers without a trace.
    await clearReferencesToOwner(tx, id, opts.actor ?? null);
    // Feature 068 (FR-009): likewise the membership account. Its FK deliberately REFUSES to be orphaned,
    // so the deliberate force path clears it explicitly rather than hitting a raw constraint error.
    await deleteAccountOwnedBy(tx, id, opts.actor ?? null);
    // Feature 077: merge records naming this contact, and any contacts merged into it, go with it — the
    // database cascades both. The safe path has already refused a survivor that absorbed others.
    await tx.delete(contacts).where(eq(contacts.id, id));
    // Durable audit row (FR-010): every permanent deletion is recorded, safe or unrestricted.
    await recordAudit(tx, {
      kind: "contact.deleted",
      actorContactId: opts.actor ?? null,
      details: { contactId: id, unrestricted: !!opts.unrestricted },
    });
  });
}

/** Feature 064 (FR-013): the manual override — clear `needs_review` regardless of contact data. */
export async function markReviewed(db: Db, id: string): Promise<ContactRow> {
  const [row] = await db
    .update(contacts)
    .set({ needsReview: false, updatedAt: new Date() })
    .where(eq(contacts.id, id))
    .returning();
  if (!row) throw errors.contactNotFound();
  return row;
}
