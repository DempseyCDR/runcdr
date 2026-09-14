import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import {
  auditEvents,
  contactEmails,
  contacts,
  heldMerges,
  membershipAccounts,
  membershipMembers,
  roleGrants,
  staffIdentities,
} from "@/server/db/schema";
import type { Role } from "@/server/db/schema";
import {
  contactRow,
  makeActor,
  makeBaseActor,
  makeContactWithEmail,
  makeMembershipAccount,
} from "./helpers/factories";
import { jsonReq, jsonReqAs, ctx } from "./helpers/http";
import { bootstrapOfficer } from "@/server/db/bootstrapOfficer";
import { GET as LIST_HELD } from "@/app/api/dedup/held/route";
import { DELETE as ABANDON_HELD, GET as OPEN_HELD } from "@/app/api/dedup/held/[id]/route";
import { POST as RESOLVE_HELD } from "@/app/api/dedup/held/[id]/resolve/route";
import { mergeContacts } from "@/server/domain/dedup/mergeService";
import { listHeldMerges, resolveHeldMerge } from "@/server/domain/dedup/heldMergeService";
import { detectHold } from "@/server/domain/dedup/mergeService";
import { getMergeSuggestions } from "@/server/domain/dedup/suggestionService";
import { designateVolunteer } from "@/server/domain/access/grantService";
import { resolveSignIn } from "@/server/auth/signIn";
import { heldResolveSchema } from "@/server/validation/dedup";

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

const contact = async (name: string) =>
  (await db.insert(contacts).values(contactRow(name)).returning())[0]!.id;

const grant = async (contactId: string, role: Role) =>
  (await db.insert(roleGrants).values({ contactId, role }).returning())[0]!.id;

const holdRow = async (id: string) =>
  db.query.heldMerges.findFirst({ where: eq(heldMerges.id, id) });

/**
 * A pair raising TWO questions: both pay for a membership (the mailing-list manager's decision) and the
 * merge would put two exclusive offices on one person (an officer's). The accounts question comes first
 * in detection order.
 */
async function twoDecisionPair() {
  const survivor = await contact("Pres Ident");
  const merged = await contact("Tres Urer");
  await grant(survivor, "president");
  const treasurerGrant = await grant(merged, "treasurer");
  const { accountId: keep } = await makeMembershipAccount({
    payerContactId: survivor,
    expiryDate: "2027-01-01",
  });
  await makeMembershipAccount({ payerContactId: merged, expiryDate: "2028-01-01" });
  const mel = await contact("Mel Actor");
  const officer = await contact("Vee Pee");
  return { survivor, merged, treasurerGrant, keep, mel, officer };
}

/**
 * Feature 078 (research R2). A retried merge re-checks every obstacle from scratch, so it needs every
 * earlier answer — and they come from different people at different times. Only the hold can carry them.
 *
 * This is also the stuck pair found while specifying: the hold used to keep its FIRST reason forever, so
 * after the accounts question was answered the queue went on asking it, and answering it again changed
 * nothing.
 */
describe("answers accumulate on the hold, and its reason is always the outstanding one (078)", () => {
  it("carries the first person's answer into the second person's decision", async () => {
    const { survivor, merged, keep, mel, officer } = await twoDecisionPair();

    const first = await mergeContacts(db, survivor, merged, mel);
    if (first.outcome !== "held") throw new Error("expected held");
    expect(first.reason).toBe("two_accounts");

    // The mailing-list manager answers the question that is hers.
    const second = await resolveHeldMerge(db, first.heldMergeId, { survivingAccountId: keep }, mel);
    if (second.outcome !== "held") throw new Error("expected the merge to be held again");
    expect(second.reason).toBe("role_conflict");
    // The SAME hold, now asking its next question, with the first answer kept on it.
    expect(second.heldMergeId).toBe(first.heldMergeId);
    const row = await holdRow(first.heldMergeId);
    expect(row?.reason).toBe("role_conflict");
    expect(row?.answers).toMatchObject({ survivingAccountId: keep });

    // The queue asks the outstanding question — never the one already answered (FR-009).
    const queue = await listHeldMerges(db);
    expect(queue).toHaveLength(1);
    expect(queue[0]!.reason, "the queue is still asking the answered question").toBe(
      "role_conflict",
    );

    // An officer answers theirs, and the merge completes with BOTH answers applied.
    const done = await resolveHeldMerge(db, first.heldMergeId, { keepGrantIds: [] }, officer);
    expect(done.outcome).toBe("completed");
    const accounts = await db
      .select()
      .from(membershipAccounts)
      .where(sql`${membershipAccounts.payerContactId} IN (${survivor}, ${merged})`);
    expect(
      accounts.map((a) => a.id),
      "the mailing-list manager's answer was lost",
    ).toEqual([keep]);
    expect(
      await db
        .select()
        .from(roleGrants)
        .where(and(eq(roleGrants.contactId, survivor), eq(roleGrants.role, "treasurer"))),
      "the officer's answer was lost",
    ).toHaveLength(0);
  });
});

