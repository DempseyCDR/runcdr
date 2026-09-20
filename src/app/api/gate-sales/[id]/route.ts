import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { parseBody } from "@/server/lib/parseBody";
import { gateSalePatchSchema } from "@/server/validation/door";
import { deleteGateSale, patchGateSale } from "@/server/domain/door/gateSaleService";

// Feature 082 (research R6): the door may correct or remove what it recorded; anyone else's needs
// `gate.write`, which the service checks against who recorded the sale (NOT_YOUR_ENTRY).
export const PATCH = withAuth<{ id: string }>(
  { requires: "attendance.write" },
  async (req, ctx) => {
    const { id } = await ctx.params;
    const input = await parseBody(req, gateSalePatchSchema);
    const { sale, enrolled } = await patchGateSale(db, id, input, ctx.actor);
    return NextResponse.json({ ...sale, enrolled });
  },
);

export const DELETE = withAuth<{ id: string }>(
  { requires: "attendance.write" },
  async (_req, ctx) => {
    const { id } = await ctx.params;
    await deleteGateSale(db, id, ctx.actor);
    return new NextResponse(null, { status: 204 });
  },
);
