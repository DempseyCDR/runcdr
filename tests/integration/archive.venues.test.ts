import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent } from "./helpers/factories";
import { events, venues } from "@/server/db/schema";
import { listVenues } from "@/server/domain/venues/venueService";
import { listPublicVenues } from "@/server/domain/public/publicVenues";
import { GET as LIST } from "@/app/api/venues/route";
import { POST as ARCHIVE } from "@/app/api/venues/[id]/archive/route";
import { POST as RESTORE } from "@/app/api/venues/[id]/restore/route";

// Feature 084 US3 (FR-010 to FR-014): a hall that closes stops being offered for new events, keeps the
// dates already booked in it, and is never deleted.

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

async function aVenue(name = "Grange Hall") {
  const [row] = await db
    .insert(venues)
    .values({ name, address: "1 Main", isPublic: true })
    .returning();
  return row!;
}

const archive = (id: string, body: unknown = {}) =>
  ARCHIVE(jsonReq("POST", `/api/venues/${id}/archive`, body), ctx({ id }));
const restore = (id: string) => RESTORE(jsonReq("POST", `/api/venues/${id}/restore`), ctx({ id }));

describe("archiving a venue", () => {
  it("stops offering it, and says so in the record", async () => {
    const venue = await aVenue();
    const res = await archive(venue.id);
    expect(res.status).toBe(200);

    const row = await db.query.venues.findFirst({ where: eq(venues.id, venue.id) });
    expect(row!.archivedAt).not.toBeNull();
    expect((await listVenues(db)).map((v) => v.id)).not.toContain(venue.id);
    expect((await listPublicVenues(db)).map((v) => v.name)).not.toContain(venue.name);
  });

  it("leaves a past event still naming it (FR-011)", async () => {
    const venue = await aVenue();
    const event = await makeEvent({ eventDate: "2024-06-18", venueId: venue.id });
    await archive(venue.id);

    const row = await db.query.events.findFirst({ where: eq(events.id, event.id) });
    expect(row!.venueId).toBe(venue.id);
    // The venue itself is still there to be named — archiving deletes nothing (FR-013).
    expect(await db.query.venues.findFirst({ where: eq(venues.id, venue.id) })).toBeDefined();
  });

  it("warns before retiring one with events still to come, then proceeds (FR-014)", async () => {
    const venue = await aVenue();
    const soon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    await makeEvent({ eventDate: soon, venueId: venue.id });

    const refused = await archive(venue.id);
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.error.code).toBe("STILL_IN_USE");
    expect(body.error.details.futureCount).toBe(1);
    expect(body.error.details.nextDate).toBe(soon);
    expect(
      (await db.query.venues.findFirst({ where: eq(venues.id, venue.id) }))!.archivedAt,
    ).toBeNull();

    const confirmed = await archive(venue.id, { confirm: true });
    expect(confirmed.status).toBe(200);
    expect(
      (await db.query.venues.findFirst({ where: eq(venues.id, venue.id) }))!.archivedAt,
    ).not.toBeNull();
  });

  // FR-012: without this, archiving is a one-way door — the hall vanishes from the list and nothing in
  // the app can bring it back.
  it("is found again by asking for archived ones (FR-012)", async () => {
    const venue = await aVenue();
    await archive(venue.id);

    const plain = await (await LIST(jsonReq("GET", "/api/venues"), ctx())).json();
    expect(plain.items.map((v: { id: string }) => v.id)).not.toContain(venue.id);

    const withArchived = await (await LIST(jsonReq("GET", "/api/venues?archived=1"), ctx())).json();
    expect(withArchived.items.map((v: { id: string }) => v.id)).toContain(venue.id);
  });

  it("is a no-op when already archived, and is undone by restore (FR-012, FR-013)", async () => {
    const venue = await aVenue();
    await archive(venue.id);
    const again = await archive(venue.id);
    expect(again.status).toBe(200);

    expect((await restore(venue.id)).status).toBe(200);
    const row = await db.query.venues.findFirst({ where: eq(venues.id, venue.id) });
    expect(row!.archivedAt).toBeNull();
    expect((await listVenues(db)).map((v) => v.id)).toContain(venue.id);
    // FR-031's sibling: the public flag was never touched, so the listing comes back with it.
    expect((await listPublicVenues(db)).map((v) => v.name)).toContain(venue.name);
  });
});
