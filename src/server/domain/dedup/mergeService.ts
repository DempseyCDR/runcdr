import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/server/db/client";
import {
  contactEmails,
  contacts,
  eventGroups,
  heldMerges,
  membershipAccounts,
  membershipMembers,
  mergeAudit,
  roleGrants,
  series,
  staffIdentities,
  type HeldMergeReason,
} from "@/server/db/schema";
import { UNCONDITIONAL_MOVES } from "./contactReferences";
import { manifestBuilder, rowKey } from "./mergeManifest";
import { CAPABILITIES } from "@/server/auth/capabilities";
import { EXCLUSIVE_ROLES } from "@/server/domain/access/grantService";
import type { Role } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { writeAudit, recordAudit } from "@/server/lib/audit";
import { recomputeContactStatus } from "@/server/domain/membership/membershipService";

/**
 * Who may answer a hold of each kind (FR-012/FR-013). Feature 078 adds `command_line`: a super-user hold,
 * which no one can answer in the app at all.
 */
export type HeldMergeReasonAuthority = "role.assign" | "dedup.write" | "command_line";

/**
 * One contact's sign-in, as a whole (FR-012a): the address that labels it and the Google account that
 * grants it. Feature 078 made it one entry per contact, so the chooser offers a sign-in — never an address
 * from one contact paired with the other's Google account.
 */
export type LoginCandidate = {
  contactId: string;
  contactDisplayName: string;
  loginEmailId: string | null;
  loginEmail: string | null;
  identityId: string | null;
  lastSignInAt: string | null;
};
export type GrantCandidate = {
  grantId: string;
  role: string;
  /** Feature 078: "club-wide", or the series or event group's name. */
  scope: string;
  /** Which side holds it — the exclusivity trigger can come from the survivor's side alone. */
  heldBy: "survivor" | "merged";
  /** Why this grant is contested: it confers role-assigning authority, or it breaks office exclusivity. */
  conflict: "role_assign" | "exclusive";
};

/**
 * Feature 078 (FR-004): one of the merged contact's roles, as the role-conflict question offers it. Every
 * role is offered, not only the contested ones — the answer names ALL the grants that move, so a role left
 * off the list would be dropped by the merge without anyone having chosen to drop it.
 */
export type GrantChoice = Omit<GrantCandidate, "conflict"> & {
  conflict: GrantCandidate["conflict"] | null;
};

/** Feature 078 (FR-015): how a super-user hold proceeds. The command-line tool can grant a role, not remove one. */
export const SUPER_USER_INSTRUCTION =
  "Super-user can only be granted at the command line. Make the contact being kept a super-user there " +
  "(pnpm auth:bootstrap -- --email <their address> --role super_user), and this merge can then be completed.";

/** Feature 078 (FR-011): the approval a carry would bring across with volunteer status. */
export type VolunteerCandidate = { approvedAt: string | null; approvedBy: string | null };

export type AccountCandidate = {
  accountId: string;
  level: string;
  expiryDate: string | null;
  payerDisplayName: string;
  /** Feature 078 (FR-002): enough to tell two accounts apart without opening either. */
  lastPaymentDate: string | null;
  /** Display names of everyone on the account, sorted. */
  members: string[];
};

/**
 * Feature 069 (FR-011/FR-013). A merge has three possible endings, not two.
 *
 * `held` is the one that did not exist before: the merge is impossible to complete without an answer
 * nobody has given, so **nothing is written** and the question is recorded as its own piece of work. The
 * two cases are structurally identical — one login per contact, one account per payer — and both used to
 * surface as a raw Postgres unique-violation, which told Mel nothing and left her no way forward.
 *
 * (Refusals — same contact, already merged — stay thrown `ApiError`s, which is how every other route in
 * the app reports a bad request and what the contract's status table describes.)
 */
export type MergeOutcome =
  | { outcome: "completed"; canonicalId: string; moved: Record<string, number> }
  | {
      outcome: "held";
      reason: "two_logins";
      heldMergeId: string;
      candidates: LoginCandidate[];
    }
  | {
      outcome: "held";
      reason: "two_accounts";
      heldMergeId: string;
      candidates: AccountCandidate[];
    }
  | {
      outcome: "held";
      reason: "role_conflict";
      heldMergeId: string;
      candidates: GrantChoice[];
    }
  | {
      outcome: "held";
      reason: "volunteer_status";
      heldMergeId: string;
      candidates: VolunteerCandidate;
    }
  | {
      outcome: "held";
      reason: "super_user";
      heldMergeId: string;
      candidates: { instruction: string };
    };

