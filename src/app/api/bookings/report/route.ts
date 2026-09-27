import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { assembleBookingsReport } from "@/server/domain/bookings/reportService";

// Feature 018 (B24): cross-event bookings report. `base` — any authenticated staff may read it (booking
// status/pay are not PII; the public site is separate and confirmed-only). Read-only planning view.
//
// Feature 087: Booking Central's read. It takes the series, a HORIZON (the upper bound — the page passes
// today + 4 months by default, FR-001a) and a cursor, and answers one page plus the next cursor. The
// caller, band and musician filters and the ascending sort are retired (FR-001b), so those parameters are
// no longer read at all rather than silently half-honoured.
const MAX_PAGE = 200;

export const GET = withAuth({ requires: "base" }, async (req) => {
  const p = new URL(req.url).searchParams;
  const limitParam = Number(p.get("limit"));
  const report = await assembleBookingsReport(db, {
    series: p.get("series") ?? undefined,
    horizon: p.get("horizon") ?? undefined,
    cursor: p.get("cursor") ?? undefined,
    ...(Number.isInteger(limitParam) && limitParam > 0
      ? { limit: Math.min(limitParam, MAX_PAGE) }
      : {}),
  });
  return NextResponse.json(report);
});
