import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { parseBody } from "@/server/lib/parseBody";
import { performerCreateSchema } from "@/server/validation/performers";
import {
  createPerformer,
  listPerformers,
  searchPerformers,
} from "@/server/domain/performers/performerService";

// Feature 020 US2: `?q=` narrows to matching performers (typeahead); omitted → the full list.
export const GET = withAuth({ requires: "base" }, async (req) => {
  const params = new URL(req.url).searchParams;
  const q = params.get("q");
  // Feature 081: `&eventId=` marks who is already booked on that event (the Add dialog).
  const eventId = params.get("eventId") ?? undefined;
  const items = q !== null ? await searchPerformers(db, q, 20, eventId) : await listPerformers(db);
  return NextResponse.json({ items });
});

export const POST = withAuth({ requires: "performer.write" }, async (req) => {
  const input = await parseBody(req, performerCreateSchema);
  const performer = await createPerformer(db, input);
  return NextResponse.json(performer, { status: 201 });
});