export type MergeResolution = {
  /** Feature 072 (FR-009): which of the merged contact's grants move. Empty means none — valid. */
  keepGrantIds?: string[];
  /**
   * Feature 072 (FR-012a): the Google account binding that survives. Named together with
   * `survivingLoginEmailId` — the address alone is a label and settles nothing about access. Feature 078:
   * a sign-in is one contact's, whole, so either may be absent when that contact has none.
   */
  survivingIdentityId?: string;
  /** Chosen by a `role.assign` holder: which sign-in identity survives (FR-012). */
  survivingLoginEmailId?: string;
  /** Chosen by a `dedup.write` holder: which membership account survives. */
  survivingAccountId?: string;
  /**
   * Feature 078 (FR-011): chosen by a `role.assign` holder — the kept contact becomes a volunteer, with the
   * merged contact's approval. There is no `false`: declining is declining the merge.
   */
  carryVolunteer?: true;
};

const loginsOf = (db: DbOrTx, contactId: string) =>
  db
    .select({
      emailId: contactEmails.id,
      email: contactEmails.email,
      contactDisplayName: contacts.displayName,
    })
    .from(contactEmails)
    .innerJoin(contacts, eq(contacts.id, contactEmails.contactId))
    .where(and(eq(contactEmails.contactId, contactId), eq(contactEmails.isLogin, true)));

const identitiesOf = (db: DbOrTx, contactId: string) =>
  db
    .select({ id: staffIdentities.id, lastSignInAt: staffIdentities.lastSignInAt })
    .from(staffIdentities)
    .where(eq(staffIdentities.contactId, contactId));

/** Feature 078 (FR-003): each contact's sign-in, whole. `staff_identities` and the login address are both unique per contact. */
async function signInOf(db: DbOrTx, contactId: string): Promise<LoginCandidate> {
  const [[who], [login], [identity]] = await Promise.all([
    db
      .select({ displayName: contacts.displayName })
      .from(contacts)
      .where(eq(contacts.id, contactId)),
    loginsOf(db, contactId),
    identitiesOf(db, contactId),
  ]);
  return {
    contactId,
    contactDisplayName: who?.displayName ?? "",
    loginEmailId: login?.emailId ?? null,
    loginEmail: login?.email ?? null,
    identityId: identity?.id ?? null,
    lastSignInAt: identity?.lastSignInAt?.toISOString() ?? null,
  };
}

const accountsOf = (db: DbOrTx, contactId: string) =>
  db
    .select({
      accountId: membershipAccounts.id,
      level: membershipAccounts.level,
      expiryDate: membershipAccounts.expiryDate,
      lastPaymentDate: membershipAccounts.lastPaymentDate,
      payerDisplayName: contacts.displayName,
    })
    .from(membershipAccounts)
    .innerJoin(contacts, eq(contacts.id, membershipAccounts.payerContactId))
    .where(eq(membershipAccounts.payerContactId, contactId));

/** Feature 078 (FR-002): the accounts question shows who is on each account — only asked when it is held. */
async function withMembers(
  db: DbOrTx,
  accounts: Omit<AccountCandidate, "members">[],
): Promise<AccountCandidate[]> {
  const rows = await db
    .select({ accountId: membershipMembers.accountId, name: contacts.displayName })
    .from(membershipMembers)
    .innerJoin(contacts, eq(contacts.id, membershipMembers.contactId))
    .where(
      inArray(
        membershipMembers.accountId,
        accounts.map((a) => a.accountId),
      ),
    );
  return accounts.map((a) => ({
    ...a,
    members: rows
      .filter((r) => r.accountId === a.accountId)
      .map((r) => r.name)
      .sort((x, y) => x.localeCompare(y)),
  }));
}

/**
 * Feature 072: can BOTH contacts sign in?
 *
 * A sign-in is an account binding plus the address that labels it, and either can collide —
 * `staff_identities` is unique per contact, the login address unique per contact. Exported because the
 * auto-close must ask exactly this question too: when the two disagreed, clearing one login address
 * closed the hold while the identities still collided, so the next attempt raised it again. A hold that
 * closes without the obstacle being gone is worse than one that stays.
 */
export async function bothCanSignIn(
  db: DbOrTx,
  canonicalId: string,
  mergedId: string,
): Promise<boolean> {
  const [aLogins, bLogins, aIds, bIds] = await Promise.all([
    loginsOf(db, canonicalId),
    loginsOf(db, mergedId),
    identitiesOf(db, canonicalId),
    identitiesOf(db, mergedId),
  ]);
  return (aLogins.length > 0 && bLogins.length > 0) || (aIds.length > 0 && bIds.length > 0);
}

/**
 * Feature 072 (FR-006, FR-007): would this merge compound privilege?
 *
 * Two triggers, both computed from the UNION of the pair's grants because the second can arise wholly
 * from the survivor's side (survivor President + merged Treasurer), where the record being merged
 * carries no role-assigning authority at all.
 *
 * The escalation test is "would GAIN", not "the merged record holds": merging a President into an
 * existing Super-user escalates nothing, since Super-user already supersets it, and holding there would
 * be pointless friction.
 */
