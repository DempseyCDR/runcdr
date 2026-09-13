import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq, getTableName, sql } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import {
  contacts,
  membershipAccounts,
  mergeAudit,
  mergeReversals,
  performers,
  roleGrants,
} from "@/server/db/schema";
import { contactRow, makeMembershipAccount } from "./helpers/factories";
import { mergeContacts } from "@/server/domain/dedup/mergeService";
import { undoMerge } from "@/server/domain/dedup/undoMergeService";
import {
  CONTACT_DELETE_BLOCKERS,
  contactDeleteBlockers,
  deleteContact,
} from "@/server/domain/contacts/contactService";

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

const contact = async (name: string) =>
  (await db.insert(contacts).values(contactRow(name)).returning())[0]!.id;

const exists = async (id: string) =>
  !!(await db.query.contacts.findFirst({ where: eq(contacts.id, id) }));

/** Merge `mergedId` into `survivor`; the merged contact carries a performer so the merge moves something. */
async function merge(survivor: string, mergedId: string): Promise<string> {
  await db.insert(performers).values({ displayName: "perf", contactId: mergedId });
  const r = await mergeContacts(db, survivor, mergedId, survivor);
  if (r.outcome !== "completed") throw new Error("expected completed");
  return (await db.query.mergeAudit.findFirst({ where: eq(mergeAudit.mergedId, mergedId) }))!.id;
}

/** What a delete threw — its code and detail — or null when it succeeded. */
async function refusal(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { code?: string; detail?: string; message?: string };
    return { code: err.code, detail: err.detail ?? "", message: err.message ?? "" };
  }
}

/**
 * Feature 077 (close-out §2c). A contact that had ever been in a merge could never be deleted:
 * `merge_audit` referenced both contacts with no delete rule, the delete check did not know that, and so
 * the delete failed with a raw Postgres error — and the unrestricted path destroyed the membership account
 * before failing. Undo is a SHORT-TERM recovery; the merge record pinned both contacts FOREVER.
 *
 * Decided direction: a contact's merge records go with it; deleting a survivor takes its merged-in
 * contacts; the delete is one transaction; and anyone who has ever acted as staff is never deleted, but is
 * refused cleanly rather than with a raw error.
 */
describe("a contact's merge history is deleted with it (077)", () => {
  it("deletes the unwanted contact after an undo, and the merge records with it", async () => {
    // Case B from the finding — the reachable one: after an undo both contacts are live, and deleting
    // the unwanted duplicate is the natural next step. It failed with a raw FK error.
    const survivor = await contact("Keep");
    const dupe = await contact("Dupe");
    const mergeId = await merge(survivor, dupe);
    await undoMerge(db, mergeId, survivor, { canAssignRoles: true });
    await db.delete(performers).where(eq(performers.contactId, dupe)); // make it bare again

    expect(await refusal(() => deleteContact(db, dupe, { actor: survivor }))).toBeNull();

    expect(await exists(dupe)).toBe(false);
    expect(await exists(survivor)).toBe(true);
    expect(await db.select().from(mergeAudit).where(eq(mergeAudit.id, mergeId))).toHaveLength(0);
    expect(
      await db.select().from(mergeReversals).where(eq(mergeReversals.mergeAuditId, mergeId)),
    ).toHaveLength(0);
  });

  it("lets the survivor of an undone merge be deleted too", async () => {
    const survivor = await contact("Keep");
    const dupe = await contact("Dupe");
    const mergeId = await merge(survivor, dupe);
    await undoMerge(db, mergeId, survivor, { canAssignRoles: true });

    expect(await refusal(() => deleteContact(db, survivor, { actor: null }))).toBeNull();
    expect(await exists(survivor)).toBe(false);
    expect(await exists(dupe)).toBe(true);
  });
});

describe("deleting a survivor takes the contacts merged into it (077)", () => {
  it("refuses a SAFE delete of a survivor that has absorbed others, and says to undo first", async () => {
    // If a merge was a mistake the merged-in record may be a different person, and deleting the
    // survivor would delete them too. So the safe path refuses and names why.
    const survivor = await contact("Keep");
    const dupe = await contact("Dupe");
    await merge(survivor, dupe);
    await db.delete(performers).where(eq(performers.contactId, survivor)); // survivor otherwise bare

    const r = await refusal(() => deleteContact(db, survivor, { actor: null }));
    expect(r?.code).toBe("CONTACT_HAS_REFERENCES");
    expect(r?.detail).toContain("merged_contacts");
    expect(r?.message).toMatch(/merged into it/i);
    expect(r?.message).toMatch(/undo/i);
    expect(await exists(survivor)).toBe(true);
    expect(await exists(dupe)).toBe(true);
  });

  it("an UNRESTRICTED delete removes the whole chain merged into the survivor", async () => {
    const a = await contact("Emily");
    const b = await contact("Amy");
    const c = await contact("Jacob");
    await merge(b, a);
    await merge(c, b);

    expect(
      await refusal(() => deleteContact(db, c, { unrestricted: true, actor: null })),
    ).toBeNull();

    // Never SET NULL: a null merged_into_id is what marks a contact ACTIVE, so nulling it would have
    // resurrected Amy and Emily as live contacts instead of removing them.
    for (const id of [a, b, c]) expect(await exists(id)).toBe(false);
    expect(await db.select().from(mergeAudit)).toHaveLength(0);
  });
});

