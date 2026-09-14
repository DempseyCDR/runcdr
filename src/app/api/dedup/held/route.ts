import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { errors } from "@/server/lib/apiError";
import { canAnswerHold, canSeeHolds, listHeldMerges } from "@/server/domain/dedup/heldMergeService";

// Feature 069 (FR-014): held merges feed the needs-review queue, which therefore renders two kinds of
// task. Resolving one is gated separately, by the authority the hold's reason demands.
//
// Feature 078 (FR-005a, research R11): SEEING a hold needs duplicate-management OR role-assigning
// authority. A President holds only role-assigning, and this route used to require `dedup.write` — so a
// President saw no holds at all. `withAuth` takes a single capability, hence `base` plus `canSeeHolds`.
export const GET = withAuth({ requires: "base" }, async (_req, ctx) => {
  if (!canSeeHolds(ctx.actor)) throw errors.unauthorized("dedup.write");
  const held = await listHeldMerges(db);
  // `canAnswer` is computed here, for this actor, so the queue never keeps its own copy of the rules.
  return NextResponse.json({
    held: held.map((h) => ({ ...h, canAnswer: canAnswerHold(ctx.actor, h.reason) })),
  });
});
