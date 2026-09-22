import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { linkSuggestions } from "@/server/domain/performers/linkSuggestions";

/**
 * Contacts who might be this performer (feature 084, FR-022).
 *
 * `performer.write` because this exists to settle an unlinked performer, which only an editor does — and
 * because the answer names contacts, which is the directory's business rather than everyone's.
 */
export const GET = withAuth<{ id: string }>({ requires: "performer.write" }, async (_req, ctx) => {
  const { id } = await ctx.params;
  return NextResponse.json({ items: await linkSuggestions(db, id) });
});
