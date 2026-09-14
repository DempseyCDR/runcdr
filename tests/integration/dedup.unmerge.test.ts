import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import {
  attendance,
  contactEmails,
  contacts,
  membershipAccounts,
  membershipMembers,
  mergeAudit,
  mergeReversals,
  officers,
  performers,
  roleGrants,
  staffIdentities,
} from "@/server/db/schema";
import {
  contactRow,
  makeContactWithEmail,
  makeEvent,
  makeMembershipAccount,
} from "./helpers/factories";
import { mergeContacts } from "@/server/domain/dedup/mergeService";
import { undoMerge } from "@/server/domain/dedup/undoMergeService";
import { parseManifest } from "@/server/domain/dedup/mergeManifest";
import { resolveSignIn } from "@/server/auth/signIn";

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

const contact = async (name: string) =>
  (await db.insert(contacts).values(contactRow(name)).returning())[0]!.id;

const mergeIdFor = async (mergedId: string) =>
  (await db.query.mergeAudit.findFirst({ where: eq(mergeAudit.mergedId, mergedId) }))!.id;

/** An actor holding role.assign, so access-changing entries are applied rather than skipped. */
const FULL_AUTHORITY = { canAssignRoles: true } as const;

/**
 * Feature 074, User Story 1 (FR-012 to FR-022).
 *
 * A merge was the one destructive action in contact maintenance that could not be taken back. Recovery
 * meant restoring the database — discarding every other change since the backup, and needing somebody
 * who is not the mailing-list manager.
 */