describe("anyone who has ever acted as staff is never deleted (077)", () => {
  it("refuses both the safe and the unrestricted delete, naming why and pointing to archive", async () => {
    const officer = await contact("Former Officer");
    const grantee = await contact("Someone They Appointed");
    await db.insert(roleGrants).values({ contactId: grantee, role: "booker", grantedBy: officer });

    for (const unrestricted of [false, true]) {
      const r = await refusal(() => deleteContact(db, officer, { unrestricted, actor: null }));
      expect(r, `unrestricted=${unrestricted} deleted a staff actor`).not.toBeNull();
      // A clean refusal, not the raw foreign-key error it used to be.
      expect(r?.code).toBe("CONTACT_HAS_REFERENCES");
      expect(r?.detail).toContain("staff_history");
      expect(r?.message).toMatch(/archive/i);
      expect(await exists(officer)).toBe(true);
    }
  });

  it("refuses to delete a survivor whose merged-in contact once acted as staff", async () => {
    // Peggy Dempsey (mailing list manager) merged into Peggy CDR: deleting Peggy CDR would take Peggy
    // Dempsey with it, and she acted as staff. Checking only the target would let the cascade reach
    // her and fail on the database's refusal — the raw error this feature exists to remove.
    const staffer = await contact("Peggy Dempsey");
    const grantee = await contact("Appointee");
    await db.insert(roleGrants).values({ contactId: grantee, role: "booker", grantedBy: staffer });
    const survivor = await contact("Peggy CDR");
    await merge(survivor, staffer);

    const r = await refusal(() => deleteContact(db, survivor, { unrestricted: true, actor: null }));
    expect(r?.code, "the cascade reached a staff actor and failed raw").toBe(
      "CONTACT_HAS_REFERENCES",
    );
    expect(r?.detail).toContain("staff_history");
    expect(await exists(survivor)).toBe(true);
    expect(await exists(staffer)).toBe(true);
  });
});

describe("a delete is one transaction (077)", () => {
  it("leaves nothing half-deleted when it fails part-way", async () => {
    // Case C from the finding: the unrestricted path deleted the membership account, then failed. Here
    // the failure is forced after the account delete by an actor that is not a contact, so its audit
    // write violates the foreign key — no mocks, the real database refuses.
    const payer = await contact("Payer");
    await makeMembershipAccount({ payerContactId: payer, expiryDate: "2099-01-01" });
    const notAContact = "00000000-0000-0000-0000-000000000077";

    const r = await refusal(() =>
      deleteContact(db, payer, { unrestricted: true, actor: notAContact }),
    );
    expect(r, "the delete should have failed on the audit write").not.toBeNull();

    expect(await exists(payer)).toBe(true);
    expect(
      await db
        .select()
        .from(membershipAccounts)
        .where(eq(membershipAccounts.payerContactId, payer)),
      "the membership account was deleted by a delete that did not complete",
    ).toHaveLength(1);
  });
});

/**
 * The guard that stops this recurring. Every foreign key into `contacts` whose rule REFUSES a delete must
 * be known to the delete check — otherwise a delete of a contact it names fails with a raw error, which is
 * exactly how `merge_audit` went unnoticed from feature 003 to feature 074. Read from the database, not a
 * second list, the same way 072's reference-classification guard works.
 */
describe("every delete-blocking reference is known to the delete check (077)", () => {
  type Fk = { table_name: string; column_name: string };

  it("names each blocking foreign key in CONTACT_DELETE_BLOCKERS", async () => {
    const blocking = [
      ...(await db.execute<Fk>(sql`
        SELECT co.conrelid::regclass::text AS table_name, a.attname AS column_name
          FROM pg_constraint co
          JOIN unnest(co.conkey) k(attnum) ON true
          JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = k.attnum
         WHERE co.contype = 'f' AND co.confrelid = 'contacts'::regclass
           AND co.confdeltype IN ('a', 'r')
      `)),
    ].map((r) => `${r.table_name}.${r.column_name}`);

    const known = CONTACT_DELETE_BLOCKERS.map((b) => `${getTableName(b.table)}.${b.column.name}`);
    const unknown = blocking.filter((k) => !known.includes(k));
    expect(
      unknown,
      `blocking reference(s) the delete check does not know: ${unknown.join(", ")}`,
    ).toEqual([]);

    // And the one the UNRESTRICTED path clears instead of refusing is named, so adding another blocking
    // reference forces a decision about it rather than a silent raw error on the force path.
    const forceCleared = CONTACT_DELETE_BLOCKERS.filter((b) => !("always" in b && b.always))
      .map((b) => `${getTableName(b.table)}.${b.column.name}`)
      .filter((k) => blocking.includes(k));
    expect(forceCleared).toEqual(["membership_accounts.payer_contact_id"]);
  });

  it("reports nothing blocking a merged-away contact, since its merge history now goes with it", async () => {
    // A regression guard rather than a driver: it passed before 077 too, because the check never knew about
    // merge history. It pins that merge history must not become a blocker again.
    const survivor = await contact("Keep");
    const dupe = await contact("Dupe");
    await merge(survivor, dupe);
    expect(await contactDeleteBlockers(db, dupe)).toEqual([]);
  });
});
