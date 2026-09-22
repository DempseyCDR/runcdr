import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent } from "./helpers/factories";
import { events, venues } from "@/server/db/schema";
import { createVenueRent, resolveEventRentCents } from "@/server/domain/parameters/rentService";

async function eventRow(id: string) {
  return (await db.query.events.findFirst({ where: eq(events.id, id) }))!;
}

// FR-001..FR-005, SC-001, SC-002 — rent resolves per-event → series-at-venue → venue default → 0.
describe("venue rent precedence", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("resolves per-event → series-at-venue → venue default → 0", async () => {
    const evt = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-01" });
    const [venue] = await db.insert(venues).values({ name: "Hall", address: "1 St" }).returning();
    await db.update(events).set({ venueId: venue!.id }).where(eq(events.id, evt.id));

    expect(await resolveEventRentCents(db, await eventRow(evt.id))).toBe(0); // nothing set

    await createVenueRent(db, { venueId: venue!.id, amount: 80, effectiveDate: "2026-01-01" });
    expect(await resolveEventRentCents(db, await eventRow(evt.id))).toBe(8000); // venue default

    await createVenueRent(db, {
      venueId: venue!.id,
      seriesKey: "tnc",
      amount: 60,
      effectiveDate: "2026-01-01",
    });
    expect(await resolveEventRentCents(db, await eventRow(evt.id))).toBe(6000); // series-at-venue wins

    await db.update(events).set({ rentCents: 10000 }).where(eq(events.id, evt.id));
    expect(await resolveEventRentCents(db, await eventRow(evt.id))).toBe(10000); // per-event wins

    await db.update(events).set({ rentCents: null }).where(eq(events.id, evt.id));
    expect(await resolveEventRentCents(db, await eventRow(evt.id))).toBe(6000); // back to series-at-venue
  });

  // Feature 084 (FR-029, SC-006, clarification Q2): a rent is changed by ADDING a newer dated row, so an
  // evening already reported keeps resolving exactly what it reported.
  it("leaves earlier events alone when a new rent is added from a date", async () => {
    const past = await makeEvent({ seriesKey: "tnc", eventDate: "2026-03-01" });
    const future = await makeEvent({ seriesKey: "tnc", eventDate: "2026-09-01" });
    const [venue] = await db.insert(venues).values({ name: "Hall3", address: "3 St" }).returning();
    await db.update(events).set({ venueId: venue!.id }).where(eq(events.id, past.id));
    await db.update(events).set({ venueId: venue!.id }).where(eq(events.id, future.id));
    await createVenueRent(db, { venueId: venue!.id, amount: 200, effectiveDate: "2026-01-01" });

    const before = await resolveEventRentCents(db, await eventRow(past.id));
    expect(before).toBe(20000);

    // The hall puts its price up from August.
    await createVenueRent(db, { venueId: venue!.id, amount: 300, effectiveDate: "2026-08-01" });

    expect(await resolveEventRentCents(db, await eventRow(past.id))).toBe(before);
    expect(await resolveEventRentCents(db, await eventRow(future.id))).toBe(30000);
  });

  it("resolves the venue default in effect on the event's own date", async () => {
    const early = await makeEvent({ seriesKey: "tnc", eventDate: "2026-02-01" });
    const late = await makeEvent({ seriesKey: "tnc", eventDate: "2026-08-01" });
    const [venue] = await db.insert(venues).values({ name: "Hall2", address: "2 St" }).returning();
    await db.update(events).set({ venueId: venue!.id }).where(eq(events.id, early.id));
    await db.update(events).set({ venueId: venue!.id }).where(eq(events.id, late.id));
    await createVenueRent(db, { venueId: venue!.id, amount: 80, effectiveDate: "2026-01-01" });
    await createVenueRent(db, { venueId: venue!.id, amount: 120, effectiveDate: "2026-07-01" });
    expect(await resolveEventRentCents(db, await eventRow(early.id))).toBe(8000);
    expect(await resolveEventRentCents(db, await eventRow(late.id))).toBe(12000);
  });
});
