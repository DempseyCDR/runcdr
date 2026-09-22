import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { venues, type VenueRow } from "@/server/db/schema";
import { venueMapUrl } from "./venueMap";

// Feature 052 (P7-R8): the single privacy gate for public venue exposure. A venue's address, map link, and
// directions are shown publicly ONLY when it is public AND has an address; otherwise the public projection is
// NAME-ONLY. The nullable fields carry the gate into the type — a renderer can only show what the projection
// provides, so a private-home address can never reach a public surface. Both public surfaces (the /directions
// page via `listPublicVenues`, and the event page via `getPublicEventDetail`) go through here.

export type PublicVenue = {
  name: string;
  address: string | null;
  mapUrl: string | null;
  directions: string | null;
};

/** A venue is publicly exposable iff it is marked public AND has a (non-empty) address. */
export function isPubliclyExposable(v: Pick<VenueRow, "isPublic" | "address">): boolean {
  return v.isPublic && v.address.trim() !== "";
}

/** The public projection of a venue: full block when exposable, else name-only. */
export function publicVenueView(v: VenueRow): PublicVenue {
  if (isPubliclyExposable(v)) {
    return { name: v.name, address: v.address, mapUrl: venueMapUrl(v), directions: v.directions };
  }
  return { name: v.name, address: null, mapUrl: null, directions: null };
}

/** The public directions directory: every publicly-exposable venue (name/address/map/directions), by name. */
export async function listPublicVenues(db: Db): Promise<PublicVenue[]> {
  const rows = await db
    .select()
    .from(venues)
    // Feature 084 (FR-010): archived is never public, whatever the flag says — the rule bands follows.
    .where(and(eq(venues.isPublic, true), isNull(venues.archivedAt)))
    .orderBy(asc(venues.name));
  return rows
    .filter((v) => v.address.trim() !== "") // defend against placeholder/address-less rows
    .map((v) => ({
      name: v.name,
      address: v.address,
      mapUrl: venueMapUrl(v),
      directions: v.directions,
    }));
}