describe("undo returns both contacts to their pre-merge state (FR-012 to FR-017)", () => {
  it("restores everything the merge moved", async () => {
    const survivor = await contact("Keep Me");
    const { contactId: dupe, emailId } = await makeContactWithEmail({
      displayName: "Drop Me",
      email: "drop@example.com",
    });
    const event = await makeEvent();
    await db.insert(performers).values({ displayName: "Drop Me", contactId: dupe });
    await db.insert(attendance).values({ eventId: event.id, contactId: dupe });
    await db.insert(officers).values({ roleKey: "secretary", contactId: dupe });
    await db.insert(roleGrants).values({ contactId: dupe, role: "booker", grantedBy: survivor });

    const merged = await mergeContacts(db, survivor, dupe, survivor);
    if (merged.outcome !== "completed") throw new Error("expected completed");

    const result = await undoMerge(db, await mergeIdFor(dupe), survivor, FULL_AUTHORITY);
    expect(result.skipped).toEqual([]);

    // The retired contact is alive again (FR-012), with its own fields never having been touched.
    const restored = await db.query.contacts.findFirst({ where: eq(contacts.id, dupe) });
    expect(restored?.mergedIntoId).toBeNull();
    expect(restored?.displayName).toBe("Drop Me");

    // Asserted per table, not as a total: one count can hide a category silently not coming back.
    for (const [table, column] of [
      [performers, performers.contactId],
      [attendance, attendance.contactId],
      [officers, officers.contactId],
      [roleGrants, roleGrants.contactId],
      [contactEmails, contactEmails.contactId],
    ] as const) {
      expect(await db.select().from(table).where(eq(column, dupe))).toHaveLength(1);
      expect(await db.select().from(table).where(eq(column, survivor))).toHaveLength(0);
    }
    expect(
      (await db.query.contactEmails.findFirst({ where: eq(contactEmails.id, emailId) }))?.contactId,
    ).toBe(dupe);
  });

  it("recomputes the cached membership status of BOTH contacts (FR-017)", async () => {
    // The survivor gains membership coverage from the merge, so undoing it must take that away again.
    // Nothing in the row-level assertions above would notice a stale cached status, and 068 to 070 kept
    // producing exactly this kind of silent wrongness.
    const survivor = await contact("Keep Me");
    const dupe = await contact("Drop Me");
    // The factory attaches the payer itself, so `members` must not repeat them.
    await makeMembershipAccount({ payerContactId: dupe, expiryDate: "2099-01-01" });

    const merged = await mergeContacts(db, survivor, dupe, survivor);
    if (merged.outcome !== "completed") throw new Error("expected completed");
    const afterMerge = await db.query.contacts.findFirst({ where: eq(contacts.id, survivor) });
    expect(afterMerge?.membershipStatus, "merge should have granted coverage").toBe("current");

    await undoMerge(db, await mergeIdFor(dupe), survivor, FULL_AUTHORITY);

    const survivorAfter = await db.query.contacts.findFirst({ where: eq(contacts.id, survivor) });
    const dupeAfter = await db.query.contacts.findFirst({ where: eq(contacts.id, dupe) });
    expect(survivorAfter?.membershipStatus, "the survivor kept coverage it no longer has").not.toBe(
      "current",
    );
    expect(dupeAfter?.membershipStatus, "the restored contact did not get its coverage back").toBe(
      "current",
    );
  });

  it("recreates the duplicate attendance row the merge dropped (FR-014)", async () => {
    const survivor = await contact("Keep Me");
    const dupe = await contact("Drop Me");
    const event = await makeEvent();
    await db.insert(attendance).values({ eventId: event.id, contactId: survivor });
    await db.insert(attendance).values({ eventId: event.id, contactId: dupe });

    const merged = await mergeContacts(db, survivor, dupe, survivor);
    if (merged.outcome !== "completed") throw new Error("expected completed");
    // The merge dropped one of the two, since attendance is unique per (event, contact).
    expect(await db.select().from(attendance)).toHaveLength(1);

    const result = await undoMerge(db, await mergeIdFor(dupe), survivor, FULL_AUTHORITY);
    expect(result.skipped).toEqual([]);

    const rows = await db.select().from(attendance).where(eq(attendance.eventId, event.id));
    expect(rows.map((r) => r.contactId).sort()).toEqual([survivor, dupe].sort());
  });

  it("restores the discarded account, its household, and the cascade-lost rows (FR-014)", async () => {
    const survivor = await contact("Keep Me");
    const dupe = await contact("Drop Me");
    const shared = await contact("On Both Accounts");
    const onlyOnDiscarded = await contact("Only Here");

    await makeMembershipAccount({
      payerContactId: survivor,
      expiryDate: "2027-01-01",
      members: [shared],
    });
    const { accountId: discarded } = await makeMembershipAccount({
      payerContactId: dupe,
      level: "family",
      expiryDate: "2028-06-30",
      members: [shared, onlyOnDiscarded],
    });

    const held = await mergeContacts(db, survivor, dupe, survivor);
    if (held.outcome !== "held" || held.reason !== "two_accounts") {
      throw new Error("expected a two_accounts hold");
    }
    const keep = held.candidates.find((c) => c.payerDisplayName === "Keep Me")!.accountId;
    const merged = await mergeContacts(db, survivor, dupe, survivor, { survivingAccountId: keep });
    if (merged.outcome !== "completed") throw new Error("expected completed");

    const result = await undoMerge(db, await mergeIdFor(dupe), survivor, FULL_AUTHORITY);
    expect(result.skipped).toEqual([]);

    // The account is back, with the attributes that died with it.
    const account = await db.query.membershipAccounts.findFirst({
      where: eq(membershipAccounts.id, discarded),
    });
    expect(account, "the discarded account was not restored").toBeTruthy();
    expect(account?.level).toBe("family");
    expect(account?.expiryDate).toBe("2028-06-30");
    expect(account?.payerContactId).toBe(dupe);

    // Its whole household, including `shared` — whose row was cascade-deleted rather than copied,
    // because ON CONFLICT DO NOTHING skipped them for already being on the surviving account.
    const household = await db
      .select({ contactId: membershipMembers.contactId })
      .from(membershipMembers)
      .where(eq(membershipMembers.accountId, discarded));
    expect(household.map((m) => m.contactId).sort()).toEqual(
      [dupe, shared, onlyOnDiscarded].sort(),
    );

    // And the survivor's household is back to what it was — the copied rows removed (FR-016).
    const survivingHousehold = await db
      .select({ contactId: membershipMembers.contactId })
      .from(membershipMembers)
      .where(eq(membershipMembers.accountId, keep));
    expect(survivingHousehold.map((m) => m.contactId).sort()).toEqual([survivor, shared].sort());
  });

  it("restores the demoted login address and the deleted sign-in (FR-014, FR-015)", async () => {
    const { contactId: survivor, emailId: survivorEmail } = await makeContactWithEmail({
      displayName: "Keep Me",
      email: "keep@example.com",
    });
    const { contactId: dupe, emailId: dupeEmail } = await makeContactWithEmail({
      displayName: "Drop Me",
      email: "drop@example.com",
    });
    await db
      .update(contactEmails)
      .set({ isLogin: true })
      .where(sql`${contactEmails.id} IN (${survivorEmail}, ${dupeEmail})`);
    const [survivorIdentity] = await db
      .insert(staffIdentities)
      .values({ contactId: survivor, googleSub: "sub-keep" })
      .returning();
    await db.insert(staffIdentities).values({ contactId: dupe, googleSub: "sub-drop" });

    const merged = await mergeContacts(db, survivor, dupe, survivor, {
      survivingIdentityId: survivorIdentity!.id,
      survivingLoginEmailId: survivorEmail,
    });
    if (merged.outcome !== "completed") throw new Error("expected completed");

    const result = await undoMerge(db, await mergeIdFor(dupe), survivor, FULL_AUTHORITY);
    expect(result.skipped).toEqual([]);

    // The deleted binding is back on the restored contact, by its durable google_sub. Scoped to this
    // pair: the test harness seeds a staff identity of its own, so a global count would be meaningless.
    const identities = await db
      .select()
      .from(staffIdentities)
      .where(sql`${staffIdentities.contactId} IN (${survivor}, ${dupe})`);
    expect(identities.map((i) => i.googleSub).sort()).toEqual(["sub-drop", "sub-keep"]);
    expect(identities.find((i) => i.googleSub === "sub-drop")?.contactId).toBe(dupe);
    // And the address that labels it is a login address again.
    expect(
      (await db.query.contactEmails.findFirst({ where: eq(contactEmails.id, dupeEmail) }))?.isLogin,
    ).toBe(true);
  });
});

