import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { bandMembers, bands, performers } from "@/server/db/schema";
import type { BandRow, PerformerRow } from "@/server/db/schema";
import { isStyleTag, type PromoLink } from "./promoLinks";

// Feature 053 (P7-R9): the single PII + visibility gate for the public performer roster. Every public read
// (the /performers page and — via `onPublicRoster` flags — the event lineup) resolves visibility HERE. The
// projection types carry no contact field, so a performer's email/phone can never reach a public surface: a
// renderer can only show what the projection provides (the same property R8 `publicVenues.ts` relies on).

export type PublicBandMember = { name: string; isLead: boolean; instrument: string | null };

export type PublicBand = {
  bandId: string;
  name: string;
  bio: string | null;
  photoUrl: string | null;
  styles: string[];
  links: PromoLink[];
  members: PublicBandMember[];
};

export type PublicCaller = {
  performerId: string;
  name: string;
  bio: string | null;
  photoUrl: string | null;
  styles: string[];
  links: PromoLink[];
};

/** A band is publicly exposable iff it is marked public AND not archived. */
export function isBandPublic(b: Pick<BandRow, "isPublic" | "archivedAt">): boolean {
  return b.isPublic && b.archivedAt === null;
}

/** A performer is a public caller iff it is marked public AND designated a caller. */
export function isCallerPublic(
  p: Pick<PerformerRow, "isPublic" | "isCaller" | "archivedAt">,
): boolean {
  return p.isPublic && p.isCaller && p.archivedAt === null;
}

async function loadPublicMembers(db: Db, bandId: string): Promise<PublicBandMember[]> {
  const rows = await db
    .select({
      name: performers.displayName,
      isLead: bandMembers.isLead,
      instrument: bandMembers.instrument,
    })
    .from(bandMembers)
    .innerJoin(performers, eq(performers.id, bandMembers.performerId))
    .where(eq(bandMembers.bandId, bandId))
    .orderBy(sql`${bandMembers.isLead} desc`, asc(performers.displayName));
  return rows;
}

/** Every publicly-exposable band (name-ordered); optional style filter (`style = ANY(styles)`). */
export async function listPublicBands(db: Db, style?: string): Promise<PublicBand[]> {
  const where = and(eq(bands.isPublic, true), isNull(bands.archivedAt));
  const rows = await db.select().from(bands).where(where).orderBy(asc(bands.name));
  const filtered = style && isStyleTag(style) ? rows.filter((b) => b.styles.includes(style)) : rows;
  const result: PublicBand[] = [];
  for (const b of filtered) {
    result.push({
      bandId: b.id,
      name: b.name,
      bio: b.bio,
      photoUrl: b.photoUrl,
      styles: b.styles,
      links: b.links,
      members: await loadPublicMembers(db, b.id),
    });
  }
  return result;
}

/** Every public caller (name-ordered); optional style filter. */
export async function listPublicCallers(db: Db, style?: string): Promise<PublicCaller[]> {
  // Feature 084 (FR-031): archived is never public, whatever `is_public` says — the rule `isBandPublic`
  // has always applied to bands. The flag is left alone, so restoring restores the listing.
  const where = and(
    eq(performers.isPublic, true),
    eq(performers.isCaller, true),
    isNull(performers.archivedAt),
  );
  const rows = await db.select().from(performers).where(where).orderBy(asc(performers.displayName));
  const filtered = style && isStyleTag(style) ? rows.filter((p) => p.styles.includes(style)) : rows;
  return filtered.map((p) => ({
    performerId: p.id,
    name: p.displayName,
    bio: p.bio,
    photoUrl: p.photoUrl,
    styles: p.styles,
    links: p.links,
  }));
}
