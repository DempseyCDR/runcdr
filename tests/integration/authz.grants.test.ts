import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb } from "./helpers/db";
import { db } from "@/server/db/client";
import { auditEvents, contacts, roleGrants, series } from "@/server/db/schema";
import { jsonReqAs, ctx } from "./helpers/http";
import { makeActor, makeContactWithEmail, makeVolunteerContact } from "./helpers/factories";
import { bootstrapOfficer } from "@/server/db/bootstrapOfficer";
import {
  approveVolunteer,
  clearVolunteer,
  designateVolunteer,
  grantRole,
  grantsForContact,
  listVolunteers,
  revokeRole,
} from "@/server/domain/access/grantService";
import { POST as GRANT } from "@/app/api/access/grants/route";
import { POST as DESIGNATE } from "@/app/api/access/volunteers/route";

/**
 * US2 — the President/VP assign volunteers and roles.
 *
 * These exercise the grant SERVICE directly (the API routes and screen sit on top). The service is
 * where FR-005a exclusivity and FR-028b's cascade live, because assigning authority is a business rule,
 * not a wrapper concern.
 */

async function seriesId(key: string): Promise<string> {
  const row = await db.query.series.findFirst({ where: eq(series.key, key) });
  if (!row) throw new Error(`series ${key} not seeded`);
  return row.id;
}

async function aVolunteer(email: string): Promise<string> {
  const { contactId } = await makeVolunteerContact({ email });
  return contactId;
}

