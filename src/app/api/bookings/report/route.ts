import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { errors } from "@/server/lib/apiError";
import { assembleBookingsReport } from "@/server/domain/bookings/reportService";
import { bookingsReportQuerySchema } from "@/server/validation/bookings";

// Feature 018 (B24): cross-event bookings report. `base` — any authenticated staff may read it (booking
// status/pay are not PII; the public site is separate and confirmed-only). Read-only planning view.
//
// Feature 087: Booking Central's read — one page plus the next cursor. The caller, band and musician
// filters and the ascending sort are retired (FR-001b), so those parameters are not read at all.
//
// Feature 091 (contracts/report-api.md): the read pages both ways from a SPLIT date — `older` before it,
// `newer` on and after it — and 087's horizon is retired the same way. The query is validated (research
// R8): a malformed one answers 422, logged by the request wrapper, instead of being half-honoured.
export const GET = withAuth({ requires: "base" }, async (req) => {
  // The schema reads only its own keys, so a retired `horizon` (or anything else) is simply ignored.
  const query = bookingsReportQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!query.success) {
    throw errors.validation(
      query.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return NextResponse.json(await assembleBookingsReport(db, query.data));
});