export async function findRoleConflicts(
  db: DbOrTx,
  canonicalId: string,
  mergedId: string,
  keepGrantIds?: string[],
): Promise<GrantCandidate[]> {
  const rows = await db
    .select({
      id: roleGrants.id,
      contactId: roleGrants.contactId,
      role: roleGrants.role,
      seriesName: series.name,
      groupName: eventGroups.name,
    })
    .from(roleGrants)
    .leftJoin(series, eq(series.id, roleGrants.seriesId))
    .leftJoin(eventGroups, eq(eventGroups.id, roleGrants.groupId))
    .where(or(eq(roleGrants.contactId, canonicalId), eq(roleGrants.contactId, mergedId)));

  const assigns = (role: string) => "role.assign" in (CAPABILITIES[role as Role] ?? {});
  const survivorRoles = rows.filter((r) => r.contactId === canonicalId).map((r) => r.role);
  // Only grants actually being moved can cause a conflict. When a resolution names a subset, the ones
  // left behind are not moving and therefore compound nothing.
  const movingRows = rows.filter(
    (r) => r.contactId === mergedId && (!keepGrantIds || keepGrantIds.includes(r.id)),
  );

  const out: GrantCandidate[] = [];
  const survivorAssigns = survivorRoles.some(assigns);
  const exclusiveAfter = new Set(
    [...survivorRoles, ...movingRows.map((r) => r.role)].filter((r) =>
      EXCLUSIVE_ROLES.includes(r as Role),
    ),
  );

  for (const r of movingRows) {
    // Escalation: the survivor would gain role-assigning authority it does not already hold.
    if (assigns(r.role) && !survivorAssigns) {
      out.push({
        grantId: r.id,
        role: r.role,
        scope: r.seriesName ?? r.groupName ?? "club-wide",
        heldBy: "merged",
        conflict: "role_assign",
      });
      continue;
    }
    // Exclusivity: the union would leave one person holding two of the three exclusive offices.
    if (EXCLUSIVE_ROLES.includes(r.role as Role) && exclusiveAfter.size > 1) {
      out.push({
        grantId: r.id,
        role: r.role,
        scope: r.seriesName ?? r.groupName ?? "club-wide",
        heldBy: "merged",
        conflict: "exclusive",
      });
    }
  }
  return out;
}

/** Feature 078 (FR-004): every role the merged contact holds, each marked with why it conflicts, if it does. */
async function grantChoices(
  db: DbOrTx,
  canonicalId: string,
  mergedId: string,
): Promise<GrantChoice[]> {
  const [conflicts, rows] = await Promise.all([
    findRoleConflicts(db, canonicalId, mergedId),
    db
      .select({
        id: roleGrants.id,
        role: roleGrants.role,
        seriesName: series.name,
        groupName: eventGroups.name,
      })
      .from(roleGrants)
      .leftJoin(series, eq(series.id, roleGrants.seriesId))
      .leftJoin(eventGroups, eq(eventGroups.id, roleGrants.groupId))
      .where(eq(roleGrants.contactId, mergedId)),
  ]);
  return rows.map((r) => ({
    grantId: r.id,
    role: r.role,
    scope: r.seriesName ?? r.groupName ?? "club-wide",
    heldBy: "merged",
    conflict: conflicts.find((c) => c.grantId === r.id)?.conflict ?? null,
  }));
}

/**
 * Record the hold, or return the one already standing for this pair. Kept OUTSIDE the merge transaction
 * on purpose: a hold must survive precisely because the merge did not happen.
 */
async function hold(
  db: Db,
  canonicalId: string,
  mergedId: string,
  reason: HeldMergeReason,
  actor: string,
): Promise<string> {
  const existing = await db.query.heldMerges.findFirst({
    where: and(
      eq(heldMerges.canonicalId, canonicalId),
      eq(heldMerges.mergedId, mergedId),
      sql`${heldMerges.resolvedAt} IS NULL`,
    ),
  });
  if (existing) {
    // Feature 078 (FR-009): a pair has one open hold, and its reason must be the decision still
    // outstanding. This used to return the hold unchanged whatever it asked — so once its first question
    // was answered and the retry needed a different one, the queue kept asking the answered question and
    // answering it again changed nothing.
    if (existing.reason !== reason) {
      await db.update(heldMerges).set({ reason }).where(eq(heldMerges.id, existing.id));
      await recordAudit(db, {
        kind: "dedup.merge_held",
        actorContactId: actor,
        details: { canonicalId, mergedId, reason, previousReason: existing.reason },
      });
    }
    return existing.id;
  }

  const [row] = await db
    .insert(heldMerges)
    .values({ canonicalId, mergedId, reason, attemptedBy: actor })
    .returning({ id: heldMerges.id });
  await recordAudit(db, {
    kind: "dedup.merge_held",
    actorContactId: actor,
    details: { canonicalId, mergedId, reason },
  });
  return row!.id;
}

/**
 * Feature 078: what `detectHold` found still blocking a merge. `stale` is set when an answer for this
 * reason WAS given but no longer fits the pair — it is reported, never treated as settling (research R3).
 */
