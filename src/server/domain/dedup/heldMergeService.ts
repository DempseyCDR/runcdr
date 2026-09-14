import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { actorCan } from "@/server/auth/can";
import { contactEmails, contacts, heldMerges, staffIdentities } from "@/server/db/schema";
import type { HeldMergeReason } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { recordAudit } from "@/server/lib/audit";
import { heldMergeAnswersSchema, type HeldMergeAnswers } from "@/server/validation/dedup";
import {
  detectHold,
  mergeContacts,
  SUPER_USER_INSTRUCTION,
  type HeldMergeReasonAuthority,
  type MergeOutcome,
} from "./mergeService";

export type HeldMergeItem = {
  id: string;
  reason: HeldMergeReason;
  /** Feature 078 (research R8): who may answer it — so the client never re-derives authority. */
  answerableBy: HeldMergeReasonAuthority;
  canonicalId: string;
  canonicalDisplayName: string;
  mergedId: string;
  mergedDisplayName: string;
  attemptedAt: string;
};

/**
 * Feature 069 (FR-014). A held merge is its OWN piece of work, not a note on a contact — which is why it
 * survives clearing either contact's review flag and why clearing it changes no flag (FR-014a).
 *
 * A hold is closed automatically when the question it asks stops arising: either contact merged away or
 * archived, or the colliding thing gone (one of the two sign-ins withdrawn, one of the two accounts
 * closed). That check runs on read rather than on a trigger, because every path that could remove the
 * cause would otherwise have to remember this table exists.
 */
async function closeStaleHolds(db: Db): Promise<void> {
  await db.execute(sql`
    UPDATE held_merges h
       SET resolved_at = now()
     WHERE h.resolved_at IS NULL
       AND (
         EXISTS (SELECT 1 FROM contacts c
                  WHERE c.id IN (h.canonical_id, h.merged_id)
                    AND (c.merged_into_id IS NOT NULL OR c.archived_at IS NOT NULL))
       )
  `);
}

export async function listHeldMerges(db: Db): Promise<HeldMergeItem[]> {
  await closeStaleHolds(db);
  await closeStaleByDetection(db);
  const rows = await db.execute<{
    id: string;
    reason: HeldMergeReason;
    canonical_id: string;
    canonical_name: string;
    merged_id: string;
    merged_name: string;
    attempted_at: string;
  }>(sql`
    SELECT h.id, h.reason::text AS reason,
           h.canonical_id, ca.display_name AS canonical_name,
           h.merged_id, cb.display_name AS merged_name,
           h.attempted_at
      FROM held_merges h
      JOIN contacts ca ON ca.id = h.canonical_id
      JOIN contacts cb ON cb.id = h.merged_id
     WHERE h.resolved_at IS NULL
     ORDER BY h.attempted_at
  `);
  return [...rows].map((r) => ({
    id: r.id,
    reason: r.reason,
    answerableBy: authorityFor(r.reason),
    canonicalId: r.canonical_id,
    canonicalDisplayName: r.canonical_name,
    mergedId: r.merged_id,
    mergedDisplayName: r.merged_name,
    attemptedAt: String(r.attempted_at),
  }));
}

/** Which authority a hold's reason demands — the route gates on this (FR-012/FR-013). */
export function authorityFor(reason: HeldMergeReason): HeldMergeReasonAuthority {
  switch (reason) {
    // Ordinary duplicate work: which household's account survives.
    case "two_accounts":
      return "dedup.write";
    // Feature 078 (FR-015): super-user is granted only at the command line, so no one answers it here.
    case "super_user":
      return "command_line";
    // Governance decisions (072, 078): which sign-in survives, which roles move, whether a merge may make
    // someone a volunteer.
    case "two_logins":
    case "role_conflict":
    case "volunteer_status":
      return "role.assign";
  }
}

export { SUPER_USER_INSTRUCTION };

/**
 * Feature 078 (FR-005a, research R11): may this actor see — and decline — held merges at all?
 *
 * Duplicate-management OR role-assigning authority. A President holds only the latter, and every hold route
 * used to require the former before checking anything, so a President could not see a single hold — the
 * review queue rendered the 403 as an empty list. `withAuth` accepts one capability, so the routes declare
 * `requires: "base"` and ask this instead.
 */
