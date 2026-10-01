import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb } from "./helpers/db";
import { ctx } from "./helpers/http";
import { db } from "@/server/db/client";
import { contacts, staffIdentities } from "@/server/db/schema";
import { resolveSignIn } from "@/server/auth/signIn";
import { contactRow, makeVolunteerContact } from "./helpers/factories";
import { createSession, SESSION_COOKIE } from "@/server/auth/session";
import { NEXT_COOKIE } from "@/server/auth/cookies";
import { GET as LIST_EVENTS } from "@/app/api/events/route";
import { GET as LIST_CONTACTS } from "@/app/api/contacts/route";
import { GET as START_SIGNIN } from "@/app/api/auth/google/route";

/**
 * FR-004 / FR-011 / SC-002: the protection boundary, exercised through real route handlers.
 *
 * The route-inventory test (auth.routeInventory.test.ts) proves EVERY route is wrapped; this proves
 * the wrapper actually does the right thing.
 */
describe("API protection (FR-004)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  function req(path: string, token?: string) {
    return new Request(`http://localhost${path}`, {
      headers: token ? { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` } : {},
    });
  }

  async function signedInToken(email = "alice@cdrochester.org") {
    const { contactId } = await makeVolunteerContact({ email });
    const [identity] = await db
      .insert(staffIdentities)
      .values({ contactId, googleSub: `sub-${contactId}` })
      .returning();
    const { token } = await createSession(db, identity!.id);
    return { token, contactId };
  }

  it("refuses an unauthenticated API request with 401", async () => {
    const res = await LIST_EVENTS(req("/api/events"), ctx());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Authentication required." },
    });
  });

  it("refuses a garbage session cookie with 401", async () => {
    const res = await LIST_CONTACTS(req("/api/contacts", "not-a-real-token"), ctx());
    expect(res.status).toBe(401);
  });

  it("admits a signed-in staff member", async () => {
    const { token } = await signedInToken();
    const res = await LIST_EVENTS(req("/api/events", token), ctx());
    expect(res.status).toBe(200);
  });

  it("keeps /api/auth/* PUBLIC — otherwise sign-in would deadlock", async () => {
    const res = await START_SIGNIN(req("/api/auth/google"), ctx());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("accounts.google.com");
  });

  // Feature 090 (FR-015): the page to return to after signing in is set here, when sign-in starts. With
  // no page asked for it is the volunteer home page — found in the browser, where it was "/", the public
  // home, which the callback then honoured.
  it("starts sign-in bound for the volunteer home page when no page was asked for (090)", async () => {
    const res = await START_SIGNIN(req("/api/auth/google"), ctx());
    const cookies = res.headers.getSetCookie().join("; ");
    expect(cookies).toContain(`${NEXT_COOKIE}=${encodeURIComponent("/volunteer")}`);
  });

  it("starts sign-in bound for the page it was asked for (090)", async () => {
    const res = await START_SIGNIN(req("/api/auth/google?next=%2Fpayments"), ctx());
    const cookies = res.headers.getSetCookie().join("; ");
    expect(cookies).toContain(`${NEXT_COOKIE}=${encodeURIComponent("/payments")}`);
  });

  // FR-011 / SC-006 — through the real protection layer, not just the session module.
  it("locks out a LIVE session the moment volunteer access is withdrawn", async () => {
    const { token, contactId } = await signedInToken();
    expect((await LIST_EVENTS(req("/api/events", token), ctx())).status).toBe(200);

    await db.update(contacts).set({ isVolunteer: false }).where(eq(contacts.id, contactId));

    // Same cookie, same unexpired session row — refused on the very next request.
    expect((await LIST_EVENTS(req("/api/events", token), ctx())).status).toBe(401);
  });

  /**
   * Feature 071. `readSession` checked `is_volunteer` but nothing else about the contact, so a volunteer
   * who was MERGED AWAY or ARCHIVED kept working: their session row is unexpired, their `staff_identities`
   * row still resolves their Google sign-in, and their `role_grants` still sit on the retired shell.
   *
   * Both markers already mean "this contact is not an active record" everywhere else — `activeContact()`
   * excludes them from every read — so the session path was the one place they did not apply. Latent when
   * found (no merged contact held an identity), but 3 merged contacts still carried `is_volunteer = true`,
   * so the one check that existed had already stopped catching them.
   */
  it("locks out a live session when the contact is MERGED away", async () => {
    const { token, contactId } = await signedInToken();
    expect((await LIST_EVENTS(req("/api/events", token), ctx())).status).toBe(200);

    const [survivor] = await db.insert(contacts).values(contactRow("Survivor Contact")).returning();
    await db.update(contacts).set({ mergedIntoId: survivor!.id }).where(eq(contacts.id, contactId));

    expect((await LIST_EVENTS(req("/api/events", token), ctx())).status).toBe(401);
  });

  it("locks out a live session when the contact is ARCHIVED", async () => {
    const { token, contactId } = await signedInToken();
    expect((await LIST_EVENTS(req("/api/events", token), ctx())).status).toBe(200);

    await db.update(contacts).set({ archivedAt: new Date() }).where(eq(contacts.id, contactId));

    expect((await LIST_EVENTS(req("/api/events", token), ctx())).status).toBe(401);
  });

  it("refuses a merged contact indistinguishably from having no session at all", async () => {
    const { token, contactId } = await signedInToken();
    const [survivor] = await db.insert(contacts).values(contactRow("Survivor Two")).returning();
    await db.update(contacts).set({ mergedIntoId: survivor!.id }).where(eq(contacts.id, contactId));

    const retired = await LIST_EVENTS(req("/api/events", token), ctx());
    const anonymous = await LIST_EVENTS(req("/api/events"), ctx());
    expect(retired.status).toBe(anonymous.status);
    expect(await retired.json()).toEqual(await anonymous.json());
  });

  /**
   * Feature 072 (FR-013). Feature 071 refuses a retired contact at session READ, which is what made this
   * visible: sign-in appeared to succeed and then every request 401'd. The refusal belongs at sign-in,
   * and BOTH routes need it — a Google account already bound to a contact since merged, and a first-time
   * address match on a retired one. Neither checked; the known-account branch tested only `is_volunteer`.
   */
  it("refuses a Google account bound to a contact that has since been merged away", async () => {
    const { contactId } = await signedInToken("merged-signer@cdrochester.org");
    const [survivor] = await db.insert(contacts).values(contactRow("Survivor")).returning();
    await db.update(contacts).set({ mergedIntoId: survivor!.id }).where(eq(contacts.id, contactId));

    const identity = await db.query.staffIdentities.findFirst({
      where: eq(staffIdentities.contactId, contactId),
    });
    const result = await resolveSignIn(db, {
      sub: identity!.googleSub,
      email: "merged-signer@cdrochester.org",
      email_verified: true,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a FIRST-TIME sign-in matching an archived contact", async () => {
    const c = await makeVolunteerContact({
      firstName: "Archie",
      lastName: "Ved",
      email: "archie@cdrochester.org",
    });
    await db.update(contacts).set({ archivedAt: new Date() }).where(eq(contacts.id, c.contactId));

    const result = await resolveSignIn(db, {
      sub: "brand-new-google-sub",
      email: "archie@cdrochester.org",
      email_verified: true,
    });
    // Refused at sign-in — not enrolled, and not handed a session every page then rejects.
    expect(result.ok).toBe(false);
    const identities = await db
      .select()
      .from(staffIdentities)
      .where(eq(staffIdentities.contactId, c.contactId));
    expect(identities).toHaveLength(0);
  });

  it("does not reveal WHY access was refused", async () => {
    // "no session" and "access withdrawn" must be indistinguishable to the caller.
    const { token, contactId } = await signedInToken();
    await db.update(contacts).set({ isVolunteer: false }).where(eq(contacts.id, contactId));

    const withdrawn = await LIST_EVENTS(req("/api/events", token), ctx());
    const anonymous = await LIST_EVENTS(req("/api/events"), ctx());

    expect(withdrawn.status).toBe(anonymous.status);
    expect(await withdrawn.json()).toEqual(await anonymous.json());
  });
});
