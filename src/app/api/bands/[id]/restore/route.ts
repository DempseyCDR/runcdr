import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { restoreBand } from "@/server/domain/bands/bandService";

/**
 * Put an archived band back (feature 084, FR-012, research R1).
 *
 * Bands could be archived since feature 008 and never un-archived — the one thing the pattern was missing.
 */
export const POST = withAuth<{ id: string }>({ requires: "performer.write" }, async (req, ctx) => {
  const { id } = await ctx.params;
  await restoreBand(db, id, req.headers.get("x-actor") ?? "admin");
  return NextResponse.json({ ok: true });
});
