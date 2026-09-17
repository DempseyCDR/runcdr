import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { listEventRoles } from "@/server/domain/bookings/bookingService";

// Feature 081 (FR-023, research R12): the roles an event's series allows, each at its standard rate that day,
// for the payments page's Add dialog. Rates are not secret, so reading them is `base`.
export const GET = withAuth<{ id: string }>({ requires: "base" }, async (_req, ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json({ roles: await listEventRoles(db, id) });
});