export type HoldDetection =
  | { reason: "two_logins"; candidates: LoginCandidate[]; stale?: string }
  | { reason: "two_accounts"; candidates: AccountCandidate[]; stale?: string }
  | { reason: "role_conflict"; candidates: GrantChoice[]; stale?: string }
  | { reason: "volunteer_status"; candidates: VolunteerCandidate; stale?: undefined }
  | { reason: "super_user"; candidates: { instruction: string }; stale?: undefined };

/**
 * Feature 078: the assessment of a merge — what still blocks it, and which answers actually apply.
 *
 * `apply` holds ONLY answers that settle a question the pair actually raises right now and are valid for
 * it. An answer to a question that no longer arises is moot and is dropped, never applied: the merge's
 * choice-applying code deletes records (the unchosen account, the unchosen sign-in), so an answer that
 * does not fit the pair must never reach it.
 */
export type MergeAssessment = { hold: HoldDetection | null; apply: MergeResolution };

/**
 * Feature 078 (research R1, R3): the ONLY place that decides what blocks a merge.
 *
 * The merge calls it before writing anything, the held-merge chooser calls it to show the question, and
 * the auto-close calls it to decide whether a hold is still blocked. Feature 072 is why there is one:
 * the auto-close and the merge detection there asked different versions of "can both of these sign in?",
 * so a hold closed and the next attempt raised it again, forever.
 *
 * Checks run in a fixed order — super-user, accounts, volunteer status, sign-ins, roles — and the first
 * unsettled one is returned. The order follows dependency, not authority: super-user first because nothing
 * else is worth answering for a merge that cannot complete here; volunteer status before sign-ins because
 * whether the survivor may sign in at all decides whether choosing a sign-in means anything; accounts
 * before both because no access decision changes it. An answer settles its question
 * only if it is valid for the pair NOW — corrected at `/speckit-analyze`, because the account fold
 * deletes every account of the pair except the chosen one, and an answer counted merely for being present
 * would have let a foreign account id delete both.
 *
 * ## Every access rule, and what a merge does about it (FR-016, research R7)
 *
 * A merge moves roles and sign-ins by SQL, so it walks past every rule the access services enforce unless
 * a check here stops it. Volunteer status and super-user were found exactly that way, in 074's manual pass
 * and while specifying 078. **A new rule in `grantRole`, `assertExclusivity`, `approveVolunteer` or
 * `clearVolunteer` needs a matching check here**, or a merge will walk past it too.
 *
 * - Super-user is granted only at the command line (`grantRole`) → `super_user`, unanswerable in the app.
 * - A grant's subject must be a volunteer (`grantRole`, `approveVolunteer`) → `volunteer_status`.
 * - Clearing a volunteer revokes every grant (`clearVolunteer`) → the same invariant; `volunteer_status`.
 * - President, VP and Treasurer are exclusive (`assertExclusivity`) → `role_conflict`.
 * - Role-assigning authority is never gained silently (a merge-only rule) → `role_conflict`.
 * - A grant's series or event group must exist (`grantRole`) → cannot be violated: grants move with
 *   scopes that already exist.
 * - Financial Secretary alongside an authority office → advisory warning computed on read; nothing to hold.
 */
