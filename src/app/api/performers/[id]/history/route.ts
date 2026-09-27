import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { performerHistory } from "@/server/domain/bookings/performerHistory";

// Feature 087 US3 (FR-019): a performer's dances, played and booked, newest first. `base` — the same
// reach as the bookings report it partly replaces; booking status and dates are not PII.
export const GET = withAuth<{ id: string }>({ requires: "base" }, async (_req, ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json({ items: await performerHistory(db, id) });
});
