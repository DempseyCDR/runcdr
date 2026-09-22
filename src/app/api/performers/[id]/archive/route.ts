import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { errors } from "@/server/lib/apiError";
import {
  archivePerformer,
  getPerformer,
  performerStillInUse,
} from "@/server/domain/performers/performerService";

/**
 * Retire a performer (feature 084, FR-010, FR-014, FR-031).
 *
 * Bookings to come are a warning, not a refusal. Archiving takes them off the roster, the pickers and the
 * public site; every booking they ever played still names them, and their public flag is untouched so a
 * restore brings the listing back.
 */
export const POST = withAuth<{ id: string }>({ requires: "performer.write" }, async (req, ctx) => {
  const { id } = await ctx.params;
  const performer = await getPerformer(db, id);
  const body = await req.json().catch(() => ({}));
  if (!body?.confirm) {
    const inUse = await performerStillInUse(db, id);
    if (inUse.futureCount > 0) throw errors.stillInUse(performer.displayName, inUse);
  }
  await archivePerformer(db, id, req.headers.get("x-actor") ?? "admin");
  return NextResponse.json({ ok: true });
});
