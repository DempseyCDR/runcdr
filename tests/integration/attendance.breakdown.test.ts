import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeBaseActor, makeEvent, makePerformer } from "./helpers/factories";
import { jsonReqAs, ctx } from "./helpers/http";
import {
  bookings,
  eventAttendanceRollups,
  eventGroups,
  type PerformerRow,
} from "@/server/db/schema";
import type { PerformerType } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { recordAttendance } from "@/server/domain/attendance/attendanceService";
import { getAttendanceBreakdown } from "@/server/domain/attendance/breakdownService";
import { GET as BREAKDOWN } from "@/app/api/events/[id]/attendance-breakdown/route";

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

const book = (eventId: string, p: PerformerRow, performerType: PerformerType) =>
  createBooking(db, eventId, { performerId: p.id, performerType, pay: 0 });

const checkIn = (eventId: string, p: PerformerRow) =>
  recordAttendance(db, eventId, { contactId: p.contactId! });

const anonymous = async (eventId: string, n: number) => {
  for (let i = 0; i < n; i++) await recordAttendance(db, eventId, { unmatched: true });
};

/**
 * Feature 079 (FR-022–FR-026, FR-030, FR-033): one breakdown of an event's attendance, read by the door, the
 * gate page, the treasurer report and the organizer report alike.
 */
