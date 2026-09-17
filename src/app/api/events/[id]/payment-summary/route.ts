import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { getPaymentSummary } from "@/server/domain/payments/paymentSummary";

/**
 * Feature 081 (FR-005, research R10): an event's performer-pay summary, for the gate page. Money is open to
 * every volunteer (feature 016), so reading it is `base`, like the payments list it summarises.
 */
export const GET = withAuth<{ id: string }>({ requires: "base" }, async (_req, ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json(await getPaymentSummary(db, id));
});