/**
 * Feature 078 (FR-005, FR-005a, research R11). Who can SEE a hold, and who can ANSWER it.
 *
 * A President holds role-assigning authority but not duplicate-management authority, and every hold route
 * required the latter before checking anything — so a President got 403 everywhere, and the review queue
 * rendered that as an empty list. Rich decided a President must be able to answer holds.
 */
describe("who can see and answer a hold (078)", () => {
  async function holdOf(reason: "two_accounts" | "role_conflict") {
    const actor = await contact("Mel Actor");
    if (reason === "two_accounts") {
      const a = await contact("Pat Payer");
      const b = await contact("Pat Payor");
      await makeMembershipAccount({ payerContactId: a, expiryDate: "2027-01-01" });
      await makeMembershipAccount({ payerContactId: b, expiryDate: "2027-01-01" });
      const r = await mergeContacts(db, a, b, actor);
      if (r.outcome !== "held") throw new Error("expected held");
      return r.heldMergeId;
    }
    const a = await contact("Pres Ident");
    const b = await contact("Tres Urer");
    await grant(a, "president");
    await grant(b, "treasurer");
    const r = await mergeContacts(db, a, b, actor);
    if (r.outcome !== "held") throw new Error("expected held");
    return r.heldMergeId;
  }

  type Item = { id: string; reason: string; answerableBy: string; canAnswer: boolean };
  const list = async (token: string) => {
    const res = await LIST_HELD(jsonReqAs(token, "GET", "/api/dedup/held"), ctx());
    return { status: res.status, held: res.ok ? ((await res.json()).held as Item[]) : [] };
  };

  it("tells each actor which holds they can answer", async () => {
    const accounts = await holdOf("two_accounts");
    const roles = await holdOf("role_conflict");
    const mel = await makeActor({
      email: "mel@example.com",
      grants: [{ role: "mailing_list_manager" }],
    });
    const president = await makeActor({
      email: "pres@example.com",
      grants: [{ role: "president" }],
    });

    const asMel = await list(mel.token);
    const asPresident = await list(president.token);
    expect(asPresident.status, "a President still cannot see holds").toBe(200);

    const byId = (items: Item[], id: string) => items.find((h) => h.id === id)!;
    expect(byId(asMel.held, accounts)).toMatchObject({
      answerableBy: "dedup.write",
      canAnswer: true,
    });
    expect(byId(asMel.held, roles)).toMatchObject({
      answerableBy: "role.assign",
      canAnswer: false,
    });
    expect(byId(asPresident.held, accounts)).toMatchObject({ canAnswer: false });
    expect(byId(asPresident.held, roles)).toMatchObject({ canAnswer: true });
  });

  it("lets a President answer a role hold and decline any hold, but not answer an accounts hold", async () => {
    const accounts = await holdOf("two_accounts");
    const roles = await holdOf("role_conflict");
    const president = await makeActor({
      email: "pres@example.com",
      grants: [{ role: "president" }],
    });

    const resolveRoles = await RESOLVE_HELD(
      jsonReqAs(president.token, "POST", `/api/dedup/held/${roles}/resolve`, { keepGrantIds: [] }),
      ctx({ id: roles }),
    );
    expect(resolveRoles.status).toBe(200);
    expect((await resolveRoles.json()).outcome).toBe("completed");

    const resolveAccounts = await RESOLVE_HELD(
      jsonReqAs(president.token, "POST", `/api/dedup/held/${accounts}/resolve`, {
        survivingAccountId: "00000000-0000-0000-0000-000000000000",
      }),
      ctx({ id: accounts }),
    );
    expect(resolveAccounts.status, "a President answered the mailing-list manager's question").toBe(
      403,
    );

    const decline = await ABANDON_HELD(
      jsonReqAs(president.token, "DELETE", `/api/dedup/held/${accounts}`),
      ctx({ id: accounts }),
    );
    expect(decline.status, "a President cannot decline a hold").toBe(200);
  });

  it("refuses an actor with neither authority on every hold route", async () => {
    const accounts = await holdOf("two_accounts");
    const base = await makeBaseActor("base@example.com");

    expect((await list(base.token)).status).toBe(403);
    expect(
      (
        await RESOLVE_HELD(
          jsonReqAs(base.token, "POST", `/api/dedup/held/${accounts}/resolve`, {
            survivingAccountId: "00000000-0000-0000-0000-000000000000",
          }),
          ctx({ id: accounts }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await ABANDON_HELD(
          jsonReqAs(base.token, "DELETE", `/api/dedup/held/${accounts}`),
          ctx({ id: accounts }),
        )
      ).status,
    ).toBe(403);
  });
});

/** Feature 078 (FR-001, research R9): opening a hold shows its question as it stands now. */
describe("opening a held merge (078)", () => {
  const open = async (token: string, id: string) => {
    const res = await OPEN_HELD(jsonReqAs(token, "GET", `/api/dedup/held/${id}`), ctx({ id }));
    return { status: res.status, body: res.ok ? await res.json() : await res.json() };
  };

  it("returns the pair, who can answer, and what has already been answered", async () => {
    const { survivor, merged, keep, mel } = await twoDecisionPair();
    const officer = await makeActor({
      email: "vp@example.com",
      grants: [{ role: "vice_president" }],
    });
    const first = await mergeContacts(db, survivor, merged, mel);
    if (first.outcome !== "held") throw new Error("expected held");
    await resolveHeldMerge(db, first.heldMergeId, { survivingAccountId: keep }, mel);

    const { status, body } = await open(officer.token, first.heldMergeId);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: first.heldMergeId,
      reason: "role_conflict",
      canonical: { id: survivor, displayName: "Pres Ident" },
      merged: { id: merged, displayName: "Tres Urer" },
      answerableBy: "role.assign",
      canAnswer: true,
      answered: ["two_accounts"],
    });
  });

  it("is gone once the hold is answered or abandoned", async () => {
    const { survivor, merged, mel } = await twoDecisionPair();
    const officer = await makeActor({
      email: "vp@example.com",
      grants: [{ role: "vice_president" }],
    });
    const first = await mergeContacts(db, survivor, merged, mel);
    if (first.outcome !== "held") throw new Error("expected held");

    const decline = await ABANDON_HELD(
      jsonReqAs(officer.token, "DELETE", `/api/dedup/held/${first.heldMergeId}`),
      ctx({ id: first.heldMergeId }),
    );
    expect(decline.status).toBe(200);

    const { status, body } = await open(officer.token, first.heldMergeId);
    expect(status).toBe(404);
    expect(body.error.code).toBe("HELD_MERGE_NOT_FOUND");
  });
});