export function canSeeHolds(actor: Actor): boolean {
  return actorCan(actor, "dedup.write") || actorCan(actor, "role.assign");
}

/** Feature 078 (FR-005): may this actor answer a hold of this reason? Nobody may answer a super-user hold. */
export function canAnswerHold(actor: Actor, reason: HeldMergeReason): boolean {
  const authority = authorityFor(reason);
  return authority !== "command_line" && actorCan(actor, authority);
}

/** Feature 078 (research R3): the stored answers without the one for `reason` — which proved stale. */
function withoutAnswerFor(answers: HeldMergeAnswers, reason: HeldMergeReason): HeldMergeAnswers {
  return Object.fromEntries(
    Object.entries(answers).filter(([k]) => ANSWER_REASON[k as keyof HeldMergeAnswers] !== reason),
  ) as HeldMergeAnswers;
}

/**
 * Feature 072 (FR-010a): close a hold whose obstacle is gone, by asking the SAME question the merge asks.
 *
 * This lives in TypeScript rather than the SQL sweep above deliberately. When the two were written
 * separately they drifted: the sweep counted login addresses while the merge also checked sign-in
 * identities, so clearing one address closed the hold and the next attempt raised it again — a loop with
 * no exit. Calling the detection itself is what makes that impossible.
 *
 * A hold also closes when its cause is removed somewhere else — a conflicting grant withdrawn on the access
 * screen, the survivor designated a volunteer, or made a super-user at the command line. Since feature 078
 * most holds are answered in the held-merge chooser instead; this sweep is what keeps the two routes
 * agreeing, and it drops a stored answer that stopped fitting rather than closing the hold on it.
 */
async function closeStaleByDetection(db: Db): Promise<void> {
  const open = await db.query.heldMerges.findMany({ where: isNull(heldMerges.resolvedAt) });
  for (const h of open) {
    // Feature 078 (research R1): the merge's own detector, given the answers already recorded — so a
    // hold waiting on its second decision is not mistaken for one still needing its first.
    const answers = heldMergeAnswersSchema.parse(h.answers);
    const { hold: blocked } = await detectHold(db, h.canonicalId, h.mergedId, answers);
    if (!blocked) {
      await db.update(heldMerges).set({ resolvedAt: new Date() }).where(eq(heldMerges.id, h.id));
    } else if (blocked.stale) {
      // Feature 078 (FR-010): a stored answer stopped fitting the pair. Drop it and ask that question again
      // — never close the hold on it, and never leave it asking a later question on top of it.
      await db
        .update(heldMerges)
        .set({ reason: blocked.reason, answers: withoutAnswerFor(answers, blocked.reason) })
        .where(eq(heldMerges.id, h.id));
      await recordAudit(db, {
        kind: "dedup.merge_held",
        actorContactId: null,
        details: {
          heldMergeId: h.id,
          reason: blocked.reason,
          previousReason: h.reason,
          stale: blocked.stale,
        },
      });
    } else if (blocked.reason !== h.reason) {
      // The question outstanding changed — an obstacle was removed some other way, or a new one arose.
      // The hold's reason must always be the decision actually outstanding (FR-009).
      await db.update(heldMerges).set({ reason: blocked.reason }).where(eq(heldMerges.id, h.id));
      await recordAudit(db, {
        kind: "dedup.merge_held",
        actorContactId: null,
        details: { heldMergeId: h.id, reason: blocked.reason, previousReason: h.reason },
      });
    }
  }
}

export async function getHeldMerge(db: Db, id: string) {
  await closeStaleHolds(db);
  await closeStaleByDetection(db);
  const row = await db.query.heldMerges.findFirst({
    where: and(eq(heldMerges.id, id), isNull(heldMerges.resolvedAt)),
  });
  if (!row) throw errors.heldMergeNotFound();
  return row;
}

