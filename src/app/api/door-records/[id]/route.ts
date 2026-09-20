import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { parseBody } from "@/server/lib/parseBody";
import { doorRecordPatchSchema } from "@/server/validation/door";
import { updateDoorRecord } from "@/server/domain/door/doorRecordService";
import {
  doorRecordPayload,
  gateWarnings,
  mayRecordGateMoney,
} from "@/server/domain/door/doorRecordPayload";

export const GET = withAuth<{ id: string }>({ requires: "base" }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const withFee = await mayRecordGateMoney(db, ctx.actor, id);
  return NextResponse.json(await doorRecordPayload(db, id, { withFee }));
});

export const PATCH = withAuth<{ id: string }>({ requires: "gate.write" }, async (req, ctx) => {
  const { id } = await ctx.params;
  const input = await parseBody(req, doorRecordPatchSchema);
  const actor = req.headers.get("x-actor") ?? "door";
  await updateDoorRecord(db, id, input, actor, ctx.actor);
  // Feature 082 (contracts/gate.md, FR-007): the saved evening worked out, and what looks wrong in it.
  // Only `gate.write` reaches here, so the fee is always included.
  const { doorRecord } = await doorRecordPayload(db, id, { withFee: true });
  return NextResponse.json({ ...doorRecord, warnings: gateWarnings(doorRecord) });
});
