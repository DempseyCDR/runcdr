import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { contactRow } from "./helpers/factories";
import { contactEmails, contacts, performers } from "@/server/db/schema";
import { createPerformer } from "@/server/domain/performers/performerService";
import { jsonReq, ctx } from "./helpers/http";
import { PATCH as PATCH_PERFORMER } from "@/app/api/performers/[id]/route";
import { POST as CREATE_CONTACT } from "@/app/api/contacts/route";
import { linkSuggestions } from "@/server/domain/performers/linkSuggestions";

// Hooks at FILE level: a second describe with its own `afterAll(closeDb)` closes the pool before the
// other block runs (the CONNECTION_ENDED trap from feature 082).
beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

// FR-015: every performer has a contact so the door can check them in.
describe("performer → contact", () => {
  it("auto-creates a contact when none is linked", async () => {
    const p = await createPerformer(db, { firstName: "Fiona", lastName: "Fiddle" });
    expect(p.contactId).toBeTruthy();
    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, p.contactId!) });
    expect(contact?.displayName).toBe("Fiona Fiddle");
    expect(contact?.source).toBe("performer");
  });

  it("flags the auto-created contact for review when no email or phone is given", async () => {
    const p = await createPerformer(db, { firstName: "No", lastName: "Info" });
    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, p.contactId!) });
    expect(contact?.needsReview).toBe(true);
  });

  it("seeds the auto-created contact's phone and does not flag it for review", async () => {
    const p = await createPerformer(db, {
      firstName: "Phone",
      lastName: "Fiddle",
      phone: "585-555-0102",
    });
    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, p.contactId!) });
    expect(contact?.phone).toBe("+15855550102"); // feature 032: stored canonical
    expect(contact?.needsReview).toBe(false);
  });

  it("seeds the auto-created contact's email", async () => {
    const p = await createPerformer(db, {
      firstName: "Email",
      lastName: "Fiddle",
      email: "email-fiddle@example.com",
    });
    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, p.contactId!) });
    expect(contact?.needsReview).toBe(false);
    const emails = await db.query.contactEmails.findFirst({
      where: eq(contactEmails.contactId, p.contactId!),
    });
    expect(emails?.email).toBe("email-fiddle@example.com");
    expect(emails?.purposes).toContain("personal"); // default purpose
  });

  it("labels the seeded email 'booking' when emailPurpose is given (feature 020 add-performer)", async () => {
    const p = await createPerformer(db, {
      firstName: "Micah",
      lastName: "Wiesner",
      email: "micah@example.com",
      emailPurpose: "booking",
    });
    const email = await db.query.contactEmails.findFirst({
      where: eq(contactEmails.contactId, p.contactId!),
    });
    expect(email?.purposes).toContain("booking");
    expect(email?.purposes).not.toContain("personal");
  });

  it("reuses an existing contact when one is provided", async () => {
    const [existing] = await db.insert(contacts).values(contactRow("Existing")).returning();
    const p = await createPerformer(db, { contactId: existing!.id });
    expect(p.contactId).toBe(existing!.id);
    const all = await db.select().from(performers).where(eq(performers.id, p.id));
    expect(all).toHaveLength(1);
  });
});

// Feature 084 (FR-001, FR-028): a performer's fields are all changeable afterwards, and a PATCH carrying
// one field leaves the rest alone.
describe("changing a performer", () => {
  it("changes any single field, leaving the rest untouched", async () => {
    const p = await createPerformer(db, { firstName: "Pat", lastName: "Caller" });
    await PATCH_PERFORMER(
      jsonReq("PATCH", `/api/performers/${p.id}`, {
        bio: "Calls contras and squares",
        isCaller: true,
        isPublic: true,
        styles: ["contra"],
      }),
      ctx({ id: p.id }),
    );

    const res = await PATCH_PERFORMER(
      jsonReq("PATCH", `/api/performers/${p.id}`, { displayName: "Pat the Caller" }),
      ctx({ id: p.id }),
    );
    expect(res.status).toBe(200);

    const after = await db.query.performers.findFirst({ where: eq(performers.id, p.id) });
    expect(after!.displayName).toBe("Pat the Caller");
    expect(after!.bio).toBe("Calls contras and squares");
    expect(after!.isCaller).toBe(true);
    expect(after!.isPublic).toBe(true);
    expect(after!.styles).toEqual(["contra"]);
    // The contact link is not disturbed by an unrelated edit.
    expect(after!.contactId).toBe(p.contactId);
  });
});

/**
 * Feature 084 US4 (FR-023, FR-026): settling an unlinked performer by creating a contact. The contact is
 * linked, subscribes to nothing, and — because this is where a duplicate would be born — the near-match
 * the Booker should have seen first is findable by the same scoring the question uses.
 */
describe("settling an unlinked performer by creating a contact", () => {
  it("links the new contact and subscribes them to nothing", async () => {
    const [performer] = await db
      .insert(performers)
      .values({ displayName: "Newt Player" })
      .returning();

    const created = await CREATE_CONTACT(
      jsonReq("POST", "/api/contacts", { firstName: "Newt", lastName: "Player" }),
      ctx(),
    );
    expect(created.status).toBe(201);
    const contact = await created.json();

    await PATCH_PERFORMER(
      jsonReq("PATCH", `/api/performers/${performer!.id}`, { contactId: contact.id }),
      ctx({ id: performer!.id }),
    );

    const after = await db.query.performers.findFirst({ where: eq(performers.id, performer!.id) });
    expect(after!.contactId).toBe(contact.id);
    // FR-023: no mailing list, and no email at all — a touring guest is not a subscriber.
    const emails = await db
      .select()
      .from(contactEmails)
      .where(eq(contactEmails.contactId, contact.id));
    expect(emails).toHaveLength(0);
  });

  it("finds the near-match that creating would duplicate (FR-026)", async () => {
    await db.insert(contacts).values(contactRow("Clara Riedlinger"));
    const [performer] = await db
      .insert(performers)
      .values({ displayName: "Clara Reidlinger" })
      .returning();

    const { items } = await linkSuggestions(db, performer!.id).then((items) => ({ items }));
    expect(items[0]!.displayName).toBe("Clara Riedlinger");
  });
});
