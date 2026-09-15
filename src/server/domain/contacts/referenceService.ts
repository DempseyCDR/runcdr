import { and, eq, inArray } from "drizzle-orm";
import type { Db, DbOrTx, Tx } from "@/server/db/client";
import { contactEmails, contacts } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { recordAudit } from "@/server/lib/audit";
import type { MessageRecipientInput } from "@/server/validation/contacts";

/** Statuses at which an owned address is still reachable, and so still shareable. */
const REACHABLE = ["active", "transition"] as const;

/**
 * Feature 067 (M-R23): shared / family emails.
 *
 * An email is OWNED by exactly one contact. Another household member REFERENCES it as their message
 * recipient via `contacts.message_recipient_email_id`. The pointer lives on `contacts`, so active-email
 * uniqueness, the feature-015 sign-in match and `is_login` stay owner-only by construction (M-R24/M-R25)
 * — this module never touches `contact_emails` except to retire a row the caller is replacing.
 */
export async function linkMessageRecipient(
  db: Db,
  contactId: string,
  input: MessageRecipientInput,
  actor: string | null,
): Promise<void> {
  await db.transaction((tx) => linkMessageRecipientIn(tx, contactId, input, actor));
}

/**
 * The same link, inside a transaction the caller already holds — feature 079's door check-in creates the
 * contact, links it and checks it in as one unit, so a refused check-in leaves no half-made contact behind.
 * Every rule and the audit are the ones above; only the transaction boundary moves.
 */
export async function linkMessageRecipientIn(
  tx: Tx,
  contactId: string,
  input: MessageRecipientInput,
  actor: string | null,
): Promise<void> {
  const contact = await tx.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
  if (!contact) throw errors.contactNotFound();

  const target = await tx.query.contactEmails.findFirst({
    where: eq(contactEmails.id, input.emailId),
  });
  if (!target) throw errors.emailNotFound();
  // A contact cannot ride its own address (FR-003).
  if (target.contactId === contactId) throw errors.referenceSelf();
  // A dead address is not worth pointing at (FR-014).
  if (!REACHABLE.includes(target.status as (typeof REACHABLE)[number])) {
    throw errors.referenceTargetNotActive();
  }

  // The address-edit path replaces this contact's own address with the household one: retire the row
  // being edited BEFORE the ownership check, so the edit path links cleanly while a contact with an
  // unrelated working address is still refused (FR-017).
  if (input.retireEmailId) {
    const own = await tx.query.contactEmails.findFirst({
      where: eq(contactEmails.id, input.retireEmailId),
    });
    if (!own || own.contactId !== contactId) throw errors.emailNotFound();
    await tx
      .update(contactEmails)
      .set({ status: "inactive", updatedAt: new Date() })
      .where(eq(contactEmails.id, input.retireEmailId));
  }

  // A contact with a working address of its own is not a referrer (FR-002/FR-017).
  const ownActive = await tx
    .select({ id: contactEmails.id })
    .from(contactEmails)
    .where(
      and(eq(contactEmails.contactId, contactId), inArray(contactEmails.status, [...REACHABLE])),
    )
    .limit(1);
  if (ownActive.length > 0) throw errors.referrerOwnsEmail();

  if (contact.messageRecipientEmailId === input.emailId) return; // idempotent

  await tx
    .update(contacts)
    .set({ messageRecipientEmailId: input.emailId, updatedAt: new Date() })
    .where(eq(contacts.id, contactId));

  await recordAudit(tx, {
    kind: "contact.reference.linked",
    actorContactId: actor,
    details: { contactId, emailId: input.emailId, ownerContactId: target.contactId },
  });
}

/**
 * End a reference (FR-015). Deliberate, so it does NOT set `needs_review` — that flag is reserved for
 * the involuntary case where the referenced address goes away underneath the contact (FR-012).
 */
export async function unlinkMessageRecipient(
  db: Db,
  contactId: string,
  actor: string | null,
): Promise<void> {
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
  if (!contact) throw errors.contactNotFound();
  if (contact.messageRecipientEmailId === null) return; // no-op

  await db
    .update(contacts)
    .set({ messageRecipientEmailId: null, updatedAt: new Date() })
    .where(eq(contacts.id, contactId));

  await recordAudit(db, {
    kind: "contact.reference.unlinked",
    actorContactId: actor,
    details: { contactId, emailId: contact.messageRecipientEmailId },
  });
}

/**
 * The referenced address has gone away — removed or merely deactivated (FR-012).
 *
 * The FK's ON DELETE SET NULL covers the hard-delete case structurally, but it cannot flag anyone, and
 * deactivation is not a delete at all. So every referrer is cleared here AND flagged `needs_review`, so
 * a working address gets re-captured rather than the contact silently becoming unreachable.
 */
export async function clearReferencesTo(
  db: DbOrTx,
  emailId: string,
  reason: "deactivated" | "deleted",
  actor: string | null = null,
): Promise<number> {
  const cleared = await db
    .update(contacts)
    .set({ messageRecipientEmailId: null, needsReview: true, updatedAt: new Date() })
    .where(eq(contacts.messageRecipientEmailId, emailId))
    .returning({ id: contacts.id });

  if (cleared.length > 0) {
    await recordAudit(db, {
      kind: "contact.reference.cleared",
      actorContactId: actor,
      details: { emailId, reason, contactIds: cleared.map((c) => c.id) },
    });
  }
  return cleared.length;
}

/**
 * The mirror case (FR-011): this contact just acquired an address of its own, so it is no longer a
 * referrer. Clearing is silent — gaining an address is an improvement, not a problem to review.
 */
export async function clearOwnReference(db: DbOrTx, contactId: string): Promise<void> {
  await db
    .update(contacts)
    .set({ messageRecipientEmailId: null, updatedAt: new Date() })
    .where(eq(contacts.id, contactId));
}

/**
 * The OWNER contact itself is being deleted (feature 065), taking its emails with it via cascade.
 *
 * The FK would null the referrers' pointers on its own, but silently — and a household that quietly
 * becomes unreachable is exactly what FR-012 exists to prevent. So clear and flag them here, before the
 * row disappears and there is nothing left to match on.
 */
export async function clearReferencesToOwner(
  db: DbOrTx,
  ownerContactId: string,
  actor: string | null = null,
): Promise<number> {
  const owned = await db
    .select({ id: contactEmails.id })
    .from(contactEmails)
    .where(eq(contactEmails.contactId, ownerContactId));

  let cleared = 0;
  for (const e of owned) cleared += await clearReferencesTo(db, e.id, "deleted", actor);
  return cleared;
}