describe("an event's attendance breakdown (079)", () => {
  it("counts attendance, children, comps, gift cards and the door attendant", async () => {
    const evt = await makeEvent({ seriesKey: "community_dance", eventDate: "2026-09-17" });
    await anonymous(evt.id, 5);
    await recordAttendance(db, evt.id, { unmatched: true, childrenCount: 2, isComp: true });
    await recordAttendance(db, evt.id, { unmatched: true, redeemedGiftCard: true });
    const musician = await makePerformer("Olive Openband");
    await recordAttendance(db, evt.id, { contactId: musician.contactId!, isOpenBand: true });

    const b = await getAttendanceBreakdown(db, evt.id);
    expect(b).toMatchObject({
      attendance: 10, // 5 + (1 + 2 children) + 1 + 1
      children: 2,
      doorAttendant: 1,
      comps: 2, // one manual comp + one open-band musician
      giftCards: 1,
      performers: { caller: 0, band: 0, soundTech: 0, instructor: 0 },
    });
    expect(b.paying).toBe(10 - 0 - 1 - 2);
  });

  it("reads zero comps and gift cards for an event with no door record", async () => {
    const evt = await makeEvent({ chargesAdmission: false });
    await anonymous(evt.id, 3);
    const b = await getAttendanceBreakdown(db, evt.id);
    expect(b).toMatchObject({ attendance: 3, comps: 0, giftCards: 0, paying: 2 });
  });

  it("subtracts a booked performer only once they are checked in (FR-023)", async () => {
    const evt = await makeEvent();
    await anonymous(evt.id, 20);
    const caller = await makePerformer("Cal Caller");
    await book(evt.id, caller, "caller");

    const before = await getAttendanceBreakdown(db, evt.id);
    expect(before.performers.caller, "a caller who never came through the door").toBe(0);
    expect(before.paying).toBe(20 - 1);

    await checkIn(evt.id, caller);
    const after = await getAttendanceBreakdown(db, evt.id);
    expect(after.attendance).toBe(21);
    expect(after.performers.caller).toBe(1);
    expect(after.paying).toBe(21 - 1 - 1);
  });

  it("counts each kind of performer: band includes lead, musician and open-band leader", async () => {
    const evt = await makeEvent();
    const kinds: [string, PerformerType][] = [
      ["Lee Lead", "lead_musician"],
      ["Mo Musician", "musician"],
      ["Obi Openlead", "open_band_musician"],
      ["Sam Sound", "sound_tech"],
      ["Ivy Instructor", "instructor"],
      ["Cal Caller", "caller"],
    ];
    for (const [name, kind] of kinds) {
      const p = await makePerformer(name);
      await book(evt.id, p, kind);
      await checkIn(evt.id, p);
    }
    const b = await getAttendanceBreakdown(db, evt.id);
    expect(b.performers).toEqual({ caller: 1, band: 3, soundTech: 1, instructor: 1 });
  });

  it("counts only bookings for this event, in any status (FR-024)", async () => {
    const [group] = await db.insert(eventGroups).values({ name: "2nd Thursday" }).returning();
    const contra = await makeEvent({ seriesKey: "tnc", groupId: group!.id });
    const community = await makeEvent({ seriesKey: "community_dance", groupId: group!.id });
    const elsewhere = await makePerformer("Sib Ling");
    await book(community.id, elsewhere, "caller");
    await checkIn(contra.id, elsewhere);

    const tentative = await makePerformer("Ten Tative");
    const booking = await book(contra.id, tentative, "musician");
    await db.update(bookings).set({ status: "tentative" }).where(eq(bookings.id, booking.id));
    await checkIn(contra.id, tentative);

    const b = await getAttendanceBreakdown(db, contra.id);
    expect(b.performers.caller, "a booking on the sibling event counted here").toBe(0);
    expect(b.performers.band, "a tentative booking is still a booking").toBe(1);
  });

  it("counts a double-booked performer once, under the first kind, and flags it (FR-033)", async () => {
    const evt = await makeEvent();
    const pat = await makePerformer("Pat Fiddler");
    await book(evt.id, pat, "sound_tech");
    await book(evt.id, pat, "musician");

    expect((await getAttendanceBreakdown(db, evt.id)).doubleBookings, "not checked in yet").toEqual(
      [],
    );

    await checkIn(evt.id, pat);
    const b = await getAttendanceBreakdown(db, evt.id);
    expect(b.performers).toEqual({ caller: 0, band: 1, soundTech: 0, instructor: 0 });
    expect(b.doubleBookings).toEqual([
      { contactId: pat.contactId, displayName: "Pat Fiddler", kinds: ["musician", "sound_tech"] },
    ]);
  });

  it("never goes below zero, and otherwise adds up to attendance (SC-005)", async () => {
    const evt = await makeEvent();
    const caller = await makePerformer("Cal Caller");
    await book(evt.id, caller, "caller");
    await checkIn(evt.id, caller);
    expect((await getAttendanceBreakdown(db, evt.id)).paying).toBe(0);

    await anonymous(evt.id, 7);
    await recordAttendance(db, evt.id, { unmatched: true, childrenCount: 3, isComp: true });
    const b = await getAttendanceBreakdown(db, evt.id);
    const performers = Object.values(b.performers).reduce((a, n) => a + n, 0);
    expect(b.paying).toBeGreaterThan(0);
    expect(b.paying + performers + b.doorAttendant + b.comps).toBe(b.attendance);
  });

  it("follows booking changes while the check-ins are retained (FR-030)", async () => {
    const evt = await makeEvent();
    await anonymous(evt.id, 10);
    const caller = await makePerformer("Cal Caller");
    await checkIn(evt.id, caller);
    expect((await getAttendanceBreakdown(db, evt.id)).performers.caller).toBe(0);

    const booking = await book(evt.id, caller, "caller");
    expect((await getAttendanceBreakdown(db, evt.id)).performers.caller).toBe(1);

    await db.delete(bookings).where(eq(bookings.id, booking.id));
    expect((await getAttendanceBreakdown(db, evt.id)).performers.caller).toBe(0);
  });

  it("adds what the purge rolled up to what the present check-ins say", async () => {
    const evt = await makeEvent();
    await anonymous(evt.id, 4);
    await db.insert(eventAttendanceRollups).values({
      eventId: evt.id,
      childrenCount: 2,
      callerCount: 1,
      bandCount: 2,
    });
    const caller = await makePerformer("Cal Caller");
    await book(evt.id, caller, "caller");
    await recordAttendance(db, evt.id, { contactId: caller.contactId!, childrenCount: 1 });

    const b = await getAttendanceBreakdown(db, evt.id);
    expect(b.children).toBe(3);
    expect(b.performers).toEqual({ caller: 2, band: 2, soundTech: 0, instructor: 0 });
  });

  describe("GET /api/events/{id}/attendance-breakdown", () => {
    it("is readable by any signed-in volunteer", async () => {
      const evt = await makeEvent();
      await anonymous(evt.id, 3);
      const base = await makeBaseActor("base@example.com");
      const res = await BREAKDOWN(
        jsonReqAs(base.token, "GET", `/api/events/${evt.id}/attendance-breakdown`),
        ctx({ id: evt.id }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(await getAttendanceBreakdown(db, evt.id));
    });

    it("is 404 for an unknown event", async () => {
      const base = await makeBaseActor("base@example.com");
      const id = "00000000-0000-0000-0000-000000000000";
      const res = await BREAKDOWN(
        jsonReqAs(base.token, "GET", `/api/events/${id}/attendance-breakdown`),
        ctx({ id }),
      );
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("EVENT_NOT_FOUND");
    });
  });
});
