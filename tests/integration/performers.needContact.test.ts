import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, jsonReqAs, ctx } from "./helpers/http";
import { contactRow, makeActor, makeEvent, makePerformer } from "./helpers/factories";
import { bookings, contacts, performers } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { getPerformer } from "@/server/domain/performers/performerService";
import { performersNeedingContact } from "@/server/domain/performers/needContact";
import { GET as NEEDING } from "@/app/api/performers/needing-contact/route";
import { PATCH } from "@/app/api/performers/[id]/route";

/**
 * Feature 087 US5 (FR-026 to FR-028, B57, B58) — the performers who need a contact.
 *
 * A performer's email and telephone live on their contact, so a performer with no contact cannot be
 * reached, and one pointing at a RETIRED contact (archived, or merged into another) is reached through a
 * record nobody maintains any more. The club has eighteen of the first and at least one of the second
 * (Catherine Sloboda → an archived contact, while the live one is "Catherine McCallen"). Both are the
 * same work — settle the link — so they are one list.
 */
describe("the performers who need a contact (087 US5)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function unlinked(name: string) {
    const p = await makePerformer(name);
    await db.update(performers).set({ contactId: null }).where(eq(performers.id, p.id));
    return p;
  }

  async function archivedLink(name: string) {
    const p = await makePerformer(name);
    await db.update(contacts).set({ archivedAt: new Date() }).where(eq(contacts.id, p.contactId!));
    return p;
  }

  async function mergedLink(name: string) {
    const p = await makePerformer(name);
    const [survivor] = await db
      .insert(contacts)
      .values(contactRow(`${name} (kept)`))
      .returning();
    await db
      .update(contacts)
      .set({ mergedIntoId: survivor!.id })
      .where(eq(contacts.id, p.contactId!));
    return p;
  }

  it("lists and counts those with no contact, and those whose contact is archived or merged (T061)", async () => {
    await makePerformer("Linked Lou");
    const none = await unlinked("Nobody Ned");
    const archived = await archivedLink("Catherine Sloboda");
    const merged = await mergedLink("Merged Mo");

    const { count, items } = await performersNeedingContact(db);

    expect(count).toBe(3);
    expect(items).toEqual([
      expect.objectContaining({
        id: archived.id,
        displayName: "Catherine Sloboda",
        reason: "archived",
      }),
      expect.objectContaining({ id: merged.id, displayName: "Merged Mo", reason: "merged" }),
      expect.objectContaining({ id: none.id, displayName: "Nobody Ned", reason: "none" }),
    ]);
  });

  it("leaves out an archived performer — retired, so not work (T061)", async () => {
    const p = await unlinked("Gone Gus");
    await db.update(performers).set({ archivedAt: new Date() }).where(eq(performers.id, p.id));

    expect((await performersNeedingContact(db)).count).toBe(0);
  });

  it("is readable by any volunteer at GET /api/performers/needing-contact (T062)", async () => {
    await unlinked("Nobody Ned");
    const { token } = await makeActor({ email: "reader.needing@cdrochester.org" });

    const res = await NEEDING(jsonReqAs(token, "GET", "/api/performers/needing-contact"), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ count: 1, items: [{ displayName: "Nobody Ned" }] });
  });

  it("says on the performer's own record when its contact is retired, and how (FR-027)", async () => {
    const archived = await archivedLink("Catherine Sloboda");
    const merged = await mergedLink("Merged Mo");
    const fine = await makePerformer("Linked Lou");

    expect((await getPerformer(db, archived.id)).contactRetired).toBe("archived");
    expect((await getPerformer(db, merged.id)).contactRetired).toBe("merged");
    expect((await getPerformer(db, fine.id)).contactRetired).toBeNull();
  });

  it("drops a performer from the list once the link is settled (US5 scenario 2)", async () => {
    const p = await archivedLink("Catherine Sloboda");
    const [live] = await db.insert(contacts).values(contactRow("Catherine McCallen")).returning();

    const res = await PATCH(
      jsonReq("PATCH", `/api/performers/${p.id}`, { contactId: live!.id }),
      ctx({ id: p.id }),
    );
    expect(res.status).toBe(200);
    expect((await performersNeedingContact(db)).count).toBe(0);
  });

  it("re-points the contact without disturbing a single booking (T066, FR-028)", async () => {
    const p = await archivedLink("Catherine Sloboda");
    const past = await makeEvent({ seriesKey: "tnc", eventDate: "2025-05-01" });
    const future = await makeEvent({ seriesKey: "ecd", eventDate: "2027-05-02" });
    await createBooking(db, past.id, { performerId: p.id, performerType: "caller", pay: 150 });
    await createBooking(db, future.id, { performerId: p.id, performerType: "caller", pay: 150 });
    const every = async () =>
      JSON.stringify(await db.select().from(bookings).orderBy(asc(bookings.id)));
    const before = await every();

    const [live] = await db.insert(contacts).values(contactRow("Catherine McCallen")).returning();
    await PATCH(
      jsonReq("PATCH", `/api/performers/${p.id}`, { contactId: live!.id }),
      ctx({ id: p.id }),
    );

    expect(await every()).toBe(before);
  });
});
