import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { attendance, contactEmails, contacts } from "@/server/db/schema";
import { withAuth } from "@/server/auth/withAuth";
import { searchContacts } from "@/server/domain/contacts/contactService";
import { canReadPii, recordPiiDisclosure } from "@/server/auth/pii";

/** Addresses that still reach a contact — the same set the email uniqueness index treats as owned. */
const REACHABLE = ["active", "transition"] as const;

export const GET = withAuth({ requires: "base" }, async (req, { actor }) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const eventId = url.searchParams.get("eventId");
  // Door roster: browse alphabetically by last name (feature 012, FR-007); a query ranks by similarity.
  const { items: matches, truncated } = await searchContacts(db, q, 20, { orderBy: "name" });
  const ids = matches.map((m) => m.id);
  if (ids.length === 0) return NextResponse.json({ items: [], truncated });

  // Feature 079 (FR-005): names are not PII, and the door shows them by feature 076's rule — the display
  // name, with first + last beneath a custom one — so every reader gets them.
  const names = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      displayNameOverride: contacts.displayNameOverride,
      messageRecipientEmailId: contacts.messageRecipientEmailId,
    })
    .from(contacts)
    .where(inArray(contacts.id, ids));
  const nameOf = new Map(names.map((n) => [n.id, n]));

  // Feature 079 (FR-007): the checkmark comes from the server, which sees every attendant's check-ins.
  const checkedIn = eventId
    ? new Set(
        (
          await db
            .select({ contactId: attendance.contactId })
            .from(attendance)
            .where(and(eq(attendance.eventId, eventId), inArray(attendance.contactId, ids)))
        ).map((r) => r.contactId),
      )
    : null;

  // Feature 067: who a household rider is reached through. The owner's NAME is not PII; the address is.
  const riddenIds = names.flatMap((n) =>
    n.messageRecipientEmailId ? [n.messageRecipientEmailId] : [],
  );
  const ridden = riddenIds.length
    ? await db
        .select({ id: contactEmails.id, email: contactEmails.email, owner: contacts.displayName })
        .from(contactEmails)
        .innerJoin(contacts, eq(contacts.id, contactEmails.contactId))
        .where(inArray(contactEmails.id, riddenIds))
    : [];
  const riddenById = new Map(ridden.map((r) => [r.id, r]));

  // FR-016/FR-017 — "matching a dancer": this lookup shows a match's PII to a holder (the Door
  // Attendant needs it to pick the right John Smith), and returns names-only to everyone else. The
  // checked-in ROSTER (a different endpoint) is names-only for all, by construction.
  const disclosing = canReadPii(actor);
  const byContact = new Map<string, string[]>();
  if (disclosing) {
    // Feature 079 (FR-006): reachable addresses only — never an inactive one — personal purpose first.
    const emails = await db
      .select({
        contactId: contactEmails.contactId,
        email: contactEmails.email,
        purposes: contactEmails.purposes,
        createdAt: contactEmails.createdAt,
      })
      .from(contactEmails)
      .where(
        and(inArray(contactEmails.contactId, ids), inArray(contactEmails.status, [...REACHABLE])),
      );
    emails.sort(
      (a, b) =>
        Number(b.purposes.includes("personal")) - Number(a.purposes.includes("personal")) ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
    for (const e of emails) {
      const list = byContact.get(e.contactId) ?? [];
      list.push(e.email);
      byContact.set(e.contactId, list);
    }
  }

  const items = matches.map((m) => {
    const n = nameOf.get(m.id);
    const via = n?.messageRecipientEmailId ? riddenById.get(n.messageRecipientEmailId) : undefined;
    return {
      ...m,
      firstName: n?.firstName ?? "",
      lastName: n?.lastName ?? null,
      displayNameOverride: n?.displayNameOverride ?? null,
      ...(checkedIn ? { checkedIn: checkedIn.has(m.id) } : {}),
      emails: byContact.get(m.id) ?? [],
      reachedVia: via
        ? { ownerDisplayName: via.owner, address: disclosing ? via.email : null }
        : null,
    };
  });
  // One row per request, counting contacts whose PII was disclosed (FR-017b) — never one per contact.
  if (disclosing) await recordPiiDisclosure(db, actor, "attendance.search", byContact.size);
  return NextResponse.json({ items, truncated });
});
