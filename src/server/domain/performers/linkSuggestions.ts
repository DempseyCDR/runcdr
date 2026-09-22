import { eq, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { performers } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { normalizeName } from "@/server/domain/contacts/normalize";

/** A contact who might be this performer, and how alike the two names are. */
export type LinkSuggestion = { id: string; displayName: string; similarity: number };

/**
 * The same threshold the duplicate queue pairs on (`suggestionService`). Measured on the live pair that
 * motivated this: the performer "Clara Reidlinger" scores **0.619** against the contact "Clara
 * Riedlinger", where the next candidate scores 0.240 — so 0.4 separates them with room to spare.
 */
const THRESHOLD = 0.4;

/**
 * Feature 084 US4 (FR-021, FR-022): the contacts most likely to BE this performer, best first.
 *
 * Why not `matchPerformers`: it compares `normalizeName(displayName)` to `dedup_normalized` for exact
 * equality, so a transposition — "Reidlinger" for "Riedlinger" — finds nothing, and the Booker is left
 * with "create a contact", which makes a duplicate of the person they were looking for (research R5).
 * Trigram similarity is what the duplicate queue already uses to judge whether two names are one person;
 * this asks the same question of a performer and a contact.
 *
 * A merged or archived contact is never offered — the rule `matchPerformers` already follows, for the
 * same reason: a retired shell keeps its survivor's `dedup_normalized`, so offering it would suggest the
 * wrong row for the right person.
 */
export async function linkSuggestions(
  db: Db,
  performerId: string,
  limit = 5,
): Promise<LinkSuggestion[]> {
  const performer = await db.query.performers.findFirst({
    where: eq(performers.id, performerId),
  });
  if (!performer) throw errors.performerNotFound();

  const needle = normalizeName(performer.displayName);
  if (!needle) return [];

  const rows = await db.execute<{ id: string; display_name: string; sim: number }>(sql`
    SELECT c.id, c.display_name, similarity(c.dedup_normalized, ${needle}) AS sim
    FROM contacts c
    WHERE c.merged_into_id IS NULL
      AND c.archived_at IS NULL
      AND similarity(c.dedup_normalized, ${needle}) >= ${THRESHOLD}
    ORDER BY sim DESC, c.display_name ASC
    LIMIT ${limit}`);

  return [...rows].map((r) => ({
    id: r.id,
    displayName: r.display_name,
    similarity: Number(r.sim),
  }));
}