/** Feature 078, User Story 1 (FR-002): the accounts question shows what Mel needs to answer it. */
describe("the two-accounts question (078 US1)", () => {
  it("shows each account's level, expiry, last payment and who it covers", async () => {
    const mel = await makeActor({
      email: "mel@example.com",
      grants: [{ role: "mailing_list_manager" }],
    });
    const payerA = await contact("Pat Payer");
    const payerB = await contact("Pat Payor");
    const partner = await contact("Sam Partner");
    const { accountId: a } = await makeMembershipAccount({
      payerContactId: payerA,
      level: "family",
      expiryDate: "2027-08-31",
      members: [partner],
    });
    await db
      .update(membershipAccounts)
      .set({ lastPaymentDate: "2026-09-01" })
      .where(eq(membershipAccounts.id, a));
    await makeMembershipAccount({ payerContactId: payerB, expiryDate: "2026-12-31" });
    const r = await mergeContacts(db, payerA, payerB, mel.contactId);
    if (r.outcome !== "held") throw new Error("expected held");

    const res = await OPEN_HELD(
      jsonReqAs(mel.token, "GET", `/api/dedup/held/${r.heldMergeId}`),
      ctx({ id: r.heldMergeId }),
    );
    const body = await res.json();
    expect(body.reason).toBe("two_accounts");
    const accounts = body.candidates as {
      accountId: string;
      payerDisplayName: string;
      level: string;
      expiryDate: string;
      lastPaymentDate: string | null;
      members: string[];
    }[];
    expect(accounts).toHaveLength(2);
    const family = accounts.find((x) => x.accountId === a)!;
    expect(family).toMatchObject({
      payerDisplayName: "Pat Payer",
      level: "family",
      expiryDate: "2027-08-31",
      lastPaymentDate: "2026-09-01",
    });
    expect([...family.members].sort()).toEqual(["Pat Payer", "Sam Partner"]);
  });
});

/** A contact that can sign in: a login address, and optionally a bound Google account. */
async function signIn(firstName: string, email: string, opts: { identity?: boolean } = {}) {
  const c = await makeContactWithEmail({ firstName, lastName: "Vale", email });
  await db.update(contactEmails).set({ isLogin: true }).where(eq(contactEmails.id, c.emailId));
  const identityId = opts.identity
    ? (
        await db
          .insert(staffIdentities)
          .values({
            contactId: c.contactId,
            googleSub: `sub-${email}`,
            lastSignInAt: new Date("2026-09-01T12:00:00Z"),
          })
          .returning()
      )[0]!.id
    : null;
  return { ...c, identityId };
}

