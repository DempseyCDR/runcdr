import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { parseBody } from "@/server/lib/parseBody";
import { paymentLineAddSchema } from "@/server/validation/payments";
import { addPaymentLine } from "@/server/domain/payments/performerPaymentService";

// Feature 081 (FR-013, research R4): add one booking to an existing check — "Add this booking to check #N".
export const POST = withAuth<{ id: string }>(
  { requires: "performer_payment.write" },
  async (req, ctx) => {
    const { id } = await ctx.params;
    const input = await parseBody(req, paymentLineAddSchema);
    const actor = req.headers.get("x-actor") ?? "admin";
    const payment = await addPaymentLine(db, id, input, actor, ctx.actor);
    return NextResponse.json(payment);
  },
);