describe("undo is best-effort per entry, and says so (FR-018, FR-020)", () => {
  it("skips a moved row that has since been deleted, as `gone`", async () => {
    const survivor = await contact("Keep Me");
    const dupe = await contact("Drop Me");
    const event = await makeEvent();
    await db.insert(performers).values({ displayName: "Drop Me", contactId: dupe });
    const [att] = await db
      .insert(attendance)
      .values({ eventId: event.id, contactId: dupe })
      .returning();

    const merged = await mergeContacts(db, survivor, dupe, survivor);
    if (merged.outcome !== "completed") throw new Error("expected completed");

    // Somebody deleted the check-in after the merge. There is nothing to move back.
    await db.delete(attendance).where(eq(attendance.id, att!.id));

    const result = await undoMerge(db, await mergeIdFor(dupe), survivor, FULL_AUTHORITY);

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ table: "attendance", kind: "move", reason: "gone" });
    // The rest still came back — one absent row must not sink the reversal.
    expect(await db.select().from(performers).where(eq(performers.contactId, dupe))).toHaveLength(
      1,
    );
  });

  it("skips a destroyed row whose position is now taken, as `occupied`", async () => {
    const survivor = await contact("Keep Me");
    const dupe = await contact("Drop Me");
    const event = await makeEvent();
    await db.insert(attendance).values({ eventId: event.id, contactId: survivor });
    await db.insert(attendance).values({ eventId: event.id, contactId: dupe });
    await db.insert(performers).values({ displayName: "Drop Me", contactId: dupe });

    const merged = await mergeContacts(db, survivor, dupe, survivor);
    if (merged.outcome !== "completed") throw new Error("expected completed");

    // The person was checked in to that event again under the restored identity after the merge, so the
    // slot the dropped row occupied is no longer free.
    await db.insert(attendance).values({ eventId: event.id, contactId: dupe });

    const result = await undoMerge(db, await mergeIdFor(dupe), survivor, FULL_AUTHORITY);

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      table: "attendance",
      kind: "destroy",
      reason: "occupied",
    });
    // The row that exists is kept, not replaced.
    const rows = await db.select().from(attendance).where(eq(attendance.eventId, event.id));
    expect(rows).toHaveLength(2);
  });

  it("records what it restored and what it skipped (FR-021, SC-006)", async () => {
    const survivor = await contact("Keep Me");
    const dupe = await contact("Drop Me");
    await db.insert(performers).values({ displayName: "Drop Me", contactId: dupe });

    const merged = await mergeContacts(db, survivor, dupe, survivor);
    if (merged.outcome !== "completed") throw new Error("expected completed");
    const mergeId = await mergeIdFor(dupe);

    const result = await undoMerge(db, mergeId, survivor, FULL_AUTHORITY);
    expect(result.restored.performers).toBe(1);

    const reversal = await db.query.mergeReversals.findFirst({
      where: eq(mergeReversals.mergeAuditId, mergeId),
    });
    expect(reversal?.actor).toBe(survivor);
    expect(reversal?.restoredCounts).toMatchObject({ performers: 1 });

    // FR-006: the merge's own record is untouched by the undo.
    const audit = await db.query.mergeAudit.findFirst({ where: eq(mergeAudit.id, mergeId) });
    expect(audit?.reversalManifest).toBeTruthy();
    expect(audit?.mergedId).toBe(dupe);
  });
});

