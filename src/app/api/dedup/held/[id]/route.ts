import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { errors } from "@/server/lib/apiError";
import {
  abandonHeldMerge,
  canSeeHolds,
  getHeldMergeDetail,
} from "@/server/domain/dedup/heldMergeService";

/**
 * Feature 072 (FR-017): withdraw a held merge.
 *
 * Gated on `dedup.write` — the authority to merge — not on the reason's own authority. Resolving a hold
 * answers its question and needs the standing to answer it; abandoning declines to ask, changes nothing,
 * and must be available to whoever raised it. Otherwise the queue fills with items the person working it
 * cannot clear.
 */
export const DELETE = withAuth<{ id: string }>({ requires: "base" }, async (_req, ctx) => {
  // Feature 078 (FR-005a): declining is open to anyone who can see holds — a President included.
  if (!canSeeHolds(ctx.actor)) throw errors.unauthorized("dedup.write");
  const { id } = await ctx.params;
  await abandonHeldMerge(db, id, ctx.staff.contactId);
  return NextResponse.json({ ok: true });
});

/**
 * Feature 078 (FR-001): open a held merge — its question as it stands now, and whether this actor may
 * answer it. Visible to anyone who can see holds (FR-005a), a President included.
 */
export const GET = withAuth<{ id: string }>({ requires: "base" }, async (_req, ctx) => {
  if (!canSeeHolds(ctx.actor)) throw errors.unauthorized("dedup.write");
  const { id } = await ctx.params;
  return NextResponse.json(await getHeldMergeDetail(db, id, ctx.actor));
});
