import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makePerformer } from "./helpers/factories";
import { events, venues } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { createVenue } from "@/server/domain/venues/venueService";
import { assembleBookingsReport } from "@/server/domain/bookings/reportService";
import { SERIES_KEYS } from "@/server/domain/series/seriesKeys";

// Feature 020 US1 (FR-001/002/004/006): sort direction, venue short name (+ fallback), hasSoundTech, and
// the existing performer filter still working.
describe("bookings report — booker view", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  // Feature 087 (FR-001b): newest first, always. The ascending toggle is RETIRED with the other filters —
  // the table reads like the Booker's spreadsheet, and that has one order.
  it("is always newest first", async () => {
    await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-04" });
    await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });

    const { rows } = await assembleBookingsReport(db, {});
    expect(rows.map((r) => r.date)).toEqual(["2026-06-18", "2026-06-04"]);
  });

  // Feature 091 (Rich, 2026-10-01): the short name (020 US1) was for the table's narrow Venue column.
  // The table is retired and a card has room, so the hub names the venue in full — short name or not.
  it("names the venue in full, with or without a short name, and nothing for no venue", async () => {
    const withShort = await createVenue(db, { name: "German House", address: "1 Main" });
    const noShort = await createVenue(db, { name: "The Rose Room", address: "2 Elm" });
    await db.update(venues).set({ shortName: null }).where(eq(venues.id, noShort.id));

    const e1 = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-04" });
    const e2 = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const e3 = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-25" });
    await db.update(events).set({ venueId: withShort.id }).where(eq(events.id, e1.id));
    await db.update(events).set({ venueId: noShort.id }).where(eq(events.id, e2.id));
    await db.update(events).set({ venueId: null }).where(eq(events.id, e3.id));

    const { rows } = await assembleBookingsReport(db, {});
    const byId = new Map(rows.map((r) => [r.eventId, r]));
    expect(byId.get(e1.id)?.venueName).toBe("German House");
    expect(byId.get(e2.id)?.venueName).toBe("The Rose Room");
    expect(byId.get(e3.id)?.venueName).toBeNull();
  });

  it("reports hasSoundTech per the event's series (false for the community dance)", async () => {
    const tnc = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-04" });
    const cd = await makeEvent({ seriesKey: SERIES_KEYS.cdob, eventDate: "2026-06-05" });
    const { rows } = await assembleBookingsReport(db, {});
    const byId = new Map(rows.map((r) => [r.eventId, r]));
    expect(byId.get(tnc.id)?.hasSoundTech).toBe(true);
    expect(byId.get(cd.id)?.hasSoundTech).toBe(false);
  });

  // Feature 087: the performer FILTER is retired (FR-001b); a performer's own history answers that (US3).
  // What this test really protected survives: every booking line carries its id, because clicking a name
  // on the hub opens THAT booking (FR-009).
  it("carries each booking's id, so the hub can open that booking", async () => {
    const p = await makePerformer("Bob Fabinski");
    const withP = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-04" });
    await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    await createBooking(db, withP.id, { performerId: p.id, performerType: "musician", pay: 100 });

    const { rows } = await assembleBookingsReport(db, {});
    const line = rows.find((r) => r.eventId === withP.id)?.bookings[0];
    expect(line?.performer).toBe("Bob Fabinski");
    expect(line?.bookingId).toBeDefined();
  });
});