const openAs = async (token: string, id: string) => {
  const res = await OPEN_HELD(jsonReqAs(token, "GET", `/api/dedup/held/${id}`), ctx({ id }));
  return res.json();
};

/** Feature 078, User Story 2 (FR-003, FR-004): the officer's questions show what they need to answer. */
describe("the sign-in and role questions (078 US2)", () => {
  it("shows each contact's sign-in: address, Google account and when it was last used", async () => {
    const officer = await makeActor({
      email: "vp@example.com",
      grants: [{ role: "vice_president" }],
    });
    const a = await signIn("Terry", "terry@example.com", { identity: true });
    const b = await signIn("Terri", "terri@example.com");
    const r = await mergeContacts(db, a.contactId, b.contactId, officer.contactId);
    if (r.outcome !== "held") throw new Error("expected held");

    const body = await openAs(officer.token, r.heldMergeId);
    expect(body.reason).toBe("two_logins");
    expect(body.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contactId: a.contactId,
          loginEmailId: a.emailId,
          loginEmail: "terry@example.com",
          identityId: a.identityId,
          lastSignInAt: expect.stringMatching(/^2026-09-01/),
        }),
        expect.objectContaining({
          contactId: b.contactId,
          loginEmailId: b.emailId,
          loginEmail: "terri@example.com",
          identityId: null,
          lastSignInAt: null,
        }),
      ]),
    );
    expect(body.candidates).toHaveLength(2);
  });

  it("choosing the sign-in with no Google account discards the other contact's, so it cannot still sign in", async () => {
    const officer = await makeActor({
      email: "vp@example.com",
      grants: [{ role: "vice_president" }],
    });
    const a = await signIn("Terry", "terry@example.com", { identity: true });
    const b = await signIn("Terri", "terri@example.com");
    const r = await mergeContacts(db, a.contactId, b.contactId, officer.contactId);
    if (r.outcome !== "held") throw new Error("expected held");

    const done = await resolveHeldMerge(
      db,
      r.heldMergeId,
      { survivingLoginEmailId: b.emailId },
      officer.contactId,
    );
    expect(done.outcome).toBe("completed");
    expect(
      await db.select().from(staffIdentities).where(eq(staffIdentities.contactId, a.contactId)),
      "the unchosen Google account still grants access",
    ).toHaveLength(0);
    const logins = await db
      .select()
      .from(contactEmails)
      .where(and(eq(contactEmails.contactId, a.contactId), eq(contactEmails.isLogin, true)));
    expect(logins.map((e) => e.id)).toEqual([b.emailId]);
  });

  it("shows each contested role with its scope and why it conflicts", async () => {
    const officer = await makeActor({
      email: "vp@example.com",
      grants: [{ role: "vice_president" }],
    });
    const { survivor, merged, treasurerGrant, mel } = await twoDecisionPair();
    await db.delete(membershipAccounts).where(eq(membershipAccounts.payerContactId, merged));
    const bookerGrant = await grant(merged, "booker");
    const r = await mergeContacts(db, survivor, merged, mel);
    if (r.outcome !== "held") throw new Error("expected held");

    const body = await openAs(officer.token, r.heldMergeId);
    expect(body.reason).toBe("role_conflict");
    // Every role is offered — the answer names all that move, so an unlisted one would be silently dropped.
    expect(body.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          grantId: treasurerGrant,
          role: "treasurer",
          scope: "club-wide",
          conflict: "exclusive",
        }),
        expect.objectContaining({ grantId: bookerGrant, role: "booker", conflict: null }),
      ]),
    );
    expect(body.candidates).toHaveLength(2);
  });
});

/**
 * Feature 078 (FR-010, research R3). An answer given for a pair can stop fitting it while the hold waits —
 * the account deleted, or moved to someone else by another merge. It must be refused and asked again,
 * never applied: the account fold deletes every account of the pair except the chosen one.
 */
