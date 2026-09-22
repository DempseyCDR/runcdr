import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { restorePerformer } from "@/server/domain/performers/performerService";

/** Put an archived performer back on the roster (feature 084, FR-012). */
export const POST = withAuth<{ id: string }>({ requires: "performer.write" }, async (req, ctx) => {
  const { id } = await ctx.params;
  await restorePerformer(db, id, req.headers.get("x-actor") ?? "admin");
  return NextResponse.json({ ok: true });
});
