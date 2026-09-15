import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeContactWithEmail, makeEvent } from "./helpers/factories";
import { attendance, auditEvents, contactEmails, contacts, doorRecords } from "@/server/db/schema";
import { recordAttendance } from "@/server/domain/attendance/attendanceService";
import { POST as ATTEND } from "@/app/api/events/[id]/attendance/route";

// FR-003
describe("POST /api/events/:id/attendance (new contact)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("creates a contact flagged needs_review and records attendance", async () => {
    const evt = await makeEvent();
    const res = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, {
        newContact: { firstName: "Walk In", email: "walkin@example.com" },
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(201);
    const att = await res.json();

    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, att.contactId) });
    expect(contact?.needsReview).toBe(true);
    expect(contact?.source).toBe("door");
  });

  it("accepts a phone number in place of an email", async () => {
    const evt = await makeEvent();
    const res = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, {
        newContact: { firstName: "Phone Walk In", phone: "585-555-0101" },
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(201);
    const att = await res.json();

    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, att.contactId) });
    expect(contact?.phone).toBe("+15855550101"); // feature 032: stored canonical
  });

  it("accepts neither email nor phone (declined) without a 422", async () => {
    const evt = await makeEvent();
    const res = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, {
        newContact: { firstName: "Declined Contact Info" },
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(201);
  });

  // Feature 017 (B34): first + last name and an editable display name at the door.
  it("persists first and last name, deriving display_name = 'first last'", async () => {
    const evt = await makeEvent();
    const res = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, {
        newContact: { firstName: "Jane", lastName: "Smith" },
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(201);
    const att = await res.json();

    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, att.contactId) });
    expect(contact?.firstName).toBe("Jane");
    expect(contact?.lastName).toBe("Smith");
    expect(contact?.displayNameOverride).toBeNull();
    expect(contact?.displayName).toBe("Jane Smith");
  });

  // Feature 042 (P6-R10): the new-contact path can record a gift-card redemption (counts-only), independent of
  // comp. The backend already accepts redeemedGiftCard on the newContact variant — these lock SC-002/SC-003.
  it("records a gift-card redemption for a new contact (count +1)", async () => {
    const evt = await makeEvent();
    const res = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, {
        newContact: { firstName: "Gift", lastName: "Newcomer" },
        redeemedGiftCard: true,
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(201);
    const dr = await db.query.doorRecords.findFirst({ where: eq(doorRecords.eventId, evt.id) });
    expect(dr?.giftCardRedemptionCount).toBe(1);
    expect(dr?.compCount).toBe(0);
  });

  it("records comp and gift-card together for a new contact (both counts +1)", async () => {
    const evt = await makeEvent();
    const res = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, {
        newContact: { firstName: "Both", lastName: "Newcomer" },
        isComp: true,
        redeemedGiftCard: true,
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(201);
    const dr = await db.query.doorRecords.findFirst({ where: eq(doorRecords.eventId, evt.id) });
    expect(dr?.compCount).toBe(1);
    expect(dr?.giftCardRedemptionCount).toBe(1);
  });

  it("persists an edited display name as the override, keeping first/last separate", async () => {
    const evt = await makeEvent();
    const res = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, {
        newContact: { firstName: "Jane", lastName: "Smith", displayNameOverride: "DJ Jane" },
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(201);
    const att = await res.json();

    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, att.contactId) });
    expect(contact?.firstName).toBe("Jane");
    expect(contact?.lastName).toBe("Smith");
    expect(contact?.displayNameOverride).toBe("DJ Jane");
    expect(contact?.displayName).toBe("DJ Jane");
  });

  /**
   * Feature 079, User Story 2 (FR-016, FR-017, SC-003; research R6). An email entered at the door that already
   * belongs to someone else used to be dropped silently: the contact was created without it and Meg was told
   * nothing. Now nothing is created until she says whether it is that person, someone sharing the address, or
   * a mistake.
   */
  describe("an email that already belongs to someone else (079)", () => {
    const attend = (eventId: string, body: unknown) =>
      ATTEND(jsonReq("POST", `/api/events/${eventId}/attendance`, body), ctx({ id: eventId }));
    const counts = async () => ({
      contacts: (await db.select().from(contacts)).length,
      attendance: (await db.select().from(attendance)).length,
    });

    it("refuses an address active on another contact, naming them, and creates nothing", async () => {
      const evt = await makeEvent();
      const owner = await makeContactWithEmail({
        firstName: "Ann",
        lastName: "Jones",
        email: "jones@example.com",
      });
      const before = await counts();

      const res = await attend(evt.id, {
        newContact: { firstName: "Sam", lastName: "Jones", email: "Jones@Example.com" },
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("EMAIL_ACTIVE_ELSEWHERE");
      expect(body.error.other).toEqual({
        contactId: owner.contactId,
        displayName: "Ann Jones",
        emailId: owner.emailId,
      });
      expect(await counts(), "a refused walk-in left a contact or a check-in behind").toEqual(
        before,
      );
    });

    it("treats an address in transition the same way", async () => {
      const evt = await makeEvent();
      await makeContactWithEmail({
        firstName: "Ann",
        lastName: "Jones",
        email: "jones@example.com",
        emailStatus: "transition",
      });
      const res = await attend(evt.id, {
        newContact: { firstName: "Sam", email: "jones@example.com" },
      });
      expect(res.status).toBe(409);
    });

    it("lets a new contact own an address that is inactive elsewhere", async () => {
      const evt = await makeEvent();
      await makeContactWithEmail({
        firstName: "Ann",
        email: "old@example.com",
        emailStatus: "inactive",
      });
      const res = await attend(evt.id, {
        newContact: { firstName: "Sam", email: "old@example.com" },
      });
      expect(res.status).toBe(201);
      const { contactId } = await res.json();
      const owned = await db
        .select()
        .from(contactEmails)
        .where(eq(contactEmails.contactId, contactId));
      expect(owned.map((e) => e.email)).toEqual(["old@example.com"]);
    });

    it("with shareEmail, creates the contact reached through the address it does not own, and checks it in", async () => {
      const evt = await makeEvent();
      const owner = await makeContactWithEmail({
        firstName: "Ann",
        lastName: "Jones",
        email: "jones@example.com",
      });
      const res = await attend(evt.id, {
        newContact: {
          firstName: "Sam",
          lastName: "Jones",
          email: "jones@example.com",
          shareEmail: true,
        },
        childrenCount: 1,
      });
      expect(res.status).toBe(201);
      const { contactId } = await res.json();

      const sam = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
      expect(sam).toMatchObject({ messageRecipientEmailId: owner.emailId, needsReview: true });
      const owned = await db
        .select()
        .from(contactEmails)
        .where(eq(contactEmails.contactId, contactId));
      expect(owned, "the rider must not own the shared address").toEqual([]);
      expect(
        owned.some((e) => e.isLogin),
        "a shared address can never be the rider's sign-in",
      ).toBe(false);
      const shared = await db.query.contactEmails.findFirst({
        where: eq(contactEmails.id, owner.emailId),
      });
      expect(shared).toMatchObject({ contactId: owner.contactId, isLogin: false });

      const checkIns = await db
        .select()
        .from(attendance)
        .where(eq(attendance.contactId, contactId));
      expect(checkIns).toHaveLength(1);
      const linked = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.kind, "contact.reference.linked"));
      expect(linked.map((a) => a.details)).toContainEqual(
        expect.objectContaining({ contactId, emailId: owner.emailId }),
      );
    });

    it("leaves nothing behind when a shared-address check-in is refused", async () => {
      const evt = await makeEvent({ seriesKey: "tnc" });
      await makeContactWithEmail({ firstName: "Ann", email: "jones@example.com" });
      const before = await counts();
      await expect(
        recordAttendance(db, evt.id, {
          newContact: { firstName: "Sam", email: "jones@example.com", shareEmail: true },
          isOpenBand: true, // refused: open band only at a community dance
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await counts()).toEqual(before);
    });

    it("never creates the contact and silently drops its email", async () => {
      const evt = await makeEvent();
      await makeContactWithEmail({ firstName: "Ann", email: "jones@example.com" });
      await attend(evt.id, { newContact: { firstName: "Sam", email: "jones@example.com" } });
      const sams = await db.select().from(contacts).where(eq(contacts.firstName, "Sam"));
      expect(sams, "a contact was created without the email it was given").toEqual([]);
    });
  });
});
