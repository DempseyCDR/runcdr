import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db, TEST_STAFF_DISPLAY_NAME } from "./helpers/db";
import { createContact, searchContacts } from "@/server/domain/contacts/contactService";
import {
  listEventAttendance,
  recordAttendance,
} from "@/server/domain/attendance/attendanceService";
import { makeEvent } from "./helpers/factories";
import { jsonReq, ctx } from "./helpers/http";
import { GET as ROSTER } from "@/app/api/events/[id]/attendance/route";

// FR-007, FR-008, SC-002 — the door roster browses alphabetically by last name; labels are the
// effective display name.
describe("check-in roster sort", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("orders the browse roster by last then first name", async () => {
    await createContact(db, { firstName: "Ada", lastName: "Lovelace" });
    await createContact(db, { firstName: "Grace", lastName: "Hopper" });
    await createContact(db, { firstName: "Bob", lastName: "Frost" });

    // Exclude the harness's standing staff member (feature 015 seeds one for API auth).
    const roster = (await searchContacts(db, "", 20, { orderBy: "name" })).items.filter(
      (r) => r.displayName !== TEST_STAFF_DISPLAY_NAME,
    );
    expect(roster.map((r) => r.displayName)).toEqual(["Bob Frost", "Grace Hopper", "Ada Lovelace"]);
  });

  it("labels a roster entry with the effective display name (override wins)", async () => {
    await createContact(db, {
      firstName: "Robert",
      lastName: "Frost",
      displayNameOverride: "Bob Frost",
    });
    const { items: roster } = await searchContacts(db, "", 20, { orderBy: "name" });
    expect(roster.map((r) => r.displayName)).toContain("Bob Frost");
  });

  /** Feature 079 (FR-018, research R11): the checked-in dialog lists by display name first. */
  describe("the checked-in list's display-name sort (079)", () => {
    async function checkedIn() {
      const evt = await makeEvent();
      const people = [
        { firstName: "Robert", lastName: "Frost", displayNameOverride: "Zed" },
        { firstName: "Ada", lastName: "Lovelace" },
        { firstName: "Grace", lastName: "Hopper", displayNameOverride: "Amazing Grace" },
      ];
      for (const p of people) {
        const c = await createContact(db, p);
        await recordAttendance(db, evt.id, { contactId: c.id });
      }
      await recordAttendance(db, evt.id, { unmatched: true });
      return evt;
    }

    it("orders by display name, anonymous check-ins last, and carries the override", async () => {
      const evt = await checkedIn();
      const { attendees } = await listEventAttendance(db, evt.id, "display");
      expect(attendees.map((a) => a.displayName)).toEqual([
        "Ada Lovelace",
        "Amazing Grace",
        "Zed",
        null,
      ]);
      expect(attendees.find((a) => a.displayName === "Zed")?.displayNameOverride).toBe("Zed");
      expect(
        attendees.find((a) => a.displayName === "Ada Lovelace")?.displayNameOverride,
      ).toBeNull();
    });

    it("is available from the route, whose default stays last name", async () => {
      const evt = await checkedIn();
      const byDisplay = await (
        await ROSTER(
          jsonReq("GET", `/api/events/${evt.id}/attendance?sort=display`),
          ctx({ id: evt.id }),
        )
      ).json();
      expect(byDisplay.attendees[0].displayName).toBe("Ada Lovelace");
      const byDefault = await (
        await ROSTER(jsonReq("GET", `/api/events/${evt.id}/attendance`), ctx({ id: evt.id }))
      ).json();
      expect(byDefault.attendees.map((a: { lastName: string | null }) => a.lastName)).toEqual([
        "Frost",
        "Hopper",
        "Lovelace",
        null,
      ]);
    });
  });
});
