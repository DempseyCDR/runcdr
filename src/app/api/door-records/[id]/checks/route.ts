import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { parseBody } from "@/server/lib/parseBody";
import { gateCheckCreateSchema } from "@/server/validation/door";
import { createGateCheck } from "@/server/domain/door/gateCheckService";

// Feature 082 (FR-014–FR-017, FR-025): a check received, with its lines — recorded on its own, from the
// door or the gate. Layer 1 asks for `attendance.write`; the service checks the event's scope, and marking
// a check to be banked on its own needs `gate.write` (FR-021).
export const POST = withAuth<{ id: string }>({ requires: "attendance.write" }, async (req, ctx) => {
  const { id } = await ctx.params;
  const input = await parseBody(req, gateCheckCreateSchema);
  const { check, enrolled } = await createGateCheck(db, id, input, ctx.actor);
  return NextResponse.json({ ...check, enrolled }, { status: 201 });
});