describe("US2: assignment", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  describe("grant / revoke (FR-029, SC-007)", () => {
    it("grants a scoped role and records it in the audit trail", async () => {
      const subject = await aVolunteer("grantee@cdrochester.org");
      const { grant } = await grantRole(db, {
        subjectContactId: subject,
        role: "booker",
        seriesKey: "ecd",
        grantedBy: null,
      });

      expect(grant.role).toBe("booker");
      expect(grant.seriesId).toBe(await seriesId("ecd"));
      const [audit] = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.kind, "authz.grant.created"));
      expect(audit?.details).toMatchObject({ subject, role: "booker" });
    });

    it("is idempotent — re-granting the same scope does not duplicate", async () => {
      const subject = await aVolunteer("dup@cdrochester.org");
      await grantRole(db, {
        subjectContactId: subject,
        role: "booker",
        seriesKey: "ecd",
        grantedBy: null,
      });
      await grantRole(db, {
        subjectContactId: subject,
        role: "booker",
        seriesKey: "ecd",
        grantedBy: null,
      });
      const held = await grantsForContact(db, subject);
      expect(held).toHaveLength(1);
    });

    it("refuses to grant a role to a NON-volunteer (R3)", async () => {
      const { contactId } = await makeVolunteerContact({
        email: "notvol@x.com",
        isVolunteer: false,
      });
      await expect(
        grantRole(db, {
          subjectContactId: contactId,
          role: "booker",
          seriesKey: "ecd",
          grantedBy: null,
        }),
      ).rejects.toThrow(/volunteer/i);
    });

    it("refuses to grant super_user from the service (FR-030a)", async () => {
      const subject = await aVolunteer("wannabe@cdrochester.org");
      await expect(
        grantRole(db, { subjectContactId: subject, role: "super_user", grantedBy: null }),
      ).rejects.toThrow(/CLI/i);
    });

    it("revokes a grant and audits it", async () => {
      const subject = await aVolunteer("revokee@cdrochester.org");
      const { grant } = await grantRole(db, {
        subjectContactId: subject,
        role: "booker",
        seriesKey: "ecd",
        grantedBy: null,
      });
      await revokeRole(db, grant.id, null);
      expect(await grantsForContact(db, subject)).toHaveLength(0);
      const [audit] = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.kind, "authz.grant.revoked"));
      expect(audit).toBeDefined();
    });
  });

  describe("FR-005a: President / VP / Treasurer are mutually exclusive", () => {
    it("refuses VP to a sitting Treasurer", async () => {
      const subject = await aVolunteer("officer@cdrochester.org");
      await grantRole(db, { subjectContactId: subject, role: "treasurer", grantedBy: null });
      await expect(
        grantRole(db, { subjectContactId: subject, role: "vice_president", grantedBy: null }),
      ).rejects.toThrow(/mutually exclusive|already holds/i);
    });

    it("allows the SECRETARY alongside any of the three (FR-005b — the tell)", async () => {
      const subject = await aVolunteer("sec@cdrochester.org");
      await grantRole(db, { subjectContactId: subject, role: "treasurer", grantedBy: null });
      const { grant } = await grantRole(db, {
        subjectContactId: subject,
        role: "secretary",
        grantedBy: null,
      });
      expect(grant.role).toBe("secretary"); // the rule is authority-vs-money, not "one office"
    });
  });

  describe("FR-005c: no role uniqueness", () => {
    it("lets TWO people both hold President", async () => {
      const a = await aVolunteer("pres1@cdrochester.org");
      const b = await aVolunteer("pres2@cdrochester.org");
      await grantRole(db, { subjectContactId: a, role: "president", grantedBy: null });
      const { grant } = await grantRole(db, {
        subjectContactId: b,
        role: "president",
        grantedBy: null,
      });
      expect(grant.role).toBe("president");
      const all = await db.select().from(roleGrants).where(eq(roleGrants.role, "president"));
      expect(all).toHaveLength(2);
    });
  });

  describe("FR-029a/b: President-as-FS is permitted, warned, surfaced", () => {
    it("grants FS to a sitting President — with a warning, not a refusal", async () => {
      const subject = await aVolunteer("pres.fs@cdrochester.org");
      await grantRole(db, { subjectContactId: subject, role: "president", grantedBy: null });
      const { grant, warning } = await grantRole(db, {
        subjectContactId: subject,
        role: "financial_secretary",
        seriesKey: "tnc",
        grantedBy: null,
      });
      expect(grant.role).toBe("financial_secretary");
      expect(warning).toMatch(/concentrat/i);
    });

    it("surfaces the concentration on the volunteer list (FR-036)", async () => {
      const subject = await aVolunteer("pres.fs2@cdrochester.org");
      await grantRole(db, { subjectContactId: subject, role: "president", grantedBy: null });
      await grantRole(db, {
        subjectContactId: subject,
        role: "financial_secretary",
        seriesKey: "tnc",
        grantedBy: null,
      });
      const list = await listVolunteers(db);
      const row = list.find((v) => v.contactId === subject);
      expect(row?.concentrationOfDuties).toBe(true);
    });
  });

  describe("FR-028: clear-and-cascade", () => {
    it("clearing a volunteer with 3 grants revokes ALL of them and ends access", async () => {
      const subject = await aVolunteer("leaver@cdrochester.org");
      await grantRole(db, {
        subjectContactId: subject,
        role: "booker",
        seriesKey: "ecd",
        grantedBy: null,
      });
      await grantRole(db, {
        subjectContactId: subject,
        role: "booker",
        seriesKey: "tnc",
        grantedBy: null,
      });
      await grantRole(db, { subjectContactId: subject, role: "secretary", grantedBy: null });

      // Report-then-confirm (FR-028a): the UI reads this list before clearing.
      expect(await grantsForContact(db, subject)).toHaveLength(3);

      const revoked = await clearVolunteer(db, subject, null);
      expect(revoked).toHaveLength(3);
      expect(await grantsForContact(db, subject)).toHaveLength(0);
      const [c] = await db.select().from(contacts).where(eq(contacts.id, subject));
      expect(c?.isVolunteer).toBe(false);
    });

    it("a re-designated volunteer holds ZERO grants — nothing silently restored (FR-028b)", async () => {
      const subject = await aVolunteer("returner@cdrochester.org");
      await grantRole(db, {
        subjectContactId: subject,
        role: "booker",
        seriesKey: "ecd",
        grantedBy: null,
      });
      await clearVolunteer(db, subject, null);

      await designateVolunteer(db, subject, null);
      expect(await grantsForContact(db, subject)).toHaveLength(0);
    });
  });

  describe("designate a volunteer — the /access route path (FR-028)", () => {
    it("the President designates a non-volunteer contact through the API", async () => {
      const { token } = await makeActor({
        email: "prez.des@cdrochester.org",
        grants: [{ role: "president" }],
      });
      const { contactId } = await makeContactWithEmail({
        email: "fresh.recruit@cdrochester.org",
      });

      const res = await DESIGNATE(
        jsonReqAs(token, "POST", "/api/access/volunteers", { contactId }),
        ctx(),
      );
      expect(res.status).toBe(201);
      const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
      expect(c?.isVolunteer).toBe(true);
      // Nomination only — no grants conferred.
      expect(await grantsForContact(db, contactId)).toHaveLength(0);
    });

    it("a volunteer without role.assign is refused the designate route", async () => {
      const { token } = await makeActor({
        email: "fs.des@cdrochester.org",
        grants: [{ role: "financial_secretary", seriesId: await seriesId("tnc") }],
      });
      const { contactId } = await makeContactWithEmail({ email: "recruit2@cdrochester.org" });

      const res = await DESIGNATE(
        jsonReqAs(token, "POST", "/api/access/volunteers", { contactId }),
        ctx(),
      );
      // Refused on THIS path (role.assign). Note: the same flag is separately writable via the contact
      // editor under contact.write — a deliberate second path (designation is a low-stakes nomination).
      expect(res.status).toBe(403);
      expect((await res.json()).error.message).toContain("role.assign");
    });
  });

  describe("who may assign — the API path (FR-030, SC-007)", () => {
    it("the President grants through the API", async () => {
      const { token } = await makeActor({
        email: "prez@cdrochester.org",
        grants: [{ role: "president" }],
      });
      const subject = await aVolunteer("grantee.api@cdrochester.org");
      const res = await GRANT(
        jsonReqAs(token, "POST", "/api/access/grants", {
          subjectContactId: subject,
          role: "booker",
          seriesKey: "ecd",
        }),
        ctx(),
      );
      expect(res.status).toBe(201);
    });

    it("the VP grants too (VP ⊇ President)", async () => {
      const { token } = await makeActor({
        email: "veep@cdrochester.org",
        grants: [{ role: "vice_president" }],
      });
      const subject = await aVolunteer("grantee.vp@cdrochester.org");
      const res = await GRANT(
        jsonReqAs(token, "POST", "/api/access/grants", {
          subjectContactId: subject,
          role: "booker",
          seriesKey: "ecd",
        }),
        ctx(),
      );
      expect(res.status).toBe(201);
    });

    it("the TREASURER is refused — assignment is President + VP only", async () => {
      const { token } = await makeActor({
        email: "treas.assign@cdrochester.org",
        grants: [{ role: "treasurer" }],
      });
      const subject = await aVolunteer("grantee.no@cdrochester.org");
      const res = await GRANT(
        jsonReqAs(token, "POST", "/api/access/grants", {
          subjectContactId: subject,
          role: "financial_secretary",
          seriesKey: "tnc",
        }),
        ctx(),
      );
      expect(res.status).toBe(403);
      expect((await res.json()).error.message).toContain("role.assign");
    });

    it("returns the FS-concentration WARNING in the body (FR-029a), not an error", async () => {
      const { token } = await makeActor({
        email: "prez2@cdrochester.org",
        grants: [{ role: "president" }],
      });
      const subject = await aVolunteer("dualrole@cdrochester.org");
      await grantRole(db, { subjectContactId: subject, role: "president", grantedBy: null });
      const res = await GRANT(
        jsonReqAs(token, "POST", "/api/access/grants", {
          subjectContactId: subject,
          role: "financial_secretary",
          seriesKey: "tnc",
        }),
        ctx(),
      );
      expect(res.status).toBe(201);
      expect((await res.json()).warning).toMatch(/concentrat/i);
    });

    it("takes effect on the grantee's NEXT request", async () => {
      const { token: prez } = await makeActor({
        email: "prez3@cdrochester.org",
        grants: [{ role: "president" }],
      });
      const { contactId, token: grantee } = await makeActor({ email: "fresh@cdrochester.org" });
      // Grantee starts with only the base — refused an event write.
      const { POST: CREATE_EVENT } = await import("@/app/api/events/route");
      const before = await CREATE_EVENT(
        jsonReqAs(grantee, "POST", "/api/events", { seriesKey: "ecd", eventDate: "2026-09-06" }),
        ctx(),
      );
      expect(before.status).toBe(403);

      await GRANT(
        jsonReqAs(prez, "POST", "/api/access/grants", {
          subjectContactId: contactId,
          role: "booker",
          seriesKey: "ecd",
        }),
        ctx(),
      );

      // No cache: the grant is live on the next request (FR-014).
      const after = await CREATE_EVENT(
        jsonReqAs(grantee, "POST", "/api/events", { seriesKey: "ecd", eventDate: "2026-09-13" }),
        ctx(),
      );
      expect(after.status).toBe(201);
    });
  });

  describe("FR-005a holds on the CLI too (FR-033)", () => {
    it("bootstrapOfficer refuses a conflicting exclusive role", async () => {
      const { contactId } = await makeVolunteerContact({ email: "cli.officer@cdrochester.org" });
      await grantRole(db, { subjectContactId: contactId, role: "treasurer", grantedBy: null });
      // The CLI resolves --email → this contact, then tries to grant president: same exclusivity gate.
      await expect(
        bootstrapOfficer({ email: "cli.officer@cdrochester.org", role: "president" }),
      ).rejects.toThrow(/mutually exclusive|already holds/i);
    });
  });

  describe("FR-034-037: annual approval is advisory", () => {
    it("a never-approved volunteer is overdue; approving clears it and records who", async () => {
      const approver = await aVolunteer("prez@cdrochester.org");
      const subject = await aVolunteer("member@cdrochester.org");

      let row = (await listVolunteers(db)).find((v) => v.contactId === subject);
      expect(row?.overdue).toBe(true); // approvedAt is null

      await approveVolunteer(db, subject, approver);
      row = (await listVolunteers(db)).find((v) => v.contactId === subject);
      expect(row?.overdue).toBe(false);
      const [c] = await db.select().from(contacts).where(eq(contacts.id, subject));
      expect(c?.volunteerApprovedBy).toBe(approver);
    });

    it("an approval older than a year reads as overdue", async () => {
      const subject = await aVolunteer("stale@cdrochester.org");
      await db
        .update(contacts)
        .set({ volunteerApprovedAt: new Date("2024-01-01") })
        .where(eq(contacts.id, subject));
      const row = (await listVolunteers(db)).find((v) => v.contactId === subject);
      expect(row?.overdue).toBe(true);
    });
  });

  /**
   * Feature 076 (close-out §2b). The access page listed every contact with `is_volunteer = true`, with no
   * merged or archived filter — so a contact merged away still appeared as a volunteer, showing no roles
   * because its grants had moved to the survivor. Found walking feature 074's manual pass.
   */
  describe("the volunteer list shows only active contacts (076)", () => {
    it("omits a volunteer who has been merged away", async () => {
      const kept = await aVolunteer("kept@cdrochester.org");
      const retired = await aVolunteer("retired@cdrochester.org");
      await db.update(contacts).set({ mergedIntoId: kept }).where(eq(contacts.id, retired));

      const ids = (await listVolunteers(db)).map((v) => v.contactId);
      expect(ids).toContain(kept);
      expect(ids, "a merged-away contact is still listed as a volunteer").not.toContain(retired);
    });

    it("omits a volunteer whose contact has been archived", async () => {
      const kept = await aVolunteer("kept2@cdrochester.org");
      const archived = await aVolunteer("archived@cdrochester.org");
      await db.update(contacts).set({ archivedAt: new Date() }).where(eq(contacts.id, archived));

      const ids = (await listVolunteers(db)).map((v) => v.contactId);
      expect(ids).toContain(kept);
      expect(ids, "an archived contact is still listed as a volunteer").not.toContain(archived);
    });
  });
});
