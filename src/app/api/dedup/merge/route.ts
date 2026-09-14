import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { parseBody } from "@/server/lib/parseBody";
import { mergeSchema } from "@/server/validation/dedup";
import { mergeContacts } from "@/server/domain/dedup/mergeService";

export const POST = withAuth({ requires: "dedup.write" }, async (req, ctx) => {
  const input = await parseBody(req, mergeSchema);
  // The outcome is discriminated (`completed` / `held`): a merge that cannot complete is HELD with
  // nothing written, rather than surfacing a raw unique-violation from the database.
  //
  // Feature 072: a collision is no longer resolvable inline here. Feature 069 accepted a surviving login
  // address on this route, but acting on it only moved a LABEL — the account binding that actually grants
  // access was never touched (FR-012a). Every resolution now goes through
  // `POST /api/dedup/held/{id}/resolve`, which is gated by the authority its reason demands and settles
  // the binding and the label together. Feature 078 put that route behind the held-merge chooser, and
  // added two reasons a merge is held: volunteer status, and super-user (which no one answers in the app).
  const outcome = await mergeContacts(db, input.canonicalId, input.mergedId, ctx.staff.contactId);
  return NextResponse.json(outcome);
});
