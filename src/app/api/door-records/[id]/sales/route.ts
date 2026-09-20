import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { parseBody } from "@/server/lib/parseBody";
import { gateSaleCreateSchema } from "@/server/validation/door";
import { createGateSale } from "@/server/domain/door/gateSaleService";

// Feature 082 (FR-024/FR-026): one named sale, recorded on its own — from the door or the gate.
// Layer 1 asks for `attendance.write`, which the door and everyone holding `gate.write` both hold; the
// service checks it against the event's scope (research R6).
export const POST = withAuth<{ id: string }>({ requires: "attendance.write" }, async (req, ctx) => {
  const { id } = await ctx.params;
  const input = await parseBody(req, gateSaleCreateSchema);
  const { sale, enrolled } = await createGateSale(db, id, input, ctx.actor);
  return NextResponse.json({ ...sale, enrolled }, { status: 201 });
});
