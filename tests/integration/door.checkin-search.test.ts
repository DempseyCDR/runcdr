import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, jsonReqAs, ctx } from "./helpers/http";
import { makeBaseActor, makeContactWithEmail, makeEvent } from "./helpers/factories";
import { contactEmails, contacts } from "@/server/db/schema";
import { POST as CREATE_CONTACT } from "@/app/api/contacts/route";
import { GET as SEARCH } from "@/app/api/attendance/search/route";
import { recordAttendance } from "@/server/domain/attendance/attendanceService";

type Item = {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string | null;
  displayNameOverride: string | null;
  checkedIn?: boolean;
  emails: string[];
  reachedVia: { ownerDisplayName: string; address: string | null } | null;
};

const search = async (query: string, token?: string): Promise<Item[]> => {
  const path = `/api/attendance/search?${query}`;
  const res = await SEARCH(token ? jsonReqAs(token, "GET", path) : jsonReq("GET", path), ctx());
  expect(res.status).toBe(200);
  return (await res.json()).items;
};

// FR-001, FR-002
describe("GET /api/attendance/search", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("returns ranked candidates with emails for disambiguation", async () => {
    await CREATE_CONTACT(
      jsonReq("POST", "/api/contacts", {
        firstName: "Ada Lovelace",
        email: { address: "ada@example.com" },
      }),
      ctx(),
    );
    const res = await SEARCH(jsonReq("GET", "/api/attendance/search?q=ada%20lovelace"), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0].displayName).toBe("Ada Lovelace");
    expect(body.items[0].emails).toContain("ada@example.com");
  });

  /**
   * Feature 079 (FR-005–FR-007, research R4): the door's search knows the event, shows names by the 076
   * rule, and shows only addresses that still reach the dancer.
   */
  describe("for the door (079)", () => {
    it("marks who is already checked in to THIS event, and only when an event is given", async () => {
      const tonight = await makeEvent({ eventDate: "2026-09-17" });
      const other = await makeEvent({ eventDate: "2026-09-10" });
      const { contactId: inTonight } = await makeContactWithEmail({
        firstName: "Doory",
        lastName: "One",
        email: "one@example.com",
      });
      const { contactId: inOther } = await makeContactWithEmail({
        firstName: "Doory",
        lastName: "Two",
        email: "two@example.com",
      });
      await recordAttendance(db, tonight.id, { contactId: inTonight });
      await recordAttendance(db, other.id, { contactId: inOther });

      const items = await search(`q=doory&eventId=${tonight.id}`);
      expect(items.find((i) => i.id === inTonight)?.checkedIn).toBe(true);
      expect(items.find((i) => i.id === inOther)?.checkedIn).toBe(false);

      const noEvent = await search("q=doory");
      expect(noEvent.every((i) => !("checkedIn" in i))).toBe(true);
    });

    it("carries the structured names, so a custom display name can show who the dancer is", async () => {
      await makeContactWithEmail({
        firstName: "David",
        lastName: "Jones",
        displayNameOverride: "DJ",
        email: "dj@example.com",
      });
      const [dj] = await search("q=david");
      expect(dj).toMatchObject({
        displayName: "DJ",
        firstName: "David",
        lastName: "Jones",
        displayNameOverride: "DJ",
      });
    });

    it("shows reachable addresses only — active or in transition — personal ones first", async () => {
      const { contactId } = await makeContactWithEmail({
        firstName: "Robin",
        lastName: "Reel",
        email: "robin.booking@example.com",
      });
      await db
        .update(contactEmails)
        .set({ purposes: ["booking"] })
        .where(eq(contactEmails.contactId, contactId));
      await db.insert(contactEmails).values([
        { contactId, email: "robin.home@example.com", purposes: ["personal"] },
        { contactId, email: "robin.moving@example.com", status: "transition" },
        { contactId, email: "robin.old@example.com", status: "inactive" },
      ]);

      const [robin] = await search("q=robin");
      expect(robin!.emails).not.toContain("robin.old@example.com");
      expect(robin!.emails).toContain("robin.moving@example.com");
      expect(robin!.emails).toContain("robin.booking@example.com");
      expect(robin!.emails[0]).toBe("robin.home@example.com");
    });

    it("says who a contact is reached through when they ride a household address", async () => {
      const { emailId } = await makeContactWithEmail({
        firstName: "Ann",
        lastName: "Jones",
        email: "jones@example.com",
      });
      const { contactId: rider } = await makeContactWithEmail({
        firstName: "Sam",
        lastName: "Jones",
        email: "sam.old@example.com",
        emailStatus: "inactive",
      });
      await db
        .update(contacts)
        .set({ messageRecipientEmailId: emailId })
        .where(eq(contacts.id, rider));

      const items = await search("q=jones");
      expect(items.find((i) => i.id === rider)?.reachedVia).toEqual({
        ownerDisplayName: "Ann Jones",
        address: "jones@example.com",
      });
      expect(items.find((i) => i.id !== rider)?.reachedVia).toBeNull();
    });

    it("keeps names and the checkmark but withholds addresses from a volunteer without PII access", async () => {
      const tonight = await makeEvent({ eventDate: "2026-09-17" });
      const { emailId } = await makeContactWithEmail({
        firstName: "Ann",
        lastName: "Jones",
        email: "jones@example.com",
      });
      const { contactId: rider } = await makeContactWithEmail({
        firstName: "Sam",
        lastName: "Jones",
        email: "sam.old@example.com",
        emailStatus: "inactive",
      });
      await db
        .update(contacts)
        .set({ messageRecipientEmailId: emailId })
        .where(eq(contacts.id, rider));
      await recordAttendance(db, tonight.id, { contactId: rider });
      const base = await makeBaseActor("base@example.com");

      const items = await search(`q=jones&eventId=${tonight.id}`, base.token);
      const sam = items.find((i) => i.id === rider)!;
      expect(sam).toMatchObject({ firstName: "Sam", lastName: "Jones", checkedIn: true });
      expect(sam.emails).toEqual([]);
      expect(sam.reachedVia).toEqual({ ownerDisplayName: "Ann Jones", address: null });
      expect(items.every((i) => i.emails.length === 0)).toBe(true);
    });
  });
});
