import { eq } from "drizzle-orm";
import { db } from "./db";
import { createEvent } from "@/server/domain/events/eventService";
import { createPerformer } from "@/server/domain/performers/performerService";
import { createDoorRecord } from "@/server/domain/door/doorRecordService";
import { deriveContactNames } from "@/server/domain/contacts/normalize";
import {
  membershipAccounts,
  membershipMembers,
  bands,
  contactEmails,
  contacts,
  events,
  gateSales,
  roleGrants,
  staffIdentities,
} from "@/server/db/schema";
import type { BandRow, EventRow, PerformerRow, Role, MembershipLevel } from "@/server/db/schema";
import { createSession } from "@/server/auth/session";
import type { GateCategory, PaymentMethod } from "@/server/db/schema";
import type { EmailConsentTopic, EmailStatus, MembershipStatus } from "@/server/db/schema";

export async function makeEvent(opts?: {
  seriesKey?: string;
  eventDate?: string;
  chargesAdmission?: boolean;
  groupId?: string;
  // Feature 040: createEvent never sets venue/rent, so apply them directly after create when a test needs a
  // deterministic rent + landlord for the treasurer report's rent bill.
  venueId?: string;
  rentCents?: number;
}): Promise<EventRow> {
  const row = await createEvent(db, {
    seriesKey: opts?.seriesKey ?? "tnc",
    eventDate: opts?.eventDate ?? "2026-06-18",
    chargesAdmission: opts?.chargesAdmission ?? true,
    ...(opts?.groupId ? { groupId: opts.groupId } : {}),
  });
  if (opts?.venueId === undefined && opts?.rentCents === undefined) return row;
  const [updated] = await db
    .update(events)
    .set({
      ...(opts.venueId !== undefined ? { venueId: opts.venueId } : {}),
      ...(opts.rentCents !== undefined ? { rentCents: opts.rentCents } : {}),
    })
    .where(eq(events.id, row.id))
    .returning();
  return updated ?? row;
}

/** Feature 041: insert a named band so a test can book musicians under it (via createBooking's bandId arg). */
export async function makeBand(name = "Test Band"): Promise<BandRow> {
  const [row] = await db.insert(bands).values({ name }).returning();
  if (!row) throw new Error("band insert failed");
  return row;
}

export async function makePerformer(displayName = "Test Performer"): Promise<PerformerRow> {
  // Feature 026: the create contract is structured (first/last). Split the convenience string on the last
  // space so existing tests keep their names AND now produce structured contacts (test-only heuristic).
  const trimmed = displayName.trim();
  const i = trimmed.lastIndexOf(" ");
  const firstName = i === -1 ? trimmed : trimmed.slice(0, i);
  const lastName = i === -1 ? undefined : trimmed.slice(i + 1);
  return createPerformer(db, { firstName, ...(lastName ? { lastName } : {}) });
}

/**
 * Insert-values for a contact created directly in a test (bypassing the API): the given name becomes
 * first_name (last blank) and fills the maintained display/normalized/dedup columns — so display,
 * search, and dedup behave exactly as they did before feature 012's structured names.
 */
export function contactRow(displayName: string): {
  firstName: string;
  displayName: string;
  nameNormalized: string;
  dedupNormalized: string;
} {
  return { firstName: displayName, ...deriveContactNames({ firstName: displayName }) };
}

/** Create a contact with a single email, for export-qualification tests. */
export async function makeContactWithEmail(opts: {
  /** Backward-compatible: used as firstName when firstName is not given. */
  displayName?: string;
  firstName?: string;
  lastName?: string;
  displayNameOverride?: string;
  email: string;
  consentTopics?: EmailConsentTopic[];
  emailStatus?: EmailStatus;
  listMember?: boolean;
  membershipStatus?: MembershipStatus;
  phone?: string;
}): Promise<{ contactId: string; emailId: string }> {
  const firstName = opts.firstName ?? opts.displayName ?? "Test Contact";
  const lastName = opts.lastName ?? null;
  const names = deriveContactNames({
    firstName,
    lastName,
    displayNameOverride: opts.displayNameOverride ?? null,
  });
  const [contact] = await db
    .insert(contacts)
    .values({
      firstName,
      lastName,
      displayNameOverride: opts.displayNameOverride ?? null,
      displayName: names.displayName,
      nameNormalized: names.nameNormalized,
      dedupNormalized: names.dedupNormalized,
      listMember: opts.listMember ?? false,
      membershipStatus: opts.membershipStatus ?? "never",
      phone: opts.phone ?? null,
    })
    .returning();
  if (!contact) throw new Error("contact insert failed");
  const [email] = await db
    .insert(contactEmails)
    .values({
      contactId: contact.id,
      email: opts.email,
      consentTopics: opts.consentTopics ?? ["contact_tracing"],
      status: opts.emailStatus ?? "active",
    })
    .returning();
  if (!email) throw new Error("email insert failed");
  return { contactId: contact.id, emailId: email.id };
}

