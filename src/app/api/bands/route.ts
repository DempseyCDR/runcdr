import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { parseBody } from "@/server/lib/parseBody";
import { bandCreateSchema } from "@/server/validation/bands";
import { createBand, listBands } from "@/server/domain/bands/bandService";

export const GET = withAuth({ requires: "base" }, async (req) => {
  const params = new URL(req.url).searchParams;
  const q = params.get("q");
  // FR-012: an archived band is found again by asking for it.
  const includeArchived = params.get("archived") === "1";
  // Feature 084 (FR-007): one past the limit says whether the page is seeing the whole answer. With no
  // query the roster comes back whole — the booking flows read it that way (analysis F1).
  const LIMIT = 20;
  if (q === null)
    return NextResponse.json({
      items: await listBands(db, "", undefined, includeArchived),
      truncated: false,
    });
  const found = await listBands(db, q, LIMIT + 1, includeArchived);
  const truncated = found.length > LIMIT;
  return NextResponse.json({ items: truncated ? found.slice(0, LIMIT) : found, truncated });
});

export const POST = withAuth({ requires: "performer.write" }, async (req) => {
  const input = await parseBody(req, bandCreateSchema);
  const actor = req.headers.get("x-actor") ?? "admin";
  const band = await createBand(db, input, actor);
  return NextResponse.json(band, { status: 201 });
});
