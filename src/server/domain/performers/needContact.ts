import { and, asc, eq, isNotNull, isNull, or } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { contacts, performers } from "@/server/db/schema";

/**
 * Why a performer needs a contact: none at all (B57), or one that has been retired (B58). Merged is named
 * before archived — a merged contact points at its survivor, which is usually the answer.
 */
export type NeedContactReason = "none" | "archived" | "merged";

export type PerformerNeedingContact = {
  id: string;
  displayName: string;
  reason: NeedContactReason;
};

/** The reason a linked contact no longer serves, or null while it does. */
export function retiredReason(contact: {
  mergedIntoId: string | null;
  archivedAt: Date | null;
}): Exclude<NeedContactReason, "none"> | null {
  if (contact.mergedIntoId) return "merged";
  if (contact.archivedAt) return "archived";
  return null;
}

/**
 * Feature 087 US5 (FR-026, FR-027): the performers the Booker cannot reach — with no contact, or with one
 * that has been archived or merged away. One list, because it is one piece of work: settle the link.
 *
 * An ARCHIVED performer is left out. They are retired; their link is nobody's work.
 */
export async function performersNeedingContact(
  db: Db,
): Promise<{ count: number; items: PerformerNeedingContact[] }> {
  const rows = await db
    .select({
      id: performers.id,
      displayName: performers.displayName,
      contactId: performers.contactId,
      mergedIntoId: contacts.mergedIntoId,
      archivedAt: contacts.archivedAt,
    })
    .from(performers)
    .leftJoin(contacts, eq(contacts.id, performers.contactId))
    .where(
      and(
        isNull(performers.archivedAt),
        or(
          isNull(performers.contactId),
          isNotNull(contacts.mergedIntoId),
          isNotNull(contacts.archivedAt),
        ),
      ),
    )
    .orderBy(asc(performers.displayName));
  const items = rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    reason: r.contactId ? (retiredReason(r) ?? "none") : ("none" as const),
  }));
  return { count: items.length, items };
}