describe("undo refuses when it should (FR-008, FR-010, FR-019)", () => {
  it("refuses a second undo of the same merge", async () => {
    const survivor = await contact("Keep Me");
    const dupe = await contact("Drop Me");
    await db.insert(performers).values({ displayName: "Drop Me", contactId: dupe });
    const merged = await mergeContacts(db, survivor, dupe, survivor);
    if (merged.outcome !== "completed") throw new Error("expected completed");
    const mergeId = await mergeIdFor(dupe);

    await undoMerge(db, mergeId, survivor, FULL_AUTHORITY);
    await expect(undoMerge(db, mergeId, survivor, FULL_AUTHORITY)).rejects.toThrow(
      /already been undone/i,
    );
    // And exactly one reversal row exists, not two.
    expect(await db.select().from(mergeReversals)).toHaveLength(1);
  });

  it("refuses when the survivor has itself since been merged away", async () => {
    const survivor = await contact("Keep Me");
    const dupe = await contact("Drop Me");
    await db.insert(performers).values({ displayName: "Drop Me", contactId: dupe });
    const first = await mergeContacts(db, survivor, dupe, survivor);
    if (first.outcome !== "completed") throw new Error("expected completed");
    const mergeId = await mergeIdFor(dupe);

    const third = await contact("Final Survivor");
    const second = await mergeContacts(db, third, survivor, third);
    if (second.outcome !== "completed") throw new Error("expected completed");

    await expect(undoMerge(db, mergeId, survivor, FULL_AUTHORITY)).rejects.toThrow(
      /undo that later merge first/i,
    );
    // Nothing moved: the refusal happens before any write.
    expect(await db.select().from(performers).where(eq(performers.contactId, dupe))).toHaveLength(
      0,
    );
  });

  it("refuses a merge recorded before this feature", async () => {
    const survivor = await contact("Keep Me");
    const dupe = await contact("Drop Me");
    await db.insert(performers).values({ displayName: "Drop Me", contactId: dupe });
    const merged = await mergeContacts(db, survivor, dupe, survivor);
    if (merged.outcome !== "completed") throw new Error("expected completed");
    const mergeId = await mergeIdFor(dupe);
    await db.update(mergeAudit).set({ reversalManifest: null }).where(eq(mergeAudit.id, mergeId));

    await expect(undoMerge(db, mergeId, survivor, FULL_AUTHORITY)).rejects.toThrow(
      /recorded before undo existed/i,
    );
  });
});

/**
 * Feature 074, User Story 3 (FR-024, FR-025).
 *
 * Restoring sign-in is the one part of an undo that GRANTS something rather than separating two records
 * that were wrongly joined, so it is the one part that needs a second key. Missing that key skips those
 * entries; it never refuses the reversal, because the rest of the undo is useful without them and
 * because a skipped binding repairs itself — see the enrolment test below.
 */
