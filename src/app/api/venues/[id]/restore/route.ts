import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { restoreVenue } from "@/server/domain/venues/venueService";

/** Put an archived venue back on offer (feature 084, FR-012). A no-op when it is already active. */
export const POST = withAuth<{ id: string }>({ requires: "venue.write" }, async (req, ctx) => {
  const { id } = await ctx.params;
  await restoreVenue(db, id, req.headers.get("x-actor") ?? "admin");
  return NextResponse.json({ ok: true });
});
