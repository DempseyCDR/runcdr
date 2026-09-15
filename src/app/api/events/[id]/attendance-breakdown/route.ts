import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { getAttendanceBreakdown } from "@/server/domain/attendance/breakdownService";

/**
 * Feature 079 (FR-027, research R13): an event's attendance breakdown, for the door's checked-in dialog and
 * the gate page. Counts and performer names only — nothing here is contact detail — so any signed-in
 * volunteer may read it, like the roster and the treasurer report beside it.
 */
export const GET = withAuth<{ id: string }>({ requires: "base" }, async (_req, ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json(await getAttendanceBreakdown(db, id));
});
