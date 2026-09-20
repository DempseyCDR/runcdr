import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { ensureDoorRecord } from "@/server/domain/door/doorRecordService";
import { doorRecordPayload, mayRecordGateMoney } from "@/server/domain/door/doorRecordPayload";

// Idempotent "open the door record" for an event: create if absent, else fetch (FR-015).
export const POST = withAuth<{ id: string }>({ requires: "attendance.write" }, async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = req.headers.get("x-actor") ?? "door";
  const row = await ensureDoorRecord(db, id, actor);
  // Feature 082 (contracts/gate.md): the evening's money worked out, the sales, and the checks.
  const withFee = await mayRecordGateMoney(db, ctx.actor, row.id);
  return NextResponse.json(await doorRecordPayload(db, row.id, { withFee }));
});