/**
 * Feature 078: an open hold as stored, WITHOUT the detection sweep `getHeldMerge` runs. Answering uses this:
 * the sweep would quietly drop a stale stored answer and move the hold on, so the person answering would be
 * refused for answering the wrong question — when what they need to hear is that an earlier answer stopped
 * fitting (FR-010). Nothing is lost by skipping it: the answer is checked by the detector either way.
 */
export async function getOpenHold(db: Db, id: string) {
  await closeStaleHolds(db);
  const row = await db.query.heldMerges.findFirst({
    where: and(eq(heldMerges.id, id), isNull(heldMerges.resolvedAt)),
  });
  if (!row) throw errors.heldMergeNotFound();
  return row;
}

/** Which question each stored answer settled — so the chooser can say what is already decided. */
const ANSWER_REASON: Record<keyof HeldMergeAnswers, HeldMergeReason> = {
  survivingIdentityId: "two_logins",
  survivingLoginEmailId: "two_logins",
  survivingAccountId: "two_accounts",
  keepGrantIds: "role_conflict",
  carryVolunteer: "volunteer_status",
};

export type HeldMergeDetail = {
  id: string;
  reason: HeldMergeReason;
  canonical: { id: string; displayName: string };
  merged: { id: string; displayName: string };
  answerableBy: HeldMergeReasonAuthority;
  canAnswer: boolean;
  /** Decisions already recorded for this pair, possibly by someone else. */
  answered: HeldMergeReason[];
  /** The current question's candidates, as the detector found them just now (research R9). */
  candidates: unknown;
  /** Set when a stored answer no longer fits the pair (research R3). */
  stale?: string;
};

/**
 * Feature 078 (FR-001, research R9): a hold's question AS IT STANDS NOW. Nothing about it is stored beyond
 * the answers: candidates are recomputed by the merge's own detector on every read, so an account renewed
 * or a sign-in withdrawn while the hold waited shows as it now is.
 */
export async function getHeldMergeDetail(
  db: Db,
  id: string,
  actor: Actor,
): Promise<HeldMergeDetail> {
  // Closes the hold first if its obstacle has gone, and keeps its reason current — so a stale or moved
  // question is never shown.
  const hold = await getHeldMerge(db, id);
  const answers = heldMergeAnswersSchema.parse(hold.answers);
  const { hold: blocked } = await detectHold(db, hold.canonicalId, hold.mergedId, answers);

  const names = await db
    .select({ id: contacts.id, displayName: contacts.displayName })
    .from(contacts)
    .where(sql`${contacts.id} IN (${hold.canonicalId}, ${hold.mergedId})`);
  const nameOf = (contactId: string) => names.find((n) => n.id === contactId)?.displayName ?? "";

  const reason = blocked?.reason ?? hold.reason;
  return {
    id: hold.id,
    reason,
    canonical: { id: hold.canonicalId, displayName: nameOf(hold.canonicalId) },
    merged: { id: hold.mergedId, displayName: nameOf(hold.mergedId) },
    answerableBy: authorityFor(reason),
    canAnswer: canAnswerHold(actor, reason),
    answered: [
      ...new Set((Object.keys(answers) as (keyof HeldMergeAnswers)[]).map((k) => ANSWER_REASON[k])),
    ],
    candidates: blocked?.candidates ?? null,
    ...(blocked?.stale ? { stale: blocked.stale } : {}),
  };
}

/**
 * Feature 072 (FR-017): withdraw a held merge without merging and without changing anyone's access.
 *
 * A hold asks a question, and "leave them alone" is a legitimate answer. Before this, the only exits were
 * to resolve it — which needs the reason's authority — or to remove its cause, which changes somebody's
 * roles or accounts. Neither suits the ordinary case: the person working the queue tried a merge, it
 * stopped, and they decided not to pursue it.
 *
 * This needs only `dedup.write` or `role.assign` (078, FR-005a), because abandoning is non-destructive by
 * construction: a hold never wrote anything, so withdrawing it writes nothing back. It is deliberately
 * NOT a judgement that the pair are different people — that is a rejection, with its own record.
 */
export async function abandonHeldMerge(db: Db, id: string, actor: string): Promise<void> {
  const hold = await getHeldMerge(db, id);
  await db.update(heldMerges).set({ resolvedAt: new Date() }).where(eq(heldMerges.id, hold.id));
  await recordAudit(db, {
    kind: "dedup.merge_abandoned",
    actorContactId: actor,
    details: { heldMergeId: hold.id, reason: hold.reason },
  });
}

