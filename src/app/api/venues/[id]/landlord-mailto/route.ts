import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { withAuth } from "@/server/auth/withAuth";
import { getLandlordMailtoEmail } from "@/server/domain/venues/venueService";

// Feature 087: the landlord's mailto email is PII → gated by contact.pii.read, exactly as a performer's is
// (`/api/performers/{id}/mailto`). Returns { email: string | null }; null → the form shows the name alone.
export const GET = withAuth<{ id: string }>({ requires: "contact.pii.read" }, async (_req, ctx) => {
  const { id } = await ctx.params;
  const email = await getLandlordMailtoEmail(db, id);
  return NextResponse.json({ email });
});
