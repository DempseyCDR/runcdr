import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { errors } from "@/server/lib/apiError";
import { deleteVenueRent, venueRentInUse } from "@/server/domain/parameters/rentService";

/**
 * Remove a venue rent (feature 084, FR-030).
 *
 * Only one nothing has used: a figure typed wrongly a moment ago. Where an event has already resolved it,
 * the answer is 409 naming what uses it, and the correction is a NEWER rent from a date (FR-029) — so no
 * report of a past evening moves because of an edit made today.
 */
export const DELETE = withAuth<{ id: string }>({ requires: "venue.write" }, async (req, ctx) => {
  const { id } = await ctx.params;
  const inUse = await venueRentInUse(db, id);
  if (inUse.futureCount > 0) throw errors.stillInUse("That rent", inUse);
  await deleteVenueRent(db, id, req.headers.get("x-actor") ?? "admin");
  return new NextResponse(null, { status: 204 });
});