export async function detectHold(
  db: DbOrTx,
  canonicalId: string,
  mergedId: string,
  answers: MergeResolution = {},
): Promise<MergeAssessment> {
  const apply: MergeResolution = {};

  // ---- super-user (feature 078) --------------------------------------------------------------------
  // First, and on the pair's grants as they stand — never on which grants an answer would move. Leaving
  // super-user behind is not an answer: Rich's rule is that a super-user merges only INTO a super-user,
  // and anything else is done at the command line, where super-user is granted.
  const superUsers = await db
    .select({ contactId: roleGrants.contactId })
    .from(roleGrants)
    .where(
      and(
        eq(roleGrants.role, "super_user"),
        or(eq(roleGrants.contactId, canonicalId), eq(roleGrants.contactId, mergedId)),
      ),
    );
  if (
    superUsers.some((g) => g.contactId === mergedId) &&
    !superUsers.some((g) => g.contactId === canonicalId)
  ) {
    return {
      hold: { reason: "super_user", candidates: { instruction: SUPER_USER_INSTRUCTION } },
      apply,
    };
  }

  // ---- two paying accounts (feature 069) -----------------------------------------------------------
  // Straight after the unanswerable question (078, from the manual pass): no access decision changes
  // which membership account survives, so the mailing-list manager's question never waits on an officer's.
  const [canonicalAccounts, mergedAccounts] = await Promise.all([
    accountsOf(db, canonicalId),
    accountsOf(db, mergedId),
  ]);
  if (canonicalAccounts.length > 0 && mergedAccounts.length > 0) {
    const candidates = await withMembers(db, [...canonicalAccounts, ...mergedAccounts]);
    if (!answers.survivingAccountId) {
      return { hold: { reason: "two_accounts", candidates }, apply };
    }
    if (!candidates.some((a) => a.accountId === answers.survivingAccountId)) {
      return {
        hold: {
          reason: "two_accounts",
          candidates,
          stale:
            "The membership account chosen for this merge no longer belongs to either contact.",
        },
        apply,
      };
    }
    apply.survivingAccountId = answers.survivingAccountId;
  }

  // ---- volunteer status (feature 078) --------------------------------------------------------------
  // Before the sign-in question: whether the kept contact may sign in at all decides whether choosing
  // which sign-in survives means anything. Completing this silently is what locked a mailing-list manager
  // out in 074's manual pass — her roles and Google account landed on a contact that could not sign in.
  const [canonicalRow, mergedRow] = await Promise.all([
    db.query.contacts.findFirst({ where: eq(contacts.id, canonicalId) }),
    db.query.contacts.findFirst({ where: eq(contacts.id, mergedId) }),
  ]);
  if (mergedRow?.isVolunteer && !canonicalRow?.isVolunteer) {
    if (!answers.carryVolunteer) {
      const approver = mergedRow.volunteerApprovedBy
        ? await db.query.contacts.findFirst({
            where: eq(contacts.id, mergedRow.volunteerApprovedBy),
          })
        : undefined;
      return {
        hold: {
          reason: "volunteer_status",
          candidates: {
            approvedAt: mergedRow.volunteerApprovedAt?.toISOString() ?? null,
            approvedBy: approver?.displayName ?? null,
          },
        },
        apply,
      };
    }
    apply.carryVolunteer = true;
  }

  // ---- two sign-ins (feature 069, corrected in 072) ----------------------------------------------
  if (await bothCanSignIn(db, canonicalId, mergedId)) {
    const candidates = await Promise.all([signInOf(db, canonicalId), signInOf(db, mergedId)]);
    const given = answers.survivingLoginEmailId || answers.survivingIdentityId;
    if (given) {
      const chosen = candidates.find(
        (c) =>
          (c.loginEmailId ?? undefined) === answers.survivingLoginEmailId &&
          (c.identityId ?? undefined) === answers.survivingIdentityId,
      );
      // FR-012a: the address is only a label. The answer must name ONE contact's sign-in exactly as it
      // stands — its address and its Google account together, or only what that contact has.
      if (!chosen) {
        return {
          hold: {
            reason: "two_logins",
            candidates,
            stale: "The sign-in chosen for this merge no longer belongs to either contact.",
          },
          apply,
        };
      }
      apply.survivingLoginEmailId = answers.survivingLoginEmailId;
      if (answers.survivingIdentityId) apply.survivingIdentityId = answers.survivingIdentityId;
    } else {
      return { hold: { reason: "two_logins", candidates }, apply };
    }
  }

  // ---- role conflict (feature 072) -----------------------------------------------------------------
  // Asked first WITHOUT any answer: a kept-grants answer to a conflict that no longer arises is moot.
  if ((await findRoleConflicts(db, canonicalId, mergedId)).length > 0) {
    if (answers.keepGrantIds) {
      const mergedGrants = await db
        .select({ id: roleGrants.id })
        .from(roleGrants)
        .where(eq(roleGrants.contactId, mergedId));
      const own = new Set(mergedGrants.map((g) => g.id));
      if (!answers.keepGrantIds.every((id) => own.has(id))) {
        return {
          hold: {
            reason: "role_conflict",
            candidates: await grantChoices(db, canonicalId, mergedId),
            stale: "A role chosen to move with this merge is no longer held by the merged contact.",
          },
          apply,
        };
      }
    }
    const remaining = await findRoleConflicts(db, canonicalId, mergedId, answers.keepGrantIds);
    if (remaining.length > 0) {
      return {
        hold: {
          reason: "role_conflict",
          candidates: await grantChoices(db, canonicalId, mergedId),
        },
        apply,
      };
    }
    apply.keepGrantIds = answers.keepGrantIds;
  }

  return { hold: null, apply };
}

/**
 * Admin-confirmed, transactional merge (no automatic merges). Re-links all related records from the
 * merged contact to the canonical one, soft-retires the merged contact via merged_into_id, recomputes
 * the canonical status, and writes an append-only merge audit row.
 *
 * Feature 069: both collisions are detected BEFORE anything is written, so a held merge leaves the data
 * exactly as it found it — there is no partial merge to unpick and nothing to explain to Mel afterwards.
 *
 * Feature 078: detection is `detectHold`'s, and only the answers it judges applicable are used below.
 */
