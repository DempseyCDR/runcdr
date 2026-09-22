import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent } from "./helpers/factories";
import { venueRents, venues } from "@/server/db/schema";
import { POST as CREATE_RENT } from "@/app/api/venue-rents/route";
import { DELETE as DELETE_RENT } from "@/app/api/venue-rents/[id]/route";

// Feature 084 US5 (FR-029, FR-030, clarification Q2): a rent is CHANGED by adding a newer dated row, which
// is what the table has always done — so no report of a past event moves because of an edit made today.
// What is new is removing a row nothing has used yet: a mistake made a moment ago.

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

async function aVenue(name = "Grange Hall") {
  const [row] = await db.insert(venues).values({ name, address: "1 Main" }).returning();
  return row!;
}

const addRent = async (venueId: string, amount: number, effectiveDate: string) =>
  (
    await CREATE_RENT(
      jsonReq("POST", "/api/venue-rents", { venueId, amount, effectiveDate }),
      ctx(),
    )
  ).json();

const removeRent = (id: string) =>
  DELETE_RENT(jsonReq("DELETE", `/api/venue-rents/${id}`), ctx({ id }));

describe("removing a venue rent", () => {
  it("removes one nothing has used", async () => {
    const venue = await aVenue();
    const rent = await addRent(venue.id, 300, "2026-01-01");

    const res = await removeRent(rent.id);
    expect(res.status).toBe(204);
    expect(
      await db.query.venueRents.findFirst({ where: eq(venueRents.id, rent.id) }),
    ).toBeUndefined();
  });

  it("refuses one an event has used, naming what uses it (FR-030)", async () => {
    const venue = await aVenue();
    const rent = await addRent(venue.id, 250, "2024-01-01");
    await makeEvent({ eventDate: "2024-06-18", venueId: venue.id });

    const res = await removeRent(rent.id);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("STILL_IN_USE");
    expect(body.error.details.futureCount).toBeGreaterThan(0);
    // The row is untouched, so the report of that evening still resolves what it always did.
    expect(
      await db.query.venueRents.findFirst({ where: eq(venueRents.id, rent.id) }),
    ).toBeDefined();
  });

  it("leaves the previous rent applying once a mistaken one is removed", async () => {
    const venue = await aVenue();
    await addRent(venue.id, 250, "2020-01-01");
    const mistake = await addRent(venue.id, 2500, "2026-01-01");

    await removeRent(mistake.id);
    const left = await db.select().from(venueRents).where(eq(venueRents.venueId, venue.id));
    expect(left).toHaveLength(1);
    expect(left[0]!.amountCents).toBe(25000);
  });
});