/**
 * Apply the choice and complete the merge (FR-012). The choice must actually answer the question the
 * hold asked — a surviving sign-in does not settle which membership account to keep — so a mismatched
 * one is refused rather than quietly ignored, which would leave the merge held for a reason nobody
 * could see from the response.
 *
 * Feature 078: whether the answer still FITS the pair — and whether every answer stored before it still
 * does — is the detector's call, not a second check here (research R1, R3). A stale answer is refused
 * with `HELD_MERGE_STALE`, dropped, and its question asked again.
 */
export async function resolveHeldMerge(
  db: Db,
  id: string,
  choice: HeldMergeAnswers,
  actor: string,
): Promise<MergeOutcome> {
  const hold = await getOpenHold(db, id);
  // FR-015: nobody answers a super-user hold here, whatever authority they hold.
  if (hold.reason === "super_user") throw errors.heldMergeNotAnswerable(SUPER_USER_INSTRUCTION);

  // The choice must answer the question actually asked. A grant list does not settle which account
  // survives, and an account id does not settle who may assign roles.
  const kindAnswered =
    hold.reason === "two_logins"
      ? !!(choice.survivingLoginEmailId || choice.survivingIdentityId) &&
        // FR-012a: the address is a label; the identity is what grants access. Naming the address of a
        // contact whose Google account is bound, while leaving the binding unnamed, settles nothing —
        // which is exactly what feature 069 did.
        !(
          choice.survivingLoginEmailId &&
          !choice.survivingIdentityId &&
          (await labelsABoundSignIn(db, choice.survivingLoginEmailId))
        )
      : hold.reason === "two_accounts"
        ? !!choice.survivingAccountId
        : hold.reason === "role_conflict"
          ? !!choice.keepGrantIds
          : hold.reason === "volunteer_status"
            ? !!choice.carryVolunteer
            : false;
  if (!kindAnswered) throw errors.heldMergeReasonMismatch(hold.reason);

  // Feature 078 (research R2): this answer joins every answer given before it, possibly by someone else,
  // and the merge is retried with all of them — it re-checks every obstacle, so it needs them all.
  const stored = heldMergeAnswersSchema.parse(hold.answers);
  const answers: HeldMergeAnswers = { ...stored, ...choice };
  const { hold: blocked } = await detectHold(db, hold.canonicalId, hold.mergedId, answers);
  if (blocked?.stale) {
    // Drop the stale answer and ask its question again. This person's answer is not stored either: the
    // question it answered is no longer the one outstanding.
    await db
      .update(heldMerges)
      .set({ reason: blocked.reason, answers: withoutAnswerFor(stored, blocked.reason) })
      .where(eq(heldMerges.id, hold.id));
    throw errors.heldMergeStale(blocked.stale);
  }

  const outcome = await mergeContacts(db, hold.canonicalId, hold.mergedId, actor, answers);
  if (outcome.outcome === "completed") {
    await db.update(heldMerges).set({ resolvedAt: new Date() }).where(eq(heldMerges.id, hold.id));
    await recordAudit(db, {
      kind: "dedup.merge_resolved",
      actorContactId: actor,
      details: { heldMergeId: hold.id, reason: hold.reason, answers },
    });
  } else {
    // Held again for the next decision: the same hold, keeping what has been answered so far. Its reason
    // was already moved to the new question by the merge's own `hold()`.
    await db.update(heldMerges).set({ answers }).where(eq(heldMerges.id, hold.id));
  }
  return outcome;
}

/** Does this login address label a contact with a Google account bound? (FR-012a) */
async function labelsABoundSignIn(db: Db, loginEmailId: string): Promise<boolean> {
  const [row] = await db
    .select({ identityId: staffIdentities.id })
    .from(contactEmails)
    .innerJoin(staffIdentities, eq(staffIdentities.contactId, contactEmails.contactId))
    .where(eq(contactEmails.id, loginEmailId));
  return !!row;
}
