import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { errors } from "@/server/lib/apiError";
import { listUnpaidEarlierBookings } from "@/server/domain/payments/unpaidBookings";

// Feature 081 (FR-035, FR-036): a performer's unpaid bookings from the 90 days before `forEvent`, for the
// payments page's "Pay an earlier booking". Only for someone who may pay, and only in the series they pay for.
export const GET = withAuth<{ id: string }>(
  { requires: "performer_payment.write" },
  async (req, ctx) => {
    const { id } = await ctx.params;
    const forEvent = new URL(req.url).searchParams.get("forEvent");
    if (!forEvent) throw errors.validation("forEvent is required.");
    const bookings = await listUnpaidEarlierBookings(db, id, forEvent, ctx.actor);
    return NextResponse.json({ bookings });
  },
);