export async function mergeContacts(
  db: Db,
  canonicalId: string,
  mergedId: string,
  actor: string,
  resolution: MergeResolution = {},
): Promise<MergeOutcome> {
  if (canonicalId === mergedId) throw errors.sameContact();

  const canonical = await db.query.contacts.findFirst({ where: eq(contacts.id, canonicalId) });
  const merged = await db.query.contacts.findFirst({ where: eq(contacts.id, mergedId) });
  if (!canonical || !merged) throw errors.contactNotFound();
  if (canonical.mergedIntoId !== null || merged.mergedIntoId !== null) throw errors.alreadyMerged();

  const { hold: blocked, apply } = await detectHold(db, canonicalId, mergedId, resolution);
  // Defence in depth (analyze U1): never merge on an answer that does not fit the pair. The held-merge
  // service reports this to the answerer first; reaching here with one is a bug, and must not delete.
  if (blocked?.stale) throw errors.heldMergeStale(blocked.stale);
  if (blocked) {
    const heldMergeId = await hold(db, canonicalId, mergedId, blocked.reason, actor);
    return { outcome: "held", heldMergeId, ...blocked } as MergeOutcome;
  }

  // The account fold needs the pair's accounts; `apply.survivingAccountId` is set only when both sides
  // pay and the chosen account is one of theirs.
  const [canonicalAccounts, mergedAccounts] = apply.survivingAccountId
    ? await Promise.all([accountsOf(db, canonicalId), accountsOf(db, mergedId)])
    : [[], []];

  return db.transaction(async (tx) => {
    // Feature 074 (FR-001 to FR-005): the merge records what it does as it does it. Accumulated here and
    // written with the merge audit row below — one insert, one transaction, so a merge cannot commit
    // without its manifest and therefore cannot become an un-reversible merge nobody can identify as
    // one. Names inside the manifest are always the DATABASE's (snake_case); see `mergeManifest.ts`.
    const manifest = manifestBuilder();

    // Feature 072 (FR-012, FR-012a): apply the sign-in choice as ONE thing. The identity that was not
    // chosen is DELETED, not moved — `staff_identities` is unique per contact, and sign-in auto-enrols,
    // so the person simply signs in with the surviving Google account. That is FR-006 (one account per
    // person) working as designed, not a lockout.
    //
    // Feature 078: the choice is one contact's sign-in, which may have no Google account bound — choosing
    // it discards the other contact's binding all the same, or that account would go on granting access.
    const signInChosen = !!(apply.survivingIdentityId || apply.survivingLoginEmailId);
    if (signInChosen) {
      // Feature 074: snapshot in full before deleting. `google_sub` is the only durable handle on a
      // Google account — an id recorded without it could never be re-created.
      const discarded = [
        ...(await tx.execute<Record<string, unknown>>(sql`
          DELETE FROM staff_identities
           WHERE contact_id IN (${canonicalId}, ${mergedId})
             ${apply.survivingIdentityId ? sql`AND id <> ${apply.survivingIdentityId}` : sql``}
          RETURNING *
        `)),
      ];
      for (const row of discarded) {
        manifest.destroy({
          table: "staff_identities",
          key: rowKey(row, ["id"]),
          row,
          accessChanging: true,
        });
      }
      // The chosen binding may itself be the merged contact's, in which case it MOVES. Recording the
      // move conditionally matters: claiming a move that did not happen would make the undo take the
      // survivor's own binding away from it. After the discard, a binding left on the merged contact can
      // only be the chosen one.
      const relinked = [
        ...(await tx.execute<Record<string, unknown>>(sql`
          UPDATE staff_identities SET contact_id = ${canonicalId}
           WHERE contact_id = ${mergedId}
          RETURNING id
        `)),
      ];
      for (const row of relinked) {
        manifest.move({
          table: "staff_identities",
          column: "contact_id",
          key: rowKey(row, ["id"]),
          fromContactId: mergedId,
          accessChanging: true,
        });
      }
    } else {
      // Uncontested: only one side can sign in, so it simply moves — preserving `last_sign_in_at`, and
      // sparing the person a needless re-enrolment round trip (FR-011).
      const relinked = [
        ...(await tx.execute<Record<string, unknown>>(sql`
          UPDATE staff_identities SET contact_id = ${canonicalId}
           WHERE contact_id = ${mergedId}
          RETURNING id
        `)),
      ];
      for (const row of relinked) {
        manifest.move({
          table: "staff_identities",
          column: "contact_id",
          key: rowKey(row, ["id"]),
          fromContactId: mergedId,
          accessChanging: true,
        });
      }
    }

    // The label follows the binding.
    if (signInChosen) {
      // Feature 074 (FR-003): capture the prior value before overwriting it. This is the one operation
      // that changes a row the merge leaves in place, so there is no deleted row to snapshot — only the
      // flag itself, which is what actually labels who may sign in.
      const demoted = [
        ...(await tx.execute<Record<string, unknown>>(sql`
          UPDATE contact_emails SET is_login = false
           WHERE contact_id IN (${canonicalId}, ${mergedId})
             AND is_login = true
             ${apply.survivingLoginEmailId ? sql`AND id <> ${apply.survivingLoginEmailId}` : sql``}
          RETURNING id
        `)),
      ];
      for (const row of demoted) {
        manifest.overwrite({
          table: "contact_emails",
          key: rowKey(row, ["id"]),
          column: "is_login",
          previousValue: true,
          accessChanging: true,
        });
      }
    }

    // Apply the account choice the same way: fold the losing household in, then drop the empty account.
    // Nobody attached to the account that was NOT kept loses their membership because of this merge.
    // ⚠️ DESTRUCTIVE: the account not chosen is DELETED, taking its level, expiry and last-payment date
    // with it. Only the attachments survive, moved onto the surviving account.
    if (apply.survivingAccountId) {
      const losing = [...canonicalAccounts, ...mergedAccounts]
        .map((a) => a.accountId)
        .filter((id) => id !== apply.survivingAccountId);
      for (const accountId of losing) {
        // Feature 074 (FR-004): RETURNING yields only the rows actually inserted, because
        // ON CONFLICT DO NOTHING silently skips anyone already on the surviving account. Those are the
        // rows an undo must take away again — without recording them the survivor would keep a
        // household it never had.
        const created = [
          ...(await tx.execute<Record<string, unknown>>(sql`
            INSERT INTO membership_members (account_id, contact_id)
            SELECT ${apply.survivingAccountId}, mm.contact_id
              FROM membership_members mm WHERE mm.account_id = ${accountId}
            ON CONFLICT DO NOTHING
            RETURNING account_id, contact_id
          `)),
        ];
        for (const row of created) {
          manifest.create({
            table: "membership_members",
            key: rowKey(row, ["account_id", "contact_id"]),
          });
        }

        // ⚠️ Feature 074 (FR-002), and the reason this block is not symmetric with the one above:
        // `membership_members.account_id` is ON DELETE CASCADE, so deleting the account below destroys
        // EVERY household row on it — including the ones the INSERT just skipped, which were therefore
        // never copied anywhere. No statement in this merge names those rows; they simply vanish. They
        // must be snapshotted here, before the delete, or an undo restores the account with an empty
        // household and loses each member's original `attached_at`.
        const cascaded = [
          ...(await tx.execute<Record<string, unknown>>(sql`
            SELECT * FROM membership_members WHERE account_id = ${accountId}
          `)),
        ];
        for (const row of cascaded) {
          manifest.destroy({
            table: "membership_members",
            key: rowKey(row, ["account_id", "contact_id"]),
            row,
          });
        }

        // The account itself, in full: level, expiry and last-payment date all die with it.
        const [discardedAccount] = [
          ...(await tx.execute<Record<string, unknown>>(sql`
            DELETE FROM membership_accounts WHERE id = ${accountId} RETURNING *
          `)),
        ];
        if (discardedAccount) {
          manifest.destroy({
            table: "membership_accounts",
            key: rowKey(discardedAccount, ["id"]),
            row: discardedAccount,
          });
        }
      }
    }

    // ---------------------------------------------------------------- collisions, then the move
    //
    // Feature 072 (FR-001, FR-008). Two references carry a unique constraint the survivor may already
    // satisfy, so the losing row is dropped rather than the merge failing on a raw constraint error —
    // the failure mode feature 069 exists to eliminate. Both are genuinely the same fact recorded twice:
    // the duplicate was added to one household under two spellings, or attended one event under two
    // names. Feature 074 (FR-002): the dropped row is now snapshotted in full before it goes, so the
    // drop is recorded rather than silent and an undo can put the duplicate back.
    const droppedMembers = [
      ...(await tx.execute<Record<string, unknown>>(sql`
        DELETE FROM membership_members m
         WHERE m.contact_id = ${mergedId}
           AND EXISTS (SELECT 1 FROM membership_members s
                        WHERE s.account_id = m.account_id AND s.contact_id = ${canonicalId})
        RETURNING *
      `)),
    ];
    for (const row of droppedMembers) {
      manifest.destroy({
        table: "membership_members",
        key: rowKey(row, ["account_id", "contact_id"]),
        row,
      });
    }
    const droppedAttendance = [
      ...(await tx.execute<Record<string, unknown>>(sql`
        DELETE FROM attendance a
         WHERE a.contact_id = ${mergedId}
           AND EXISTS (SELECT 1 FROM attendance s
                        WHERE s.event_id = a.event_id AND s.contact_id = ${canonicalId})
        RETURNING *
      `)),
    ];
    for (const row of droppedAttendance) {
      manifest.destroy({ table: "attendance", key: rowKey(row, ["id"]), row });
    }

    // Feature 072 (FR-008): grants move only once the conflict check above has passed. A resolution may
    // name a subset; anything not named stays on the retired contact, where nothing reads it. The
    // duplicate is dropped rather than colliding — the same person plausibly holds the same role at the
    // same scope on both records.
    const movedGrants = await tx
      .update(roleGrants)
      .set({ contactId: canonicalId })
      .where(
        and(
          eq(roleGrants.contactId, mergedId),
          // `inArray` with an empty list compiles to `false`, which is exactly right: naming no grants
          // means none move.
          ...(apply.keepGrantIds ? [inArray(roleGrants.id, apply.keepGrantIds)] : []),
          sql`NOT EXISTS (
            SELECT 1 FROM role_grants s
             WHERE s.contact_id = ${canonicalId} AND s.role = ${roleGrants.role}
               AND s.series_id IS NOT DISTINCT FROM ${roleGrants.seriesId}
               AND s.group_id IS NOT DISTINCT FROM ${roleGrants.groupId})`,
        ),
      )
      .returning({ id: roleGrants.id });
    for (const row of movedGrants) {
      manifest.move({
        table: "role_grants",
        column: "contact_id",
        key: { id: row.id },
        fromContactId: mergedId,
      });
    }

    // The relink itself is driven by the CLASSIFICATION, not by tables named here (FR-002). That is the
    // whole point: feature 068 retired the membership tables and this service went on relinking the old
    // pair for two releases, because the only statement of what to move was the code doing the moving.
    // A newly classified reference is now carried without touching this file.
    //
    // Identifiers come from `contactReferences.ts` — our own constant, never user input — so building
    // the statement with `sql.identifier` is safe.
    const moved: Record<string, number> = { role_grants: movedGrants.length };
    for (const ref of UNCONDITIONAL_MOVES) {
      // Feature 074 (FR-001): the statement returns each moved row's KEY rather than a bare `1`, so the
      // move is recorded reversibly. The key is the one the classification declares, which is why
      // `membership_members` — composite key, no `id`, and its `contact_id` rewritten by this very
      // statement — is carried here without a special case. RETURNING yields post-update values, so the
      // key is the row's identity AS IT NOW STANDS, which is what an undo will look it up by.
      const pkColumns = ref.pk.map((c) => c.name);
      const rows = [
        ...(await tx.execute<Record<string, unknown>>(sql`
          UPDATE ${sql.identifier(ref.table)}
             SET ${sql.identifier(ref.column)} = ${canonicalId}
           WHERE ${sql.identifier(ref.column)} = ${mergedId}
          RETURNING ${sql.join(
            pkColumns.map((c) => sql.identifier(c)),
            sql`, `,
          )}
        `)),
      ];
      for (const row of rows) {
        manifest.move({
          table: ref.table,
          column: ref.column,
          key: rowKey(row, pkColumns),
          fromContactId: mergedId,
        });
      }
      moved[ref.table] = rows.length;
    }

    // Soft-retire the merged contact: the row itself survives intact — names, phone, pronouns, source
    // and timestamps are all untouched — so clearing `merged_into_id` brings the contact back.
    //
    // Feature 074: that clearing is now one step of a real undo rather than a tantalising half-measure.
    // Everything above has been recorded in `manifest`, so the relinking is no longer one-way — see
    // `undoMergeService.ts`. Merges recorded BEFORE 074 remain permanently un-reversible, because their
    // `reversal_manifest` is NULL and nothing can reconstruct it.
    // Feature 078 (FR-011, FR-013): carry volunteer status — the officer's answer. Recorded as access-
    // changing overwrites, so undoing it needs the same authority as undoing a moved Google account.
    if (apply.carryVolunteer) {
      const [before] = await tx.select().from(contacts).where(eq(contacts.id, canonicalId));
      const [from] = await tx.select().from(contacts).where(eq(contacts.id, mergedId));
      await tx
        .update(contacts)
        .set({
          isVolunteer: true,
          volunteerApprovedAt: from!.volunteerApprovedAt,
          volunteerApprovedBy: from!.volunteerApprovedBy,
        })
        .where(eq(contacts.id, canonicalId));
      const key = rowKey({ id: canonicalId }, ["id"]);
      for (const [column, previousValue] of [
        ["is_volunteer", before!.isVolunteer],
        ["volunteer_approved_at", before!.volunteerApprovedAt?.toISOString() ?? null],
        ["volunteer_approved_by", before!.volunteerApprovedBy],
      ] as const) {
        manifest.overwrite({ table: "contacts", key, column, previousValue, accessChanging: true });
      }
    }

    await tx
      .update(contacts)
      .set({ mergedIntoId: canonicalId, updatedAt: new Date() })
      .where(eq(contacts.id, mergedId));

    // Canonical may have gained membership coverage → recompute its cached status.
    await recomputeContactStatus(tx, canonicalId, "membership_change", actor);

    // Feature 074 (FR-005): the manifest rides the merge's OWN audit insert, inside this transaction.
    // Not a second write — a merge that committed while its manifest failed would be un-reversible and
    // indistinguishable from a pre-074 merge, which is the one outcome this feature cannot allow.
    const [auditRow] = await tx
      .insert(mergeAudit)
      .values({
        canonicalId,
        mergedId,
        actor,
        relinkedCounts: moved,
        reversalManifest: manifest.build(),
      })
      .returning({ id: mergeAudit.id });
    if (apply.carryVolunteer) {
      await recordAudit(tx, {
        kind: "volunteer.designated",
        actorContactId: actor,
        details: { subject: canonicalId, via: "merge", mergeAuditId: auditRow!.id },
      });
    }
    writeAudit({ kind: "contact.merge", actor, details: { canonicalId, mergedId, moved } });

    return { outcome: "completed" as const, canonicalId, moved };
  });
}