describe("restoring sign-in needs role-assignment authority (FR-024, FR-025)", () => {
  const MEL = { canAssignRoles: false } as const;

  it("skips a MOVED binding without role.assign, and restores everything else", async () => {
    const survivor = await contact("Keep Me");
    const { contactId: dupe } = await makeContactWithEmail({
      displayName: "Drop Me",
      email: "drop@example.com",
    });
    await db.insert(staffIdentities).values({ contactId: dupe, googleSub: "sub-drop" });
    await db.insert(performers).values({ displayName: "Drop Me", contactId: dupe });

    const merged = await mergeContacts(db, survivor, dupe, survivor);
    if (merged.outcome !== "completed") throw new Error("expected completed");

    const result = await undoMerge(db, await mergeIdFor(dupe), survivor, MEL);

    // Moving a binding BACK changes who can sign in just as much as recreating a deleted one, so the
    // gate covers both — it is not a "re-creation only" rule.
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      table: "staff_identities",
      reason: "not_authorized",
    });
    expect(
      (
        await db.query.staffIdentities.findFirst({
          where: eq(staffIdentities.googleSub, "sub-drop"),
        })
      )?.contactId,
      "the binding should have been left where it was",
    ).toBe(survivor);
    // Everything not about sign-in came back, and the contact is live again.
    expect(await db.select().from(performers).where(eq(performers.contactId, dupe))).toHaveLength(
      1,
    );
    expect(
      (await db.query.contacts.findFirst({ where: eq(contacts.id, dupe) }))?.mergedIntoId,
    ).toBeNull();
  });

  it("applies the same binding when the actor DOES hold role.assign", async () => {
    const survivor = await contact("Keep Me");
    const { contactId: dupe } = await makeContactWithEmail({
      displayName: "Drop Me",
      email: "drop@example.com",
    });
    await db.insert(staffIdentities).values({ contactId: dupe, googleSub: "sub-drop" });

    const merged = await mergeContacts(db, survivor, dupe, survivor);
    if (merged.outcome !== "completed") throw new Error("expected completed");

    const result = await undoMerge(db, await mergeIdFor(dupe), survivor, FULL_AUTHORITY);

    expect(result.skipped).toEqual([]);
    expect(
      (
        await db.query.staffIdentities.findFirst({
          where: eq(staffIdentities.googleSub, "sub-drop"),
        })
      )?.contactId,
    ).toBe(dupe);
  });

  it("skips a DELETED binding and the address label together, or neither", async () => {
    const { contactId: survivor, emailId: survivorEmail } = await makeContactWithEmail({
      displayName: "Keep Me",
      email: "keep@example.com",
    });
    const { contactId: dupe, emailId: dupeEmail } = await makeContactWithEmail({
      displayName: "Drop Me",
      email: "drop@example.com",
    });
    await db
      .update(contactEmails)
      .set({ isLogin: true })
      .where(sql`${contactEmails.id} IN (${survivorEmail}, ${dupeEmail})`);
    const [survivorIdentity] = await db
      .insert(staffIdentities)
      .values({ contactId: survivor, googleSub: "sub-keep" })
      .returning();
    await db.insert(staffIdentities).values({ contactId: dupe, googleSub: "sub-drop" });

    const merged = await mergeContacts(db, survivor, dupe, survivor, {
      survivingIdentityId: survivorIdentity!.id,
      survivingLoginEmailId: survivorEmail,
    });
    if (merged.outcome !== "completed") throw new Error("expected completed");

    const result = await undoMerge(db, await mergeIdFor(dupe), survivor, MEL);

    // The binding and the label that names it are one decision: leaving one without the other would be
    // a half-granted sign-in, which is worse than neither.
    expect(result.skipped.map((s) => s.table).sort()).toEqual(
      ["contact_emails", "staff_identities"].sort(),
    );
    for (const s of result.skipped) expect(s.reason).toBe("not_authorized");
    expect(
      await db
        .select()
        .from(staffIdentities)
        .where(sql`${staffIdentities.contactId} IN (${survivor}, ${dupe})`),
    ).toHaveLength(1);
    expect(
      (await db.query.contactEmails.findFirst({ where: eq(contactEmails.id, dupeEmail) }))?.isLogin,
    ).toBe(false);
  });

  it("leaves nobody stranded: a skipped binding re-enrols on the next sign-in", async () => {
    // This is what makes skipping an acceptable answer to missing authority rather than a lockout, so
    // it is asserted rather than assumed (research R8). The login address returns with the undo, and
    // enrolment is automatic, so the person lands on the RESTORED contact by themselves.
    const survivor = await contact("Keep Me");
    const { contactId: dupe } = await makeContactWithEmail({
      displayName: "Drop Me",
      email: "drop@example.com",
    });
    await db.update(contacts).set({ isVolunteer: true }).where(eq(contacts.id, dupe));
    await db.insert(staffIdentities).values({ contactId: dupe, googleSub: "sub-drop" });

    // Feature 078: a volunteer merged into a non-volunteer carries its status only on an officer's answer.
    const merged = await mergeContacts(db, survivor, dupe, survivor, { carryVolunteer: true });
    if (merged.outcome !== "completed") throw new Error("expected completed");

    const result = await undoMerge(db, await mergeIdFor(dupe), survivor, MEL);
    // The moved binding, and the carry's three volunteer columns (078) — all access-changing.
    expect(result.skipped.map((s) => s.table).sort()).toEqual([
      "contacts",
      "contacts",
      "contacts",
      "staff_identities",
    ]);

    // The binding still points at the survivor, so that Google account cannot be re-enrolled — but a
    // DIFFERENT Google account presenting the restored contact's address enrols against it cleanly.
    const signIn = await resolveSignIn(db, {
      sub: "sub-new-device",
      email: "drop@example.com",
      email_verified: true,
    });
    expect(signIn.ok, "the restored contact could not sign in").toBe(true);
    if (signIn.ok) expect(signIn.contactId).toBe(dupe);
  });
});

