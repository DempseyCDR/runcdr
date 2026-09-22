import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { errors } from "@/server/lib/apiError";
import { archiveVenue, getVenue, venueStillInUse } from "@/server/domain/venues/venueService";

/**
 * Retire a venue (feature 084, FR-010, FR-014).
 *
 * A hall with dates still booked in it is a WARNING, not a refusal: without `confirm` the answer is 409
 * carrying the count and the next date, so the form can ask; with it, archiving proceeds and those events
 * keep naming the venue.
 */
export const POST = withAuth<{ id: string }>({ requires: "venue.write" }, async (req, ctx) => {
  const { id } = await ctx.params;
  const venue = await getVenue(db, id);
  const body = await req.json().catch(() => ({}));
  if (!body?.confirm) {
    const inUse = await venueStillInUse(db, id);
    if (inUse.futureCount > 0) throw errors.stillInUse(venue.name, inUse);
  }
  await archiveVenue(db, id, req.headers.get("x-actor") ?? "admin");
  return NextResponse.json({ ok: true });
});
