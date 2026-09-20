import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import {
  contacts,
  membershipMembers,
  roleGrants,
  performers,
  auditEvents,
} from "@/server/db/schema";
import { contactRow, makeContactWithEmail, makeMembershipAccount } from "./helpers/factories";
import { makeActor } from "./helpers/factories";
import { jsonReq, jsonReqAs, ctx } from "./helpers/http";
import { CONTACT_DELETE_BLOCKERS } from "@/server/domain/contacts/contactService";
import { DELETE as DELETE_CONTACT } from "@/app/api/contacts/[id]/route";
import { GET as CAPABILITIES } from "@/app/api/me/capabilities/route";

// File-level DB lifecycle (single closeDb for the shared pool).
beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

async function seedContact(name: string): Promise<string> {
  const [row] = await db.insert(contacts).values(contactRow(name)).returning();
  return row!.id;
}

// Feature 065 (M-R11/M-R12): the bare-record delete guard, its authz, audit, and the super-user override.
describe("contact delete (feature 065)", () => {
  it("safe delete removes a BARE contact (C4)", async () => {
    const id = await seedContact("Bare One");
    const mlm = await makeActor({
      email: "mlm@example.com",
      grants: [{ role: "mailing_list_manager" }],
    });
    const res = await DELETE_CONTACT(
      jsonReqAs(mlm.token, "DELETE", `/api/contacts/${id}`),
      ctx({ id }),
    );
    expect(res.status).toBe(200);
    expect(await db.query.contacts.findFirst({ where: eq(contacts.id, id) })).toBeUndefined();
  });

  it("safe delete is REFUSED for a cascade-class reference — role_grant (C5)", async () => {
    const id = await seedContact("Granted One");
    await db.insert(roleGrants).values({ contactId: id, role: "door_attendant" });
    const mlm = await makeActor({
      email: "mlm2@example.com",
      grants: [{ role: "mailing_list_manager" }],
    });
    const res = await DELETE_CONTACT(
      jsonReqAs(mlm.token, "DELETE", `/api/contacts/${id}`),
      ctx({ id }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CONTACT_HAS_REFERENCES");
    expect(await db.query.contacts.findFirst({ where: eq(contacts.id, id) })).toBeTruthy();
  });

  it("safe delete is REFUSED for a set-null-class reference — performer (C5)", async () => {
    const id = await seedContact("Player One");
    await db.insert(performers).values({ displayName: "Player One", contactId: id });
    const mlm = await makeActor({
      email: "mlm3@example.com",
      grants: [{ role: "mailing_list_manager" }],
    });
    const res = await DELETE_CONTACT(
      jsonReqAs(mlm.token, "DELETE", `/api/contacts/${id}`),
      ctx({ id }),
    );
    expect(res.status).toBe(409);
    expect(await db.query.contacts.findFirst({ where: eq(contacts.id, id) })).toBeTruthy();
  });

  it("an actor without contact.delete is refused (C7)", async () => {
    const id = await seedContact("No Auth");
    const base = await makeActor({ email: "base@example.com" }); // no grants
    const res = await DELETE_CONTACT(
      jsonReqAs(base.token, "DELETE", `/api/contacts/${id}`),
      ctx({ id }),
    );
    expect(res.status).toBe(403);
    expect(await db.query.contacts.findFirst({ where: eq(contacts.id, id) })).toBeTruthy();
  });

  it("a successful delete writes a contact.deleted audit event (C8)", async () => {
    const id = await seedContact("Audited One");
    const mlm = await makeActor({
      email: "mlm4@example.com",
      grants: [{ role: "mailing_list_manager" }],
    });
    await DELETE_CONTACT(jsonReqAs(mlm.token, "DELETE", `/api/contacts/${id}`), ctx({ id }));
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.kind, "contact.deleted"));
    expect(rows.length).toBe(1);
  });

  it("/api/me/capabilities reports the delete flags per grants (C9)", async () => {
    const mlm = await makeActor({
      email: "mlm5@example.com",
      grants: [{ role: "mailing_list_manager" }],
    });
    const base = await makeActor({ email: "base2@example.com" });
    const mlmCaps = await (
      await CAPABILITIES(jsonReqAs(mlm.token, "GET", "/api/me/capabilities"), ctx())
    ).json();
    const baseCaps = await (
      await CAPABILITIES(jsonReqAs(base.token, "GET", "/api/me/capabilities"), ctx())
    ).json();
    expect(mlmCaps.contactDelete).toBe(true);
    expect(mlmCaps.contactDeleteUnrestricted).toBe(false);
    expect(baseCaps.contactDelete).toBe(false);
  });

  it("the guard checks exactly the enumerated categories (list-parity, C15)", () => {
    // Unique categories: one category may span several columns (staff_history covers nine actor references).
    expect([...new Set(CONTACT_DELETE_BLOCKERS.map((b) => b.category))].sort()).toEqual(
      [
        "attendance",
        // Feature 082: a check's writer — NOT NULL, and the books credit the check to them.
        "check_writer",
        "gate_sale",
        "membership",
        "membership_account",
        "membership_capture",
        // Feature 077: a survivor's merged-in contacts, and any record of having acted as staff.
        "merged_contacts",
        "officer",
        "performer",
        "role_grant",
        "staff_history",
        "staff_identity",
        "venue_landlord",
      ].sort(),
    );
  });

  /**
   * Feature 070. The `membership` blocker pointed at the RETIRED `memberships` table, which nothing has
   * written since 068's cutover — so a household MEMBER (as opposed to the payer, covered separately)
   * stopped being protected. `membership_members.contact_id` CASCADES, so a safe delete would have
   * quietly detached them from the household instead of refusing.
   */
  it("refuses to delete a household MEMBER, not just the payer (C15)", async () => {
    const payer = await seedContact("Kristin Ward");
    const member = await seedContact("Christopher Scott");
    const { accountId } = await makeMembershipAccount({
      payerContactId: payer,
      level: "family",
      expiryDate: "2099-08-31",
      members: [member],
    });

    const mlm = await makeActor({
      email: "mlm-member@example.com",
      grants: [{ role: "mailing_list_manager" }],
    });
    const res = await DELETE_CONTACT(
      jsonReqAs(mlm.token, "DELETE", `/api/contacts/${member}`),
      ctx({ id: member }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.detail).toContain("membership");

    // And they are still on the account — the refusal changed nothing.
    const rows = await db
      .select()
      .from(membershipMembers)
      .where(eq(membershipMembers.accountId, accountId));
    expect(rows.map((r) => r.contactId)).toContain(member);
  });

  it("UNRESTRICTED (super-user, ?force=1) deletes a referenced contact (C6)", async () => {
    const id = await seedContact("Purge Me");
    await db.insert(roleGrants).values({ contactId: id, role: "door_attendant" });
    // The standing test session is a club-wide super_user → holds contact.delete.unrestricted.
    const res = await DELETE_CONTACT(jsonReq("DELETE", `/api/contacts/${id}?force=1`), ctx({ id }));
    expect(res.status).toBe(200);
    expect(await db.query.contacts.findFirst({ where: eq(contacts.id, id) })).toBeUndefined();
  });

  it("?force=1 without contact.delete.unrestricted is refused (C7)", async () => {
    const id = await seedContact("No Force");
    await db.insert(roleGrants).values({ contactId: id, role: "door_attendant" });
    const mlm = await makeActor({
      email: "mlm6@example.com",
      grants: [{ role: "mailing_list_manager" }],
    });
    const res = await DELETE_CONTACT(
      jsonReqAs(mlm.token, "DELETE", `/api/contacts/${id}?force=1`),
      ctx({ id }),
    );
    expect(res.status).toBe(403);
    expect(await db.query.contacts.findFirst({ where: eq(contacts.id, id) })).toBeTruthy();
  });

  // Feature 067 follow-up: the categories are DB slugs (`gate_sale`, `staff_identity`, `shared_email`).
  // Mel reads this message, so it must name the references in her language.
  it("names the blocking references in human wording, not table slugs", async () => {
    const { contactId } = await makeContactWithEmail({
      firstName: "Perf",
      lastName: "Ormer",
      email: "perf@example.com",
    });
    await db.insert(performers).values({ displayName: "Perf Ormer", contactId });

    const res = await DELETE_CONTACT(
      jsonReq("DELETE", `/api/contacts/${contactId}`),
      ctx({ id: contactId }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONTACT_HAS_REFERENCES");
    expect(body.error.message).toMatch(/performer record/i);
    expect(body.error.message).not.toMatch(/\bgate_sale\b|\bstaff_identity\b/);
  });
});