describe("a stale answer is refused, not applied (078 US2)", () => {
  /** The accounts question answered by Mel, then the chosen account taken away from the pair. */
  async function answeredThenLost(how: "deleted" | "moved") {
    const pair = await twoDecisionPair();
    const first = await mergeContacts(db, pair.survivor, pair.merged, pair.mel);
    if (first.outcome !== "held") throw new Error("expected held");
    await resolveHeldMerge(db, first.heldMergeId, { survivingAccountId: pair.keep }, pair.mel);

    const third = await contact("Third Party");
    if (how === "deleted") {
      await db.delete(membershipMembers).where(eq(membershipMembers.accountId, pair.keep));
      await db.delete(membershipAccounts).where(eq(membershipAccounts.id, pair.keep));
    } else {
      await db
        .update(membershipAccounts)
        .set({ payerContactId: third })
        .where(eq(membershipAccounts.id, pair.keep));
    }
    // The survivor still pays for an account, so the pair still raises the accounts question.
    await makeMembershipAccount({ payerContactId: pair.survivor, expiryDate: "2029-01-01" });
    return { ...pair, holdId: first.heldMergeId };
  }

  const pairAccounts = (survivor: string, merged: string) =>
    db
      .select()
      .from(membershipAccounts)
      .where(sql`${membershipAccounts.payerContactId} IN (${survivor}, ${merged})`);

  it("refuses the officer's later answer when the stored account was deleted", async () => {
    const { survivor, merged, holdId } = await answeredThenLost("deleted");
    const officer = await makeActor({
      email: "vp@example.com",
      grants: [{ role: "vice_president" }],
    });

    const res = await RESOLVE_HELD(
      jsonReqAs(officer.token, "POST", `/api/dedup/held/${holdId}/resolve`, { keepGrantIds: [] }),
      ctx({ id: holdId }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("HELD_MERGE_STALE");

    const row = await holdRow(holdId);
    expect(row?.reason, "the hold must ask the accounts question again").toBe("two_accounts");
    expect(row?.answers).not.toHaveProperty("survivingAccountId");
    expect(row?.answers, "the refused answer must not be stored").not.toHaveProperty(
      "keepGrantIds",
    );
    const retired = await db.query.contacts.findFirst({ where: eq(contacts.id, merged) });
    expect(retired?.mergedIntoId, "a stale answer merged the pair").toBeNull();
    expect(await pairAccounts(survivor, merged)).toHaveLength(2);
  });

  it("refuses it when the stored account was moved to a third contact, and deletes nothing (U1)", async () => {
    const { survivor, merged, keep, holdId, officer } = await answeredThenLost("moved");

    await expect(resolveHeldMerge(db, holdId, { keepGrantIds: [] }, officer)).rejects.toMatchObject(
      { code: "HELD_MERGE_STALE" },
    );

    const accounts = await pairAccounts(survivor, merged);
    expect(
      accounts,
      "the pair's accounts were deleted by an answer that no longer fit",
    ).toHaveLength(2);
    expect(
      await db.query.membershipAccounts.findFirst({ where: eq(membershipAccounts.id, keep) }),
      "the third contact's account was touched",
    ).toBeTruthy();
    await expect(
      mergeContacts(db, survivor, merged, officer, { survivingAccountId: keep, keepGrantIds: [] }),
    ).rejects.toMatchObject({ code: "HELD_MERGE_STALE" });
    expect(await pairAccounts(survivor, merged)).toHaveLength(2);
  });

  it("refuses an answer naming a role the merged contact no longer holds", async () => {
    const { survivor, merged, treasurerGrant, mel, officer } = await twoDecisionPair();
    await db.delete(membershipAccounts).where(eq(membershipAccounts.payerContactId, merged));
    const r = await mergeContacts(db, survivor, merged, mel);
    if (r.outcome !== "held") throw new Error("expected held");
    const stranger = await contact("Stranger");
    const foreignGrant = await grant(stranger, "booker");

    await expect(
      resolveHeldMerge(db, r.heldMergeId, { keepGrantIds: [foreignGrant] }, officer),
    ).rejects.toMatchObject({ code: "HELD_MERGE_STALE" });
    expect((await holdRow(r.heldMergeId))?.answers).toEqual({});
    expect(
      await db.query.roleGrants.findFirst({ where: eq(roleGrants.id, treasurerGrant) }),
    ).toMatchObject({ contactId: merged });
  });

  it("the queue agrees: listing resets the reason and drops the stale answer, without closing the hold", async () => {
    const { holdId } = await answeredThenLost("moved");

    const queue = await listHeldMerges(db);
    expect(queue.map((h) => h.id)).toEqual([holdId]);
    expect(queue[0]!.reason).toBe("two_accounts");
    const row = await holdRow(holdId);
    expect(row?.resolvedAt).toBeNull();
    expect(row?.answers).not.toHaveProperty("survivingAccountId");
  });
});

/**
 * 074's manual pass: a mailing-list manager merged into her non-volunteer record. Her roles and sign-in
 * moved onto a contact that could not sign in, and nobody could log in as either.
 */
async function volunteerIntoNonVolunteer() {
  const approver = await contact("Pat Approver");
  const survivor = await contact("Peggy CDR");
  const vol = await signIn("Peggy", "peggy@example.com", { identity: true });
  const approvedAt = new Date("2026-03-01T15:00:00Z");
  await db
    .update(contacts)
    .set({ isVolunteer: true, volunteerApprovedAt: approvedAt, volunteerApprovedBy: approver })
    .where(eq(contacts.id, vol.contactId));
  await grant(vol.contactId, "mailing_list_manager");
  return { survivor, merged: vol.contactId, vol, approver, approvedAt };
}

/** Feature 078, User Story 3 (FR-011, FR-012): a merge never silently locks a volunteer out. */
describe("the volunteer-status hold (078 US3)", () => {
  it("holds a volunteer merged into a non-volunteer, and writes nothing", async () => {
    const { survivor, merged } = await volunteerIntoNonVolunteer();
    const mel = await contact("Mel Actor");

    const r = await mergeContacts(db, survivor, merged, mel);
    if (r.outcome !== "held") throw new Error("expected held");
    expect(r.reason).toBe("volunteer_status");
    expect(r.candidates).toMatchObject({
      approvedAt: expect.stringMatching(/^2026-03-01/),
      approvedBy: "Pat Approver",
    });
    expect(
      (await db.query.contacts.findFirst({ where: eq(contacts.id, merged) }))?.mergedIntoId,
    ).toBeNull();
    expect(
      await db.select().from(roleGrants).where(eq(roleGrants.contactId, survivor)),
    ).toHaveLength(0);
  });

  it("is an officer's to answer: Mel is refused", async () => {
    const { survivor, merged } = await volunteerIntoNonVolunteer();
    const mel = await makeActor({
      email: "mel@example.com",
      grants: [{ role: "mailing_list_manager" }],
    });
    const r = await mergeContacts(db, survivor, merged, mel.contactId);
    if (r.outcome !== "held") throw new Error("expected held");

    const res = await RESOLVE_HELD(
      jsonReqAs(mel.token, "POST", `/api/dedup/held/${r.heldMergeId}/resolve`, {
        carryVolunteer: true,
      }),
      ctx({ id: r.heldMergeId }),
    );
    expect(res.status).toBe(403);
  });

  it("carries volunteer status when an officer says so, and the person can sign in afterwards", async () => {
    const { survivor, merged, approver, approvedAt } = await volunteerIntoNonVolunteer();
    const officer = await makeActor({
      email: "vp@example.com",
      grants: [{ role: "vice_president" }],
    });
    const r = await mergeContacts(db, survivor, merged, officer.contactId);
    if (r.outcome !== "held") throw new Error("expected held");

    const res = await RESOLVE_HELD(
      jsonReqAs(officer.token, "POST", `/api/dedup/held/${r.heldMergeId}/resolve`, {
        carryVolunteer: true,
      }),
      ctx({ id: r.heldMergeId }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("completed");

    const kept = await db.query.contacts.findFirst({ where: eq(contacts.id, survivor) });
    expect(kept).toMatchObject({ isVolunteer: true, volunteerApprovedBy: approver });
    expect(kept?.volunteerApprovedAt?.toISOString()).toBe(approvedAt.toISOString());

    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.kind, "volunteer.designated"));
    const mergeRow = await db.query.mergeAudit.findFirst();
    expect(audit.map((a) => a.details)).toContainEqual(
      expect.objectContaining({ subject: survivor, via: "merge", mergeAuditId: mergeRow!.id }),
    );

    const again = await resolveSignIn(db, {
      sub: "sub-peggy@example.com",
      email: "peggy@example.com",
      email_verified: true,
    });
    expect(again, "the moved sign-in is still locked out").toMatchObject({
      ok: true,
      contactId: survivor,
    });
  });

  it("closes itself once the survivor is designated a volunteer some other way", async () => {
    const { survivor, merged } = await volunteerIntoNonVolunteer();
    const r = await mergeContacts(db, survivor, merged, await contact("Mel Actor"));
    if (r.outcome !== "held") throw new Error("expected held");

    await designateVolunteer(db, survivor, null);
    expect(await listHeldMerges(db)).toHaveLength(0);
    expect((await holdRow(r.heldMergeId))?.resolvedAt).not.toBeNull();
  });

  it("does not hold when the survivor is already a volunteer", async () => {
    const { survivor, merged } = await volunteerIntoNonVolunteer();
    await db.update(contacts).set({ isVolunteer: true }).where(eq(contacts.id, survivor));
    const r = await mergeContacts(db, survivor, merged, await contact("Mel Actor"));
    expect(r.outcome).toBe("completed");
  });

  it("is asked before the sign-in question", async () => {
    const { merged } = await volunteerIntoNonVolunteer();
    const other = await signIn("Margaret", "margaret@example.com", { identity: true });
    const assessed = await detectHold(db, other.contactId, merged);
    expect(assessed.hold?.reason).toBe("volunteer_status");
  });
});

/** Feature 078 (T027): the volunteer answer is its own kind of answer. */
describe("answering the volunteer question (078 US3)", () => {
  it("accepts carryVolunteer alone, and refuses it combined with another answer", () => {
    expect(heldResolveSchema.safeParse({ carryVolunteer: true }).success).toBe(true);
    expect(heldResolveSchema.safeParse({ carryVolunteer: true, keepGrantIds: [] }).success).toBe(
      false,
    );
    expect(heldResolveSchema.safeParse({ carryVolunteer: false }).success).toBe(false);
  });

  it("refuses carryVolunteer as the answer to a different question", async () => {
    const { survivor, merged, mel, officer } = await twoDecisionPair();
    const r = await mergeContacts(db, survivor, merged, mel);
    if (r.outcome !== "held") throw new Error("expected held");
    await expect(
      resolveHeldMerge(db, r.heldMergeId, { carryVolunteer: true }, officer),
    ).rejects.toMatchObject({ code: "HELD_MERGE_REASON_MISMATCH" });
  });
});

/**
 * Feature 078, User Story 4 (FR-014, FR-015). Super-user is granted only at the command line, but a merge
 * used to move it onto anyone who already had role-assigning authority. It now merges only into a
 * super-user; otherwise nobody can answer the hold in the app.
 */
describe("the super-user hold (078 US4)", () => {
  async function superIntoPresident() {
    const survivor = await contact("Pres Ident");
    const presidentGrant = await grant(survivor, "president");
    const merged = await contact("Sue Peruser");
    const superGrant = await grant(merged, "super_user");
    return { survivor, merged, presidentGrant, superGrant };
  }

  it("holds a super-user merged into a President, before any other question, and writes nothing", async () => {
    const { survivor, merged } = await superIntoPresident();
    // A second obstacle, which would otherwise be asked first among the older ones.
    await makeMembershipAccount({ payerContactId: survivor, expiryDate: "2027-01-01" });
    await makeMembershipAccount({ payerContactId: merged, expiryDate: "2027-01-01" });

    const r = await mergeContacts(db, survivor, merged, await contact("Mel Actor"));
    if (r.outcome !== "held") throw new Error("expected held");
    expect(r.reason).toBe("super_user");
    expect(
      await db.select().from(roleGrants).where(eq(roleGrants.contactId, survivor)),
    ).toHaveLength(1);
    expect(
      (await db.query.contacts.findFirst({ where: eq(contacts.id, merged) }))?.mergedIntoId,
    ).toBeNull();
  });

  it("cannot be answered by anyone in the app — not an officer, not a super-user", async () => {
    const { survivor, merged } = await superIntoPresident();
    const r = await mergeContacts(db, survivor, merged, await contact("Mel Actor"));
    if (r.outcome !== "held") throw new Error("expected held");
    const vp = await makeActor({ email: "vp@example.com", grants: [{ role: "vice_president" }] });

    for (const req of [
      jsonReqAs(vp.token, "POST", `/api/dedup/held/${r.heldMergeId}/resolve`, { keepGrantIds: [] }),
      jsonReq("POST", `/api/dedup/held/${r.heldMergeId}/resolve`, { keepGrantIds: [] }),
    ]) {
      const res = await RESOLVE_HELD(req, ctx({ id: r.heldMergeId }));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("HELD_MERGE_NOT_ANSWERABLE");
      expect(body.error.message).toMatch(/command line/i);
    }
    await expect(
      resolveHeldMerge(db, r.heldMergeId, { keepGrantIds: [] }, vp.contactId),
    ).rejects.toMatchObject({ code: "HELD_MERGE_NOT_ANSWERABLE" });

    const detail = await (
      await OPEN_HELD(
        jsonReq("GET", `/api/dedup/held/${r.heldMergeId}`),
        ctx({ id: r.heldMergeId }),
      )
    ).json();
    expect(detail).toMatchObject({ answerableBy: "command_line", canAnswer: false });
    expect(detail.candidates.instruction).toMatch(/command line/i);
  });

  it("is not settled by leaving super-user behind (research R5)", async () => {
    const { survivor, merged } = await superIntoPresident();
    const assessed = await detectHold(db, survivor, merged, { keepGrantIds: [] });
    expect(assessed.hold?.reason).toBe("super_user");
    await expect(
      mergeContacts(db, survivor, merged, await contact("Mel Actor"), { keepGrantIds: [] }),
    ).resolves.toMatchObject({ outcome: "held", reason: "super_user" });
  });

  it("closes once the survivor is made a super-user at the command line, and the merge then completes", async () => {
    const { survivor, merged } = await superIntoPresident();
    const mel = await contact("Mel Actor");
    const r = await mergeContacts(db, survivor, merged, mel);
    if (r.outcome !== "held") throw new Error("expected held");

    await bootstrapOfficer({
      email: "pres.ident@example.com",
      contactId: survivor,
      role: "super_user",
    });
    expect(await listHeldMerges(db)).toHaveLength(0);
    expect((await mergeContacts(db, survivor, merged, mel)).outcome).toBe("completed");
  });

  it("does not hold a super-user merged into a super-user, and the duplicate grant collapses", async () => {
    const { survivor, merged } = await superIntoPresident();
    await grant(survivor, "super_user");
    const r = await mergeContacts(db, survivor, merged, await contact("Mel Actor"));
    expect(r.outcome).toBe("completed");
    const supers = await db
      .select()
      .from(roleGrants)
      .where(and(eq(roleGrants.contactId, survivor), eq(roleGrants.role, "super_user")));
    expect(supers).toHaveLength(1);
  });
});

/**
 * Feature 078, from the manual pass: a President opened a held pair from the duplicates queue and found no
 * way to answer it — the pair did not know it was held. The suggestion now names its open hold.
 */
describe("a suggested pair knows its merge is held (078)", () => {
  it("carries the open hold's id, whichever way round the merge was attempted", async () => {
    const a = await signIn("Holdy", "holdy.signin@example.com", { identity: true });
    const b = await signIn("Holdie", "holdy.signen@example.com", { identity: true });
    const r = await mergeContacts(db, b.contactId, a.contactId, await contact("Mel Actor"));
    if (r.outcome !== "held") throw new Error("expected held");

    const pairs = await getMergeSuggestions(db);
    const pair = pairs.find(
      (p) => [p.a.id, p.b.id].sort().join() === [a.contactId, b.contactId].sort().join(),
    );
    expect(pair, "the pair was not suggested").toBeTruthy();
    expect(pair!.heldMergeId).toBe(r.heldMergeId);

    await resolveHeldMerge(
      db,
      r.heldMergeId,
      { survivingLoginEmailId: a.emailId, survivingIdentityId: a.identityId! },
      (await makeActor({ email: "vp@example.com", grants: [{ role: "vice_president" }] }))
        .contactId,
    );
    expect((await getMergeSuggestions(db)).every((p) => p.heldMergeId === null)).toBe(true);
  });
});

/**
 * Feature 078, from the manual pass (§6): Mel could not see her accounts question until an officer had
 * answered the volunteer one. Order follows dependency, not authority — no access decision changes which
 * membership account survives, so the accounts question comes straight after the unanswerable one.
 */
describe("the accounts question is asked before the access questions (078)", () => {
  it("asks Mel about accounts first, then waits on the officer's volunteer and sign-in questions", async () => {
    const { survivor, merged } = await volunteerIntoNonVolunteer();
    await makeMembershipAccount({ payerContactId: survivor, expiryDate: "2027-01-01" });
    const { accountId: keep } = await makeMembershipAccount({
      payerContactId: merged,
      expiryDate: "2028-01-01",
    });
    const mel = await contact("Mel Actor");

    const first = await mergeContacts(db, survivor, merged, mel);
    if (first.outcome !== "held") throw new Error("expected held");
    expect(first.reason, "Mel's question should not wait on an officer").toBe("two_accounts");

    const second = await resolveHeldMerge(db, first.heldMergeId, { survivingAccountId: keep }, mel);
    if (second.outcome !== "held") throw new Error("expected held again");
    expect(second.reason).toBe("volunteer_status");
  });

  it("still asks a super-user hold before the accounts question", async () => {
    const survivor = await contact("Pres Ident");
    const merged = await contact("Sue Peruser");
    await grant(merged, "super_user");
    await makeMembershipAccount({ payerContactId: survivor, expiryDate: "2027-01-01" });
    await makeMembershipAccount({ payerContactId: merged, expiryDate: "2027-01-01" });
    expect((await detectHold(db, survivor, merged)).hold?.reason).toBe("super_user");
  });

  it("asks accounts before sign-ins", async () => {
    const a = await signIn("Terry", "terry@example.com");
    const b = await signIn("Terri", "terri@example.com");
    await makeMembershipAccount({ payerContactId: a.contactId, expiryDate: "2027-01-01" });
    await makeMembershipAccount({ payerContactId: b.contactId, expiryDate: "2027-01-01" });
    expect((await detectHold(db, a.contactId, b.contactId)).hold?.reason).toBe("two_accounts");
  });
});
