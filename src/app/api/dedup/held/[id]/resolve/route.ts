import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { errors } from "@/server/lib/apiError";
import { parseBody } from "@/server/lib/parseBody";
import { heldResolveSchema } from "@/server/validation/dedup";
import {
  authorityFor,
  canAnswerHold,
  canSeeHolds,
  getOpenHold,
  resolveHeldMerge,
  SUPER_USER_INSTRUCTION,
} from "@/server/domain/dedup/heldMergeService";

/**
 * Feature 069 (FR-012/FR-013). The authority follows the REASON, not the route: choosing which sign-in
 * identity survives is a role decision (`role.assign` — VP, President, Super-user), while choosing which
 * membership account survives is ordinary duplicate work. So the route requires the capability every
 * holder shares, then checks the reason's own authority once the hold is loaded — which is the earliest
 * point at which the required authority is known.
 */
export const POST = withAuth<{ id: string }>({ requires: "base" }, async (req, ctx) => {
  // Feature 078 (FR-005a): reachable by anyone who can see holds — a President holds only role-assigning
  // authority, which is exactly what sign-in, role and volunteer holds need.
  if (!canSeeHolds(ctx.actor)) throw errors.unauthorized("dedup.write");
  const { id } = await ctx.params;
  const input = await parseBody(req, heldResolveSchema);
  const hold = await getOpenHold(db, id);

  const required = authorityFor(hold.reason);
  if (!canAnswerHold(ctx.actor, hold.reason)) {
    throw required === "command_line"
      ? errors.heldMergeNotAnswerable(SUPER_USER_INSTRUCTION)
      : errors.unauthorized(required);
  }

  const outcome = await resolveHeldMerge(db, id, input, ctx.staff.contactId);
  return NextResponse.json(outcome);
});
