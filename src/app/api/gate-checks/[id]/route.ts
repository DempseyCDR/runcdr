import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { parseBody } from "@/server/lib/parseBody";
import { gateCheckPatchSchema } from "@/server/validation/door";
import { deleteGateCheck, patchGateCheck } from "@/server/domain/door/gateCheckService";

// Feature 082 (FR-023, research R6): a check is corrected and removed on its own. The door may change what
// it recorded; anyone else's needs `gate.write` (NOT_YOUR_ENTRY), as does the deposit-separately mark.
export const PATCH = withAuth<{ id: string }>(
  { requires: "attendance.write" },
  async (req, ctx) => {
    const { id } = await ctx.params;
    const input = await parseBody(req, gateCheckPatchSchema);
    const { check, enrolled } = await patchGateCheck(db, id, input, ctx.actor);
    return NextResponse.json({ ...check, enrolled });
  },
);

export const DELETE = withAuth<{ id: string }>(
  { requires: "attendance.write" },
  async (_req, ctx) => {
    const { id } = await ctx.params;
    await deleteGateCheck(db, id, ctx.actor);
    return new NextResponse(null, { status: 204 });
  },
);
