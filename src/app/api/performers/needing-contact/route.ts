import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { performersNeedingContact } from "@/server/domain/performers/needContact";

/**
 * Feature 087 US5 (FR-026): the performers with no contact, or a retired one — counted for the hub. Names
 * only, as every performer read is, so any volunteer may ask; settling one still needs `performer.write`.
 */
export const GET = withAuth({ requires: "base" }, async () => {
  return NextResponse.json(await performersNeedingContact(db));
});
