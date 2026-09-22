import { and, eq, ilike, isNull } from "drizzle-orm";
import type { Db, DbOrTx } from "@/server/db/client";
import { bandMembers, bands, performers } from "@/server/db/schema";
import type { BandRow } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { writeAudit } from "@/server/lib/audit";
import type { BandCreateInput, BandPatchInput } from "@/server/validation/bands";

export type BandMemberView = {
  performerId: string;
  performerName: string;
  isLead: boolean;
  instrument: string | null; // feature 053 (P7-R9): optional, shown on roster/lineup
};
export type BandWithRoster = BandRow & { members: BandMemberView[] };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Verify every performerId exists; throws performerNotFound if any is unknown. */
async function assertPerformersExist(tx: Tx, performerIds: string[]): Promise<void> {
  for (const id of performerIds) {
    const p = await tx.query.performers.findFirst({ where: eq(performers.id, id) });
    if (!p) throw errors.performerNotFound();
  }
}

async function insertRoster(
  tx: Tx,
  bandId: string,
  members: { performerId: string; isLead: boolean; instrument?: string | null }[],
): Promise<void> {
  await assertPerformersExist(
    tx,
    members.map((m) => m.performerId),
  );
  await tx.insert(bandMembers).values(
    members.map((m) => ({
      bandId,
      performerId: m.performerId,
      isLead: m.isLead,
      instrument: m.instrument ?? null, // feature 053 (P7-R9)
    })),
  );
}

async function loadRoster(db: Db, bandId: string): Promise<BandMemberView[]> {
  const rows = await db
    .select({
      performerId: bandMembers.performerId,
      performerName: performers.displayName,
      isLead: bandMembers.isLead,
      instrument: bandMembers.instrument,
    })
    .from(bandMembers)
    .innerJoin(performers, eq(performers.id, bandMembers.performerId))
    .where(eq(bandMembers.bandId, bandId));
  return rows;
}

export async function createBand(
  db: Db,
  input: BandCreateInput,
  actor: string | null = null,
): Promise<BandWithRoster> {
  const band = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(bands)
      .values({
        name: input.name,
        bio: input.bio ?? null,
        photoUrl: input.photoUrl ?? null,
        // Feature 053 (P7-R9): public roster fields.
        ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
        ...(input.styles !== undefined ? { styles: input.styles } : {}),
        ...(input.links !== undefined ? { links: input.links } : {}),
      })
      .returning();
    if (!row) throw new Error("band insert failed");
    await insertRoster(tx, row.id, input.members);
    return row;
  });
  writeAudit({ kind: "band.created", actor, details: { bandId: band.id, name: band.name } });
  return { ...band, members: await loadRoster(db, band.id) };
}

export type BandSummary = {
  id: string;
  name: string;
  memberCount: number;
  leadPerformerName: string | null;
};

/**
 * Active (non-archived) bands with a small summary for the directory/pick list.
 *
 * Feature 084 (FR-005 to FR-007): `q` narrows by name — the bands page searches rather than listing a
 * roster. LIKE metacharacters are escaped so a stray `%` matches literally, as `searchPerformers` does.
 * With no `q` the whole roster comes back, because the booking flows read it that way (analysis F1).
 */
export async function listBands(
  db: Db,
  q = "",
  limit?: number,
  includeArchived = false,
): Promise<BandSummary[]> {
  const needle = q.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await db
    .select()
    .from(bands)
    .where(
      and(
        needle ? ilike(bands.name, `%${needle}%`) : undefined,
        includeArchived ? undefined : isNull(bands.archivedAt),
      ),
    )
    .orderBy(bands.name)
    .limit(limit ?? 1000);
  const summaries: BandSummary[] = [];
  for (const b of rows) {
    const roster = await loadRoster(db, b.id);
    summaries.push({
      id: b.id,
      name: b.name,
      memberCount: roster.length,
      leadPerformerName: roster.find((m) => m.isLead)?.performerName ?? null,
    });
  }
  return summaries;
}

export async function getBand(db: Db, id: string): Promise<BandWithRoster> {
  const band = await db.query.bands.findFirst({ where: eq(bands.id, id) });
  if (!band) throw errors.bandNotFound();
  return { ...band, members: await loadRoster(db, id) };
}

export async function patchBand(
  db: Db,
  id: string,
  input: BandPatchInput,
  actor: string | null = null,
): Promise<BandWithRoster> {
  const existing = await db.query.bands.findFirst({ where: eq(bands.id, id) });
  if (!existing) throw errors.bandNotFound();

  await db.transaction(async (tx) => {
    await tx
      .update(bands)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.bio !== undefined ? { bio: input.bio } : {}),
        ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl } : {}),
        // Feature 053 (P7-R9): public roster fields.
        ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
        ...(input.styles !== undefined ? { styles: input.styles } : {}),
        ...(input.links !== undefined ? { links: input.links } : {}),
        updatedAt: new Date(),
      })
      .where(eq(bands.id, id));

    if (input.members !== undefined) {
      // Roster replace — scoped to band_members only; never touches bookings.band_id.
      await tx.delete(bandMembers).where(eq(bandMembers.bandId, id));
      await insertRoster(tx, id, input.members);
    }
  });

  writeAudit({ kind: "band.updated", actor, details: { bandId: id } });
  return getBand(db, id);
}

/** Soft-delete: sets archived_at. No-op if already archived. Never alters performers/bookings. */
export async function archiveBand(db: Db, id: string, actor: string | null = null): Promise<void> {
  const existing = await db.query.bands.findFirst({ where: eq(bands.id, id) });
  if (!existing) throw errors.bandNotFound();
  if (!existing.archivedAt) {
    await db
      .update(bands)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(bands.id, id));
    writeAudit({ kind: "band.deleted", actor, details: { bandId: id } });
  }
}

/**
 * Feature 084 (FR-012, research R1): put an archived band back. Archiving has existed since feature 008
 * with no way to undo it — the gap this feature closes for all three records.
 */
export async function restoreBand(db: Db, id: string, actor: string | null = null): Promise<void> {
  const existing = await db.query.bands.findFirst({ where: eq(bands.id, id) });
  if (!existing) throw errors.bandNotFound();
  if (existing.archivedAt) {
    await db.update(bands).set({ archivedAt: null, updatedAt: new Date() }).where(eq(bands.id, id));
    writeAudit({ kind: "band.restored", actor, details: { bandId: id } });
  }
}

/** Current roster (performerId + isLead) for booking — active or not (past events can re-book). */
export async function getRoster(
  db: DbOrTx,
  bandId: string,
): Promise<{ performerId: string; isLead: boolean }[]> {
  return db
    .select({ performerId: bandMembers.performerId, isLead: bandMembers.isLead })
    .from(bandMembers)
    .where(eq(bandMembers.bandId, bandId));
}
