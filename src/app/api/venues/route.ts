import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { parseBody } from "@/server/lib/parseBody";
import { venueCreateSchema } from "@/server/validation/venues";
import { createVenue, listVenues } from "@/server/domain/venues/venueService";

export const GET = withAuth({ requires: "base" }, async (req) => {
  // Feature 084 (FR-012): "include archived" is how a hall retired by mistake is found again and put
  // back — without it, archiving would be a one-way door.
  const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
  const items = await listVenues(db, includeArchived);
  return NextResponse.json({ items });
});

export const POST = withAuth({ requires: "venue.write" }, async (req) => {
  const input = await parseBody(req, venueCreateSchema);
  const actor = req.headers.get("x-actor") ?? "admin";
  const venue = await createVenue(db, input, actor);
  return NextResponse.json(venue, { status: 201 });
});
