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
  // Feature 084 (FR-007): fetch one past the limit to tell the page it is seeing only part of the answer
  // — the shape `searchContacts` has used since feature 062.
  const LIMIT = 20;
  // Feature 084 (FR-012): "include archived" is how a retired record is found again to restore it.
  const includeArchived = params.get("archived") === "1";
  if (q === null) {
    // No query: the whole roster, ordered. `bookings`, `bands` and `bookings-report` all read this, so it
    // stays (analysis F1); the performers PAGE is what must not browse (FR-005).
    return NextResponse.json({
      items: await listPerformers(db, includeArchived),
      truncated: false,
    });
  }
  const found = await searchPerformers(db, q, LIMIT + 1, eventId, includeArchived);
  const truncated = found.length > LIMIT;
  return NextResponse.json({ items: truncated ? found.slice(0, LIMIT) : found, truncated });
});

export const POST = withAuth({ requires: "performer.write" }, async (req) => {
  const input = await parseBody(req, performerCreateSchema);
  const performer = await createPerformer(db, input);
  return NextResponse.json(performer, { status: 201 });
});
