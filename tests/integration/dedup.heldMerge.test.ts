import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import {
  contactEmails,
  contacts,
  heldMerges,
  membershipAccounts,
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
import { detectHold, mergeContacts } from "@/server/domain/dedup/mergeService";
import {
  abandonHeldMerge,
  listHeldMerges,
  resolveHeldMerge,
} from "@/server/domain/dedup/heldMergeService";
import { DELETE as ABANDON_HELD } from "@/app/api/dedup/held/[id]/route";
import { jsonReqAs, ctx } from "./helpers/http";
import { getMergeSuggestions } from "@/server/domain/dedup/suggestionService";
import { listNeedsReview } from "@/server/domain/contacts/contactService";

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

const contact = async (name: string) =>
  (await db.insert(contacts).values(contactRow(name)).returning())[0]!.id;

async function withLogin(firstName: string, email: string) {
  const c = await makeContactWithEmail({ firstName, lastName: "Vale", email });
  await db.update(contactEmails).set({ isLogin: true }).where(eq(contactEmails.id, c.emailId));
  return c;
}

/**
 * Feature 069, US4 (M-R21). Two collisions can make a merge impossible to complete silently: two sign-in
 * identities (one login per contact) and two membership accounts (one account per payer). Until now both
 * surfaced as a raw Postgres unique-violation. Neither is a data error — each is a real question with a
 * right answer that a person has to give, and for a sign-in that person is not necessarily the one
 * working the queue.
 */
describe("a merge that cannot complete is HELD, not failed", () => {
  it("holds two sign-in identities, changing nothing", async () => {
    const a = await withLogin("Terry", "terry@example.com");
    const b = await withLogin("Terri", "terri@example.com");
    const actor = await contact("Mel Actor");

    const result = await mergeContacts(db, a.contactId, b.contactId, actor);
    expect(result.outcome).toBe("held");
    if (result.outcome !== "held") throw new Error("expected held");
    if (result.reason !== "two_logins") throw new Error("expected two_logins");
    expect(result.candidates.map((c) => c.loginEmail).sort()).toEqual([
      "terri@example.com",
      "terry@example.com",
    ]);

    // Nothing moved and nobody was retired.
    const merged = await db.query.contacts.findFirst({ where: eq(contacts.id, b.contactId) });
    expect(merged?.mergedIntoId).toBeNull();
    const emails = await db
      .select()
      .from(contactEmails)
      .where(eq(contactEmails.contactId, b.contactId));
    expect(emails).toHaveLength(1);
  });

  it("holds two membership accounts the same way", async () => {
    const a = await contact("Pat Payer");
    const b = await contact("Patricia Payer");
    const actor = await contact("Mel Actor");
    await makeMembershipAccount({ payerContactId: a, level: "family", expiryDate: "2099-08-31" });
    await makeMembershipAccount({
      payerContactId: b,
      level: "individual",
      expiryDate: "2098-08-31",
    });

    const result = await mergeContacts(db, a, b, actor);
    if (result.outcome !== "held") throw new Error("expected held");
    expect(result.reason).toBe("two_accounts");
    expect(result.candidates).toHaveLength(2);
    expect(await db.select().from(membershipAccounts)).toHaveLength(2);
  });

  it("records the hold as its own item, naming both contacts and the reason (FR-014)", async () => {
    const a = await withLogin("Terry", "terry@example.com");
    const b = await withLogin("Terri", "terri@example.com");
    const actor = await contact("Mel Actor");
    await mergeContacts(db, a.contactId, b.contactId, actor);

    const held = await listHeldMerges(db);
    expect(held).toHaveLength(1);
    expect(held[0]!.reason).toBe("two_logins");
    expect([held[0]!.canonicalDisplayName, held[0]!.mergedDisplayName].sort()).toEqual([
      "Terri Vale",
      "Terry Vale",
    ]);
  });

  it("raises one hold per pair, however many times the merge is retried", async () => {
    const a = await withLogin("Terry", "terry@example.com");
    const b = await withLogin("Terri", "terri@example.com");
    const actor = await contact("Mel Actor");
    await mergeContacts(db, a.contactId, b.contactId, actor);
    await mergeContacts(db, a.contactId, b.contactId, actor);
    expect(await listHeldMerges(db)).toHaveLength(1);
  });

  it("resolving the sign-in choice completes the merge", async () => {
    const a = await withLogin("Terry", "terry@example.com");
    const b = await withLogin("Terri", "terri@example.com");
    const actor = await contact("Mel Actor");
    const held = await mergeContacts(db, a.contactId, b.contactId, actor);
    if (held.outcome !== "held") throw new Error("expected held");

    const out = await resolveHeldMerge(
      db,
      held.heldMergeId,
      { survivingLoginEmailId: a.emailId },
      actor,
    );
    expect(out.outcome).toBe("completed");

    const merged = await db.query.contacts.findFirst({ where: eq(contacts.id, b.contactId) });
    expect(merged?.mergedIntoId).toBe(a.contactId);
    // Both addresses survive on the survivor; exactly one of them signs in, and it is the chosen one.
    const emails = await db
      .select()
      .from(contactEmails)
      .where(eq(contactEmails.contactId, a.contactId));
    expect(emails).toHaveLength(2);
    expect(emails.filter((e) => e.isLogin).map((e) => e.id)).toEqual([a.emailId]);
    // The hold is closed, not left open beside a merge that already happened.
    expect(await listHeldMerges(db)).toHaveLength(0);
  });

  it("resolving the account choice folds the losing household into the survivor's account", async () => {
    const a = await contact("Pat Payer");
    const b = await contact("Patricia Payer");
    const rider = await contact("Household Rider");
    const actor = await contact("Mel Actor");
    const keep = await makeMembershipAccount({
      payerContactId: a,
      level: "family",
      expiryDate: "2099-08-31",
    });
    await makeMembershipAccount({
      payerContactId: b,
      level: "individual",
      expiryDate: "2098-08-31",
      members: [rider],
    });

    const held = await mergeContacts(db, a, b, actor);
    if (held.outcome !== "held") throw new Error("expected held");
    const out = await resolveHeldMerge(
      db,
      held.heldMergeId,
      { survivingAccountId: keep.accountId },
      actor,
    );
    expect(out.outcome).toBe("completed");

    const accounts = await db.select().from(membershipAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.id).toBe(keep.accountId);
    expect(accounts[0]!.payerContactId).toBe(a);
    // Nobody loses their membership because the account they were on was the one not kept.
    const covered = await db.query.membershipMembers.findMany();
    expect(covered.map((m) => m.contactId)).toContain(rider);
  });

  it("refuses a choice that does not resolve the reason it was held for", async () => {
    const a = await withLogin("Terry", "terry@example.com");
    const b = await withLogin("Terri", "terri@example.com");
    const actor = await contact("Mel Actor");
    const held = await mergeContacts(db, a.contactId, b.contactId, actor);
    if (held.outcome !== "held") throw new Error("expected held");

    await expect(
      resolveHeldMerge(db, held.heldMergeId, { survivingAccountId: crypto.randomUUID() }, actor),
    ).rejects.toMatchObject({ code: "HELD_MERGE_REASON_MISMATCH" });
  });

  it("closes a hold whose cause has gone, without merging", async () => {
    const a = await withLogin("Terry", "terry@example.com");
    const b = await withLogin("Terri", "terri@example.com");
    const actor = await contact("Mel Actor");
    await mergeContacts(db, a.contactId, b.contactId, actor);

    // The duplicate is archived instead — the question the hold asked no longer arises.
    await db.update(contacts).set({ archivedAt: new Date() }).where(eq(contacts.id, b.contactId));
    expect(await listHeldMerges(db)).toHaveLength(0);
    expect((await db.select().from(heldMerges)).every((h) => h.resolvedAt !== null)).toBe(true);
  });

  it("keeps a review flag and a held merge independent of each other (FR-014a)", async () => {
    const a = await withLogin("Terry", "terry@example.com");
    const b = await withLogin("Terri", "terri@example.com");
    const actor = await contact("Mel Actor");
    await db.update(contacts).set({ needsReview: true }).where(eq(contacts.id, a.contactId));
    const held = await mergeContacts(db, a.contactId, b.contactId, actor);
    if (held.outcome !== "held") throw new Error("expected held");

    // Resolving the hold merges the pair; the survivor's own review flag is untouched.
    await resolveHeldMerge(db, held.heldMergeId, { survivingLoginEmailId: a.emailId }, actor);
    const survivor = await db.query.contacts.findFirst({ where: eq(contacts.id, a.contactId) });
    expect(survivor?.needsReview).toBe(true);
  });

  it("a contact in BOTH queues keeps the other task when one is resolved (FR-016)", async () => {
    const a = await makeContactWithEmail({
      firstName: "Nora",
      lastName: "Quinn",
      email: "nora@example.com",
    });
    const b = await contact("Norah Quinn");
    const actor = await makeActor({ email: "mel@example.com", grants: [] });
    await db.update(contacts).set({ needsReview: true }).where(eq(contacts.id, a.contactId));

    expect((await listNeedsReview(db)).items.some((r) => r.id === a.contactId)).toBe(true);
    expect((await getMergeSuggestions(db)).length).toBe(1);

    // Clearing the review flag says nothing about whether these are the same person.
    await db.update(contacts).set({ needsReview: false }).where(eq(contacts.id, a.contactId));
    expect((await getMergeSuggestions(db)).length).toBe(1);

    // And rejecting the pair says nothing about whether the record is complete.
    await db.update(contacts).set({ needsReview: true }).where(eq(contacts.id, a.contactId));
    const { rejectPair } = await import("@/server/domain/dedup/rejectionService");
    await rejectPair(db, a.contactId, b, actor.contactId);
    expect((await getMergeSuggestions(db)).length).toBe(0);
    expect((await listNeedsReview(db)).items.some((r) => r.id === a.contactId)).toBe(true);
  });
});

/**
 * Feature 072, US2 (FR-006, FR-007, FR-008, FR-009, FR-010a).
 *
 * Until this feature a merge moved no roles at all, so merging could not change anyone's authority.
 * The moment it starts moving them, it becomes a privilege path: Mel holds `dedup.write` and can merge
 * any two contacts, so merging an officer's record into her own would make her an officer — including
 * the authority to assign roles, which confers every other. That is the escalation being held.
 *
 * The second trigger is subtler. President / Vice-President / Treasurer are mutually exclusive (FR-005a,
 * separation of authority from money), and that is a CROSS-ROW invariant enforced in the service layer
 * with no constraint behind it — so a merge relinking grants in SQL would break it silently.
 */
const grant = async (contactId: string, role: Role) =>
  db.insert(roleGrants).values({ contactId, role });

describe("a merge that would compound privilege is HELD (FR-006, FR-007)", () => {
  it("holds when the survivor would GAIN role-assigning authority", async () => {
    const survivor = await contact("Mel Manager");
    const officer = await contact("Vee Pee");
    const actor = await contact("Mel Actor");
    await grant(officer, "vice_president");

    const result = await mergeContacts(db, survivor, officer, actor);
    expect(result.outcome).toBe("held");
    if (result.outcome !== "held") throw new Error("expected held");
    expect(result.reason).toBe("role_conflict");

    // Nothing changed: no grant moved and nobody was retired (FR-016).
    expect(
      await db.select().from(roleGrants).where(eq(roleGrants.contactId, survivor)),
    ).toHaveLength(0);
    const merged = await db.query.contacts.findFirst({ where: eq(contacts.id, officer) });
    expect(merged?.mergedIntoId).toBeNull();
  });

  it("does NOT hold when the survivor already holds greater authority — nothing is gained", async () => {
    const survivor = await contact("Super User");
    const officer = await contact("A President");
    const actor = await contact("Mel Actor");
    await grant(survivor, "super_user");
    await grant(officer, "president");

    const result = await mergeContacts(db, survivor, officer, actor);
    expect(result.outcome).toBe("completed");
  });

  it("holds on EXCLUSIVITY even when the merged record carries no role-assigning authority", async () => {
    // The trigger comes wholly from the survivor's side: Treasurer confers no role.assign, but one
    // person must not hold it alongside the President's office.
    const survivor = await contact("The President");
    const treasurer = await contact("The Treasurer");
    const actor = await contact("Mel Actor");
    await grant(survivor, "president");
    await grant(treasurer, "treasurer");

    const result = await mergeContacts(db, survivor, treasurer, actor);
    if (result.outcome !== "held") throw new Error("expected held");
    expect(result.reason).toBe("role_conflict");
  });

  it("moves ordinary working roles with no hold at all (FR-008)", async () => {
    const survivor = await contact("Worker A");
    const dupe = await contact("Worker B");
    const actor = await contact("Mel Actor");
    await grant(dupe, "door_attendant");
    await grant(dupe, "booker");

    const result = await mergeContacts(db, survivor, dupe, actor);
    expect(result.outcome).toBe("completed");
    const moved = await db.select().from(roleGrants).where(eq(roleGrants.contactId, survivor));
    expect(moved.map((g) => g.role).sort()).toEqual(["booker", "door_attendant"]);
  });

  it("collapses an identical duplicate grant rather than colliding (FR-008)", async () => {
    const survivor = await contact("Same A");
    const dupe = await contact("Same B");
    const actor = await contact("Mel Actor");
    await grant(survivor, "door_attendant");
    await grant(dupe, "door_attendant");

    const result = await mergeContacts(db, survivor, dupe, actor);
    expect(result.outcome).toBe("completed");
    const held = await db.select().from(roleGrants).where(eq(roleGrants.contactId, survivor));
    expect(held).toHaveLength(1);
  });
});

describe("resolving a role conflict (FR-009, FR-010a)", () => {
  async function heldConflict() {
    const survivor = await contact("Queue Worker");
    const officer = await contact("An Officer");
    const actor = await makeActor({
      email: `vp-${Math.random().toString(36).slice(2)}@example.com`,
      grants: [{ role: "vice_president" }],
    });
    await grant(officer, "vice_president");
    await grant(officer, "door_attendant");
    const result = await mergeContacts(db, survivor, officer, actor.contactId);
    if (result.outcome !== "held") throw new Error("expected held");
    return { survivor, officer, actor, heldMergeId: result.heldMergeId };
  }

  it("moves exactly the grants named and completes", async () => {
    const { survivor, officer, actor, heldMergeId } = await heldConflict();
    const keep = await db.select().from(roleGrants).where(eq(roleGrants.contactId, officer));
    const doorGrant = keep.find((g) => g.role === "door_attendant")!;

    const out = await resolveHeldMerge(
      db,
      heldMergeId,
      { keepGrantIds: [doorGrant.id] },
      actor.contactId,
    );
    expect(out.outcome).toBe("completed");

    // The ordinary role moved; the role-assigning one did not.
    const now = await db.select().from(roleGrants).where(eq(roleGrants.contactId, survivor));
    expect(now.map((g) => g.role)).toEqual(["door_attendant"]);
  });

  it("accepts an EMPTY choice — moving no grants at all is a valid answer", async () => {
    const { survivor, actor, heldMergeId } = await heldConflict();
    const out = await resolveHeldMerge(db, heldMergeId, { keepGrantIds: [] }, actor.contactId);
    expect(out.outcome).toBe("completed");
    expect(
      await db.select().from(roleGrants).where(eq(roleGrants.contactId, survivor)),
    ).toHaveLength(0);
  });

  it("auto-closes when the conflicting grant is withdrawn instead (FR-010a)", async () => {
    // The other route out of a hold, beside answering it in the chooser (078): an authorised person
    // removes the cause where that decision already lives, and the merge then succeeds on a retry.
    const { officer, actor, heldMergeId } = await heldConflict();
    expect(heldMergeId).toBeTruthy();
    await db
      .delete(roleGrants)
      .where(and(eq(roleGrants.contactId, officer), eq(roleGrants.role, "vice_president")));

    expect(await listHeldMerges(db)).toHaveLength(0);
    const retry = await mergeContacts(
      db,
      (await heldConflict()).survivor,
      officer,
      actor.contactId,
    );
    expect(["completed", "held"]).toContain(retry.outcome);
  });
});

/**
 * Feature 072, US3 (FR-011, FR-012, FR-012a).
 *
 * Feature 069 already held a merge where both contacts could sign in — but its resolution set
 * `contact_emails.is_login`, a LABEL, and never touched `staff_identities`. Access follows the Google
 * account binding, and feature 015 (R9) deliberately allows the two to disagree, because an account can
 * be renamed without telling us. So the officer answering "which sign-in survives?" was changing
 * something that did not decide it. Here the two are settled together or not at all.
 */
async function signInCapable(first: string, email: string) {
  const c = await makeContactWithEmail({ firstName: first, lastName: "Vale", email });
  await db.update(contactEmails).set({ isLogin: true }).where(eq(contactEmails.id, c.emailId));
  const [identity] = await db
    .insert(staffIdentities)
    .values({ contactId: c.contactId, googleSub: `sub-${email}`, lastSignInAt: new Date() })
    .returning();
  return { ...c, identityId: identity!.id };
}

describe("a colliding sign-in is one decision, not two (FR-011, FR-012)", () => {
  it("MOVES the sign-in when only one record has one, preserving when they last signed in", async () => {
    const survivor = await contact("No Signin");
    const signer = await signInCapable("Solo", "solo@example.com");
    const actor = await contact("Mel Actor");
    const before = (
      await db.query.staffIdentities.findFirst({ where: eq(staffIdentities.id, signer.identityId) })
    )?.lastSignInAt;

    const result = await mergeContacts(db, survivor, signer.contactId, actor);
    expect(result.outcome).toBe("completed");

    const identity = await db.query.staffIdentities.findFirst({
      where: eq(staffIdentities.id, signer.identityId),
    });
    expect(identity?.contactId).toBe(survivor);
    expect(identity?.lastSignInAt?.getTime()).toBe(before?.getTime());
  });

  it("holds when BOTH records can sign in", async () => {
    const a = await signInCapable("Terry", "terry@example.com");
    const b = await signInCapable("Terri", "terri@example.com");
    const actor = await contact("Mel Actor");

    const result = await mergeContacts(db, a.contactId, b.contactId, actor);
    if (result.outcome !== "held") throw new Error("expected held");
    expect(result.reason).toBe("two_logins");
    // Nothing moved.
    const identity = await db.query.staffIdentities.findFirst({
      where: eq(staffIdentities.id, b.identityId),
    });
    expect(identity?.contactId).toBe(b.contactId);
  });

  it("resolving settles the ACCOUNT BINDING, not merely the displayed address (FR-012a)", async () => {
    const a = await signInCapable("Terry", "terry@example.com");
    const b = await signInCapable("Terri", "terri@example.com");
    const officer = await makeActor({
      email: "vp-signin@example.com",
      grants: [{ role: "vice_president" }],
    });
    const held = await mergeContacts(db, a.contactId, b.contactId, officer.contactId);
    if (held.outcome !== "held") throw new Error("expected held");

    // Choose the SECOND contact's sign-in, so a resolution that only moved a label would be detectable.
    const out = await resolveHeldMerge(
      db,
      held.heldMergeId,
      { survivingIdentityId: b.identityId, survivingLoginEmailId: b.emailId },
      officer.contactId,
    );
    expect(out.outcome).toBe("completed");

    // Exactly one identity survives ACROSS THE PAIR, it is the chosen one, and it is on the survivor.
    // (Scoped deliberately: the officer resolving the hold has an identity of their own.)
    const identities = await db
      .select()
      .from(staffIdentities)
      .where(sql`${staffIdentities.contactId} IN (${a.contactId}, ${b.contactId})`);
    expect(identities).toHaveLength(1);
    expect(identities[0]!.id).toBe(b.identityId);
    expect(identities[0]!.contactId).toBe(a.contactId);
    // And the label agrees with the binding.
    const logins = await db
      .select()
      .from(contactEmails)
      .where(and(eq(contactEmails.isLogin, true), eq(contactEmails.contactId, a.contactId)));
    expect(logins.map((e) => e.id)).toEqual([b.emailId]);
  });

  it("REFUSES a resolution that names only the address (FR-012a)", async () => {
    const a = await signInCapable("Terry", "terry@example.com");
    const b = await signInCapable("Terri", "terri@example.com");
    const officer = await makeActor({
      email: "vp-addr@example.com",
      grants: [{ role: "vice_president" }],
    });
    const held = await mergeContacts(db, a.contactId, b.contactId, officer.contactId);
    if (held.outcome !== "held") throw new Error("expected held");

    await expect(
      resolveHeldMerge(
        db,
        held.heldMergeId,
        { survivingLoginEmailId: b.emailId },
        officer.contactId,
      ),
    ).rejects.toMatchObject({ code: "HELD_MERGE_REASON_MISMATCH" });
  });
});

/**
 * Feature 072 (FR-017, FR-018) — found in the manual pass.
 *
 * A hold is a question, and "no, leave them alone" is a legitimate answer to it. Until now the only ways
 * out were to resolve the hold (which needs the reason's authority) or to remove its cause (which changes
 * someone's access). Neither is right for the common case: Mel tried a merge, it stopped, and she has
 * decided not to pursue it.
 *
 * Abandoning is non-destructive by construction — a hold never wrote anything — so it needs only the
 * authority to merge, which is what Mel already holds. It must NOT touch grants, accounts or sign-ins.
 */
describe("abandoning a held merge (FR-017)", () => {
  async function held() {
    const survivor = await contact("Queue Worker");
    const officer = await contact("An Officer");
    const actor = await contact("Mel Actor");
    await grant(officer, "vice_president");
    const result = await mergeContacts(db, survivor, officer, actor);
    if (result.outcome !== "held") throw new Error("expected held");
    return { survivor, officer, actor, heldMergeId: result.heldMergeId };
  }

  it("closes the hold without merging and without touching access", async () => {
    const { survivor, officer, actor, heldMergeId } = await held();

    await abandonHeldMerge(db, heldMergeId, actor);

    // The hold is gone from the queue …
    expect(await listHeldMerges(db)).toHaveLength(0);
    // … nothing merged …
    const merged = await db.query.contacts.findFirst({ where: eq(contacts.id, officer) });
    expect(merged?.mergedIntoId).toBeNull();
    // … and the grant that caused it is untouched, on the contact that held it.
    const grants = await db.select().from(roleGrants).where(eq(roleGrants.contactId, officer));
    expect(grants.map((g) => g.role)).toEqual(["vice_president"]);
    expect(
      await db.select().from(roleGrants).where(eq(roleGrants.contactId, survivor)),
    ).toHaveLength(0);
  });

  it("is available to a dedup worker who cannot resolve it", async () => {
    // Mel holds `dedup.write` but not `role.assign`: she cannot answer the question, but she may
    // withdraw it. That is the whole point — otherwise the queue fills with items she cannot clear.
    const { heldMergeId } = await held();
    const mel = await makeActor({
      email: "mel-abandon@example.com",
      grants: [{ role: "mailing_list_manager" }],
    });
    const res = await ABANDON_HELD(
      jsonReqAs(mel.token, "DELETE", `/api/dedup/held/${heldMergeId}`),
      ctx({ id: heldMergeId }),
    );
    expect(res.status).toBe(200);
    expect(await listHeldMerges(db)).toHaveLength(0);
  });

  it("refuses a volunteer who cannot merge at all", async () => {
    const { heldMergeId } = await held();
    const base = await makeBaseActor("nobody-abandon@example.com");
    const res = await ABANDON_HELD(
      jsonReqAs(base.token, "DELETE", `/api/dedup/held/${heldMergeId}`),
      ctx({ id: heldMergeId }),
    );
    expect(res.status).toBe(403);
    expect(await listHeldMerges(db)).toHaveLength(1);
  });

  it("does not stop the pair being merged later", async () => {
    // Abandoning says "not now", not "not duplicates" — those are different judgements, and the second
    // has its own record (`dedup_rejections`).
    const { survivor, officer, actor, heldMergeId } = await held();
    await abandonHeldMerge(db, heldMergeId, actor);
    const again = await mergeContacts(db, survivor, officer, actor);
    expect(again.outcome).toBe("held");
  });
});

/**
 * Feature 072 — found by walking §5 of the manual pass.
 *
 * The auto-close and the detection must ask the SAME question. They did not: detection fires on a login
 * address OR a sign-in identity, while the auto-close sweep counted only login addresses. Clearing one
 * address therefore closed the hold — and the next merge attempt raised it again, because both contacts
 * still held an identity. Remove the cause, hold clears, retry, held again: a loop with no exit and no
 * explanation.
 *
 * The `role_conflict` case avoids this only because its auto-close calls the same function the merge
 * does. These now do too.
 */
describe("a hold closes only when the merge would actually succeed", () => {
  async function bothSignIn() {
    const a = await signInCapable("Peg", "peg-a@example.com");
    const b = await signInCapable("Peggy", "peg-b@example.com");
    const actor = await contact("Mel Actor");
    const result = await mergeContacts(db, a.contactId, b.contactId, actor);
    if (result.outcome !== "held") throw new Error("expected held");
    return { a, b, actor };
  }

  it("does NOT close while the identities still collide, even with one login address cleared", async () => {
    const { a } = await bothSignIn();
    await db.update(contactEmails).set({ isLogin: false }).where(eq(contactEmails.id, a.emailId));

    // The obstacle is still there, so the hold must still be there.
    expect(await listHeldMerges(db)).toHaveLength(1);
  });

  it("closes once the obstacle is genuinely gone, and the merge then succeeds", async () => {
    const { a, b, actor } = await bothSignIn();
    await db.update(contactEmails).set({ isLogin: false }).where(eq(contactEmails.id, a.emailId));
    await db.delete(staffIdentities).where(eq(staffIdentities.id, a.identityId));

    expect(await listHeldMerges(db)).toHaveLength(0);
    const retry = await mergeContacts(db, a.contactId, b.contactId, actor);
    expect(retry.outcome).toBe("completed");
  });
});

/**
 * Feature 078 (research R1). ONE function decides what, if anything, still blocks a merge — the merge,
 * the chooser and the auto-close all call it. Feature 072 shipped the failure this prevents: the
 * auto-close and the merge detection asked different versions of "can both sign in?", so a hold closed
 * and the next attempt raised it again, forever.
 */
describe("one detector: the merge and the auto-close agree (078, R1)", () => {
  it("detects the same reason the merge holds, for each existing reason", async () => {
    const actor = await contact("Mel Actor");

    const a = await withLogin("Terry", "terry@example.com");
    const b = await withLogin("Terri", "terri@example.com");
    const logins = await mergeContacts(db, a.contactId, b.contactId, actor);
    expect(logins.outcome === "held" && logins.reason).toBe("two_logins");
    expect((await detectHold(db, a.contactId, b.contactId)).hold?.reason).toBe("two_logins");

    const payerA = await contact("Pat Payer");
    const payerB = await contact("Pat Payor");
    await makeMembershipAccount({ payerContactId: payerA, expiryDate: "2027-01-01" });
    await makeMembershipAccount({ payerContactId: payerB, expiryDate: "2027-01-01" });
    const accounts = await mergeContacts(db, payerA, payerB, actor);
    expect(accounts.outcome === "held" && accounts.reason).toBe("two_accounts");
    expect((await detectHold(db, payerA, payerB)).hold?.reason).toBe("two_accounts");

    const president = await contact("Pres Ident");
    const treasurer = await contact("Tres Urer");
    await grant(president, "president");
    await grant(treasurer, "treasurer");
    const roles = await mergeContacts(db, president, treasurer, actor);
    expect(roles.outcome === "held" && roles.reason).toBe("role_conflict");
    expect((await detectHold(db, president, treasurer)).hold?.reason).toBe("role_conflict");
  });

  it("closes a hold exactly when the detector finds nothing — two accounts included", async () => {
    const actor = await contact("Mel Actor");
    const payerA = await contact("Pat Payer");
    const payerB = await contact("Pat Payor");
    const { accountId } = await makeMembershipAccount({
      payerContactId: payerA,
      expiryDate: "2027-01-01",
    });
    await makeMembershipAccount({ payerContactId: payerB, expiryDate: "2027-01-01" });
    await mergeContacts(db, payerA, payerB, actor);
    expect(await listHeldMerges(db)).toHaveLength(1);

    // Still blocked: the hold stays.
    expect((await detectHold(db, payerA, payerB)).hold).not.toBeNull();
    expect(await listHeldMerges(db)).toHaveLength(1);

    // Remove the obstacle: the detector clears, and so does the hold — no separate SQL count needed.
    await db.delete(membershipAccounts).where(eq(membershipAccounts.id, accountId));
    expect((await detectHold(db, payerA, payerB)).hold).toBeNull();
    expect(await listHeldMerges(db)).toHaveLength(0);
  });

  it("never lets a foreign surviving account through — it would delete both of the pair's accounts", async () => {
    // Analyze U1. The account fold deletes every account of the pair except the chosen one. An answer
    // naming an account that is not the pair's used to count as settling the question merely by being
    // present — so both of the pair's accounts would have been deleted.
    const actor = await contact("Mel Actor");
    const payerA = await contact("Pat Payer");
    const payerB = await contact("Pat Payor");
    const stranger = await contact("Stranger");
    await makeMembershipAccount({ payerContactId: payerA, expiryDate: "2027-01-01" });
    await makeMembershipAccount({ payerContactId: payerB, expiryDate: "2027-01-01" });
    const { accountId: foreign } = await makeMembershipAccount({
      payerContactId: stranger,
      expiryDate: "2027-01-01",
    });

    const assessed = await detectHold(db, payerA, payerB, { survivingAccountId: foreign });
    expect(assessed.hold?.reason).toBe("two_accounts");
    expect(
      assessed.hold?.stale,
      "a foreign account must be reported stale, not settling",
    ).toBeTruthy();
    expect(assessed.apply.survivingAccountId).toBeUndefined();

    await expect(
      mergeContacts(db, payerA, payerB, actor, { survivingAccountId: foreign }),
    ).rejects.toThrow();
    const remaining = await db
      .select()
      .from(membershipAccounts)
      .where(sql`${membershipAccounts.payerContactId} IN (${payerA}, ${payerB})`);
    expect(remaining, "the pair's accounts were deleted by a foreign answer").toHaveLength(2);
  });
});
