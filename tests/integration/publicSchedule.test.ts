import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent } from "./helpers/factories";
import { events, venues } from "@/server/db/schema";
import { getPublicSchedule, homeWindowStart } from "@/server/domain/public/publicSchedule";
import { SERIES_KEYS } from "@/server/domain/series/seriesKeys";

// FR-001, FR-010
describe("getPublicSchedule", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  const cutoff = "2026-06-01"; // fixed reference so the test doesn't depend on the wall clock

  it("returns events on/after the cutoff, ascending, with activity + venue name; past excluded", async () => {
    const past = await makeEvent({ seriesKey: "tnc", eventDate: "2026-01-01" });
    const soon = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const later = await makeEvent({ seriesKey: "ecd", eventDate: "2026-07-05" });

    const [v] = await db
      .insert(venues)
      .values({ name: "German House", address: "315 Gregory St" })
      .returning();
    await db.update(events).set({ venueId: v!.id }).where(eq(events.id, soon.id));

    const schedule = await getPublicSchedule(db, cutoff);
    expect(schedule.map((s) => s.eventId)).toEqual([soon.id, later.id]); // ascending, past excluded
    expect(schedule.map((s) => s.eventId)).not.toContain(past.id);

    const soonItem = schedule.find((s) => s.eventId === soon.id)!;
    expect(soonItem.activity).toBe("Thursday Night Contra");
    expect(soonItem.venueName).toBe("German House");

    const laterItem = schedule.find((s) => s.eventId === later.id)!;
    expect(laterItem.venueName).toBeNull(); // no venue assigned
  });

  // Feature 036 (P6-R3): the /whats-on home window starts two calendar days before today (inclusive),
  // ascending, so recent-past dances show alongside upcoming ones; anything older is excluded.
  it("includes events from two days ago onward, ascending; older than two days excluded", async () => {
    const ref = "2026-06-10";
    const older = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-07" }); // ref-3 → excluded
    const twoAgo = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-08" }); // ref-2 → included (boundary)
    const yesterday = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-09" }); // ref-1 → included
    const future = await makeEvent({ seriesKey: "ecd", eventDate: "2026-07-01" }); // included

    const schedule = await getPublicSchedule(db, homeWindowStart(ref));
    expect(schedule.map((s) => s.eventId)).toEqual([twoAgo.id, yesterday.id, future.id]); // ascending
    expect(schedule.map((s) => s.eventId)).not.toContain(older.id);
  });

  // Feature 037 (P6-R5): the schedule filters by series when a seriesKey is given.
  it("filters the schedule by series when a seriesKey is given", async () => {
    const tnc = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const ecd = await makeEvent({ seriesKey: "ecd", eventDate: "2026-06-20" });

    const filtered = await getPublicSchedule(db, cutoff, "tnc");
    expect(filtered.map((s) => s.eventId)).toEqual([tnc.id]);
    expect(filtered.map((s) => s.eventId)).not.toContain(ecd.id);
  });

  it("includes a free event (chargesAdmission = false) in the schedule", async () => {
    const free = await makeEvent({
      seriesKey: SERIES_KEYS.cdob,
      eventDate: "2026-06-20",
      chargesAdmission: false,
    });
    const schedule = await getPublicSchedule(db, cutoff);
    expect(schedule.map((s) => s.eventId)).toContain(free.id);
  });
});
