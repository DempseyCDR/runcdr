import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReqAs, ctx } from "./helpers/http";
import { makeActor, makeEvent, makePerformer } from "./helpers/factories";
import { events } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { performerHistory } from "@/server/domain/bookings/performerHistory";
import { GET as HISTORY } from "@/app/api/performers/[id]/history/route";
import { GET as BANDS } from "@/app/api/bands/route";
import { archiveBand, createBand } from "@/server/domain/bands/bandService";

/**
 * Feature 087 US3 (FR-019): a performer's history with the club — the dances they have played and are
 * booked to play, newest first.
 *
 * This is the read that replaces the retired caller/musician filters on the old report: "where has Bob
 * played?" is a question about Bob, answered from Bob. The phone surface will ask the same question.
 */
describe("a performer's history", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lists the dances they played and are booked for, newest first, with role and state", async () => {
    const bob = await makePerformer("Bob Fabinski");
    const early = await makeEvent({ seriesKey: "tnc", eventDate: "2026-03-05" });
    const later = await makeEvent({ seriesKey: "ecd", eventDate: "2026-11-12" });
    await db.update(events).set({ label: "Autumn ball" }).where(eq(events.id, later.id));
    await createBooking(db, early.id, { performerId: bob.id, performerType: "musician", pay: 60 });
    await createBooking(db, later.id, { performerId: bob.id, performerType: "caller", pay: 150 });

    const history = await performerHistory(db, bob.id);

    expect(history.map((h) => h.date)).toEqual(["2026-11-12", "2026-03-05"]);
    expect(history[0]).toMatchObject({
      eventId: later.id,
      label: "Autumn ball",
      series: "Sunday English Country Dance",
      role: "caller",
      status: "proposed",
    });
    expect(history[1]).toMatchObject({ eventId: early.id, role: "musician" });
  });

  it("names nobody else's dances", async () => {
    const bob = await makePerformer("Bob Fabinski");
    const cal = await makePerformer("Cal Caller");
    const ev = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    await createBooking(db, ev.id, { performerId: cal.id, performerType: "caller", pay: 150 });

    expect(await performerHistory(db, bob.id)).toEqual([]);
  });

  it("keeps a declined booking, marked — it is part of their history with the club", async () => {
    const bob = await makePerformer("Bob Fabinski");
    const ev = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const b = await createBooking(db, ev.id, {
      performerId: bob.id,
      performerType: "musician",
      pay: 60,
    });
    const { patchBooking } = await import("@/server/domain/bookings/bookingService");
    await patchBooking(db, b.id, { status: "declined" }, "test");

    const [h] = await performerHistory(db, bob.id);
    expect(h?.status).toBe("declined");
  });

  it("is readable by any volunteer at GET /api/performers/{id}/history", async () => {
    const bob = await makePerformer("Bob Fabinski");
    const ev = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    await createBooking(db, ev.id, { performerId: bob.id, performerType: "musician", pay: 60 });
    const { token } = await makeActor({ email: "reader.history@cdrochester.org" });

    const res = await HISTORY(
      jsonReqAs(token, "GET", `/api/performers/${bob.id}/history`),
      ctx({ id: bob.id }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).items).toHaveLength(1);
  });

  /**
   * FR-020: the bands they play in, each leading to that band. A REPORT of the person, so an archived
   * band is listed — marked — rather than hidden: it is still a band they played in (feature 084's rule,
   * reads that offer hide archived and reads that report do not).
   */
  it("names the bands they play in at GET /api/bands?performer=, archived ones marked", async () => {
    const bob = await makePerformer("Bob Fabinski");
    const cal = await makePerformer("Cal Caller");
    const reels = await createBand(db, {
      name: "The Reels",
      members: [{ performerId: bob.id, isLead: true }],
    });
    const old = await createBand(db, {
      name: "Old Timers",
      members: [
        { performerId: cal.id, isLead: true },
        { performerId: bob.id, isLead: false },
      ],
    });
    await createBand(db, { name: "Not His", members: [{ performerId: cal.id, isLead: true }] });
    await archiveBand(db, old.id, "test");
    const { token } = await makeActor({ email: "reader.bands@cdrochester.org" });

    const res = await BANDS(jsonReqAs(token, "GET", `/api/bands?performer=${bob.id}`), ctx());
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items).toEqual([
      expect.objectContaining({ id: old.id, name: "Old Timers", isLead: false, archived: true }),
      expect.objectContaining({ id: reels.id, name: "The Reels", isLead: true, archived: false }),
    ]);
  });
});