/**
 * Create a volunteer contact with one active email — the shape staff sign-in requires (feature 015).
 *
 * Sign-in matches Google's verified email to an ACTIVE email on a contact with `is_volunteer`, so a
 * plain `makeContactWithEmail` contact can never sign in. `isLogin` is left false: the sign-in path
 * sets it on first success (FR-014).
 */
export async function makeVolunteerContact(opts: {
  firstName?: string;
  lastName?: string;
  email: string;
  emailStatus?: EmailStatus;
  /** Set false to build a contact that matches by email but is NOT eligible (FR-013 refusal). */
  isVolunteer?: boolean;
}): Promise<{ contactId: string; emailId: string }> {
  const { contactId, emailId } = await makeContactWithEmail({
    firstName: opts.firstName ?? "Vol",
    lastName: opts.lastName ?? "Unteer",
    email: opts.email,
    emailStatus: opts.emailStatus ?? "active",
  });
  await db
    .update(contacts)
    .set({ isVolunteer: opts.isVolunteer ?? true })
    .where(eq(contacts.id, contactId));
  return { contactId, emailId };
}

/**
 * Create a door record for an event and optionally seed gate sales (dollar amounts).
 *
 * Feature 082 (research R16): every sale is its own line, written through its own route. A test that only
 * needs a sale to EXIST should not have to drive a route for it, so they are inserted directly here. A
 * test of the sale routes themselves must of course call them (`tests/integration/gate.sales.test.ts`).
 */
export async function makeDoorRecord(
  eventId: string,
  sales: {
    category: Exclude<GateCategory, "admission">;
    paymentMethod: Exclude<PaymentMethod, "check">;
    amount: number;
    contactId?: string;
    membershipLevel?: MembershipLevel;
  }[] = [],
): Promise<string> {
  const dr = await createDoorRecord(db, eventId, "test");
  if (sales.length) {
    await db.insert(gateSales).values(
      sales.map((s) => ({
        doorRecordId: dr.id,
        category: s.category,
        paymentMethod: s.paymentMethod,
        amountCents: Math.round(s.amount * 100),
        contactId: s.contactId ?? null,
        membershipLevel: s.membershipLevel ?? null,
      })),
    );
  }
  return dr.id;
}

/**
 * A volunteer holding specific grants, plus a session token to act as them.
 *
 * Authorization tests MUST use this rather than the standing harness actor: `resetDb()` seeds
 * "Zztest Staff" a club-wide `super_user` (research R12), so asserting against it proves nothing —
 * it can do everything by construction. Pair with `jsonReqAs(token, ...)`.
 *
 * Scope is the shape of the grant: omit both ids for club-wide, pass `seriesId` for per-series, or
 * `groupId` for per-event-group (data-model.md §3).
 */
export async function makeActor(opts: {
  email: string;
  firstName?: string;
  lastName?: string;
  grants?: { role: Role; seriesId?: string | null; groupId?: string | null }[];
}): Promise<{ contactId: string; token: string }> {
  const { contactId } = await makeVolunteerContact({
    firstName: opts.firstName ?? "Actor",
    lastName: opts.lastName ?? "Test",
    email: opts.email,
  });

  await db
    .update(contactEmails)
    .set({ isLogin: true })
    .where(eq(contactEmails.contactId, contactId));

  for (const g of opts.grants ?? []) {
    await db.insert(roleGrants).values({
      contactId,
      role: g.role,
      seriesId: g.seriesId ?? null,
      groupId: g.groupId ?? null,
    });
  }

  const [identity] = await db
    .insert(staffIdentities)
    .values({ contactId, googleSub: `test-sub-${contactId}` })
    .returning();
  if (!identity) throw new Error("actor identity insert failed");

  const { token } = await createSession(db, identity.id);
  return { contactId, token };
}

/** A volunteer holding NO grants: the bare Organizer base. The lapsed short-term volunteer. */
export async function makeBaseActor(email: string): Promise<{ contactId: string; token: string }> {
  return makeActor({ email, firstName: "Base", lastName: "Only" });
}

/**
 * Feature 068: give a contact a membership ACCOUNT with a chosen expiry.
 *
 * Membership now follows ATTACHMENT (FR-011), not `contacts.list_member` — so a test that wants a member
 * must create the account rather than setting the cached columns. `expiryDate` is supplied directly (not
 * derived from a payment date) so tests can pin a year for the through-year column.
 */
export async function makeMembershipAccount(opts: {
  payerContactId: string;
  level?: MembershipLevel;
  expiryDate: string;
  members?: string[];
}): Promise<{ accountId: string }> {
  const [account] = await db
    .insert(membershipAccounts)
    .values({
      payerContactId: opts.payerContactId,
      level: opts.level ?? "individual",
      expiryDate: opts.expiryDate,
    })
    .returning();
  if (!account) throw new Error("account insert failed");
  const contactIds = [opts.payerContactId, ...(opts.members ?? [])];
  await db
    .insert(membershipMembers)
    .values(contactIds.map((contactId) => ({ accountId: account.id, contactId })));
  return { accountId: account.id };
}