describe("undo never touches what happened after the merge (FR-022, SC-005)", () => {
  it("leaves rows created on the survivor after the merge alone", async () => {
    const survivor = await contact("Keep Me");
    const dupe = await contact("Drop Me");
    const event = await makeEvent();
    await db.insert(performers).values({ displayName: "Drop Me", contactId: dupe });

    const merged = await mergeContacts(db, survivor, dupe, survivor);
    if (merged.outcome !== "completed") throw new Error("expected completed");

    // Life went on: the survivor gained an address and attended a dance after the merge.
    const later = await makeEvent({ eventDate: "2027-03-03" });
    await db.insert(attendance).values({ eventId: later.id, contactId: survivor });
    const [newEmail] = await db
      .insert(contactEmails)
      .values({ contactId: survivor, email: "later@example.com" })
      .returning();
    expect(event.id).not.toBe(later.id);

    await undoMerge(db, await mergeIdFor(dupe), survivor, FULL_AUTHORITY);

    // Both stay with the survivor. An undo returns what the merge moved, and nothing else.
    expect(
      await db.select().from(attendance).where(eq(attendance.contactId, survivor)),
    ).toHaveLength(1);
    expect(
      (await db.query.contactEmails.findFirst({ where: eq(contactEmails.id, newEmail!.id) }))
        ?.contactId,
    ).toBe(survivor);
  });
});

/**
 * Feature 078 (FR-013): carrying volunteer status is a change to who can sign in, so undoing it is too —
 * it rides the same role-assignment gate as a moved Google account.
 */
describe("undoing a merge that carried volunteer status (078 US3)", () => {
  async function carried() {
    const approver = await contact("Pat Approver");
    const survivor = await contact("Keep Me");
    const priorApproval = new Date("2025-01-01T00:00:00Z");
    await db
      .update(contacts)
      .set({ volunteerApprovedAt: priorApproval, volunteerApprovedBy: approver })
      .where(eq(contacts.id, survivor));
    const dupe = await contact("Drop Me");
    await db
      .update(contacts)
      .set({ isVolunteer: true, volunteerApprovedAt: new Date("2026-03-01T00:00:00Z") })
      .where(eq(contacts.id, dupe));
    const merged = await mergeContacts(db, survivor, dupe, survivor, { carryVolunteer: true });
    if (merged.outcome !== "completed") throw new Error("expected completed");
    return { survivor, dupe, approver, priorApproval };
  }

  it("records the carry as three access-changing overwrites", async () => {
    const { dupe, approver, priorApproval } = await carried();
    const row = await db.query.mergeAudit.findFirst({ where: eq(mergeAudit.mergedId, dupe) });
    const overwrites = parseManifest(row!.reversalManifest)!.entries.filter(
      (e) => e.kind === "overwrite" && e.table === "contacts",
    );
    expect(overwrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          column: "is_volunteer",
          previousValue: false,
          accessChanging: true,
        }),
        expect.objectContaining({
          column: "volunteer_approved_at",
          previousValue: priorApproval.toISOString(),
          accessChanging: true,
        }),
        expect.objectContaining({
          column: "volunteer_approved_by",
          previousValue: approver,
          accessChanging: true,
        }),
      ]),
    );
    expect(overwrites).toHaveLength(3);
  });

  it("an officer's undo makes the survivor a non-volunteer again, with its own approval back", async () => {
    const { survivor, dupe, approver, priorApproval } = await carried();
    await undoMerge(db, await mergeIdFor(dupe), survivor, FULL_AUTHORITY);
    const kept = await db.query.contacts.findFirst({ where: eq(contacts.id, survivor) });
    expect(kept).toMatchObject({ isVolunteer: false, volunteerApprovedBy: approver });
    expect(kept?.volunteerApprovedAt?.toISOString()).toBe(priorApproval.toISOString());
  });

  it("an undo without role-assignment authority skips all three", async () => {
    const { survivor, dupe } = await carried();
    const result = await undoMerge(db, await mergeIdFor(dupe), survivor, { canAssignRoles: false });
    expect(result.skipped.filter((s) => s.table === "contacts")).toHaveLength(3);
    expect(result.skipped.every((s) => s.reason === "not_authorized")).toBe(true);
    expect(
      (await db.query.contacts.findFirst({ where: eq(contacts.id, survivor) }))?.isVolunteer,
    ).toBe(true);
  });
});
