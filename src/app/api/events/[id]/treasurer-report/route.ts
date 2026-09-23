import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { assembleTreasurerReport } from "@/server/domain/treasurer/reportService";

// Feature 086 (FR-006): narrowed from `base`. Every signed-in volunteer could open the assembled report,
// which was never intended — the raw door-record figures stay open (016 FR-015), the whole evening's
// money in one document does not. NOT scope-asserted: the club's two Financial Secretaries cover for each
// other, so confining the read by series would refuse a fill-in (FR-006c).
export const GET = withAuth<{ id: string }>(
  { requires: "treasurer_report.read" },
  async (req, ctx) => {
    const { id } = await ctx.params;
    const actor = req.headers.get("x-actor") ?? "treasurer";
    const report = await assembleTreasurerReport(db, id, actor);
    return NextResponse.json(report);
  },
);
