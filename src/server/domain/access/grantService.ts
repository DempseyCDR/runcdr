import { and, eq, isNull } from "drizzle-orm";
import type { Db, DbOrTx } from "@/server/db/client";
import { contacts, eventGroups, roleGrants, series } from "@/server/db/schema";
import type { Role, RoleGrantRow } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { recordAudit } from "@/server/lib/audit";

/**
 * Role assignment (feature 016, US2) — the President/VP's job.
 *
 * This is where the dormant feature-001 substrate finally gets a UI writer: designating volunteers and
 * granting them scoped roles. It lives in `domain/` rather than `auth/` because ASSIGNING authority is
 * a business capability with its own rules (FR-005a exclusivity, FR-028b's cascade), whereas
 * EVALUATING authority (`auth/can.ts`) is cross-cutting infrastructure. Enforcing and granting are
 * different jobs.
 */

/**
 * The three offices that may not combine: authority (President/VP) must not sit with money (Treasurer).
 *
 * Exported since feature 072 so a MERGE can check the same set. This is a cross-row invariant with no
 * constraint behind it, so a merge relinking grants in SQL would otherwise break it silently — and the
 * merge must not carry its own copy of the list, or the two could disagree.
 */
export const EXCLUSIVE_ROLES: readonly Role[] = ["president", "vice_president", "treasurer"];

export type GrantInput = {
  subjectContactId: string;
  role: Role;
  /** Scope: omit both for club-wide, one of seriesKey/groupId for scoped. */
  seriesKey?: string;
  groupId?: string;
  /** The officer issuing it, or null for the operator CLI. */
  grantedBy: string | null;
};

export type GrantResult = {
  grant: RoleGrantRow;
  /** FR-029a: a soft warning (not a refusal) — e.g. an FS grant to a sitting President concentrates duties. */
  warning?: string;
};

/** Assert FR-005a: the subject does not already hold a DIFFERENT one of the exclusive three. */
async function assertExclusivity(db: DbOrTx, subjectContactId: string, role: Role): Promise<void> {
  if (!EXCLUSIVE_ROLES.includes(role)) return;
  const held = await db
    .select({ role: roleGrants.role })
    .from(roleGrants)
    .where(eq(roleGrants.contactId, subjectContactId));
  const conflict = held.find((h) => EXCLUSIVE_ROLES.includes(h.role) && h.role !== role);
  if (conflict) throw errors.exclusiveRoleConflict(conflict.role);
}

/** Does the subject hold President or VP right now? Used for the FS-concentration warning (FR-029b). */
async function holdsAuthorityOffice(db: DbOrTx, subjectContactId: string): Promise<boolean> {
  const rows = await db
    .select({ role: roleGrants.role })
    .from(roleGrants)
    .where(eq(roleGrants.contactId, subjectContactId));
  return rows.some((r) => r.role === "president" || r.role === "vice_president");
}

/**
 * Grant one role at one scope. Enforces, in order:
 * - FR-030a: `super_user` is NOT grantable here — only the CLI creates one.
 * - R3: the subject must be a volunteer (the retired roles_require_volunteer, re-expressed).
 * - FR-005a: President/VP/Treasurer mutual exclusivity.
 *
 * `allowSuperUser` is the CLI's escape hatch (bootstrapOfficer), never exposed to a route.
 */
export async function grantRole(
  db: DbOrTx,
  input: GrantInput,
  opts: { allowSuperUser?: boolean } = {},
): Promise<GrantResult> {
  if (input.role === "super_user" && !opts.allowSuperUser) {
    throw errors.roleNotUiGrantable("super_user");
  }

  const subject = await db.query.contacts.findFirst({
    where: eq(contacts.id, input.subjectContactId),
  });
  if (!subject) throw errors.contactNotFound();
  if (!subject.isVolunteer) throw errors.grantRequiresVolunteer();

  await assertExclusivity(db, input.subjectContactId, input.role);

  // Resolve scope to ids. seriesKey/groupId are mutually exclusive by construction (the CHECK enforces
  // it too); club-wide is both null.
  let seriesId: string | null = null;
  if (input.seriesKey) {
    const s = await db.query.series.findFirst({ where: eq(series.key, input.seriesKey) });
    if (!s) throw errors.seriesNotFound();
    seriesId = s.id;
  }
  let groupId: string | null = null;
  if (input.groupId) {
    const g = await db.query.eventGroups.findFirst({ where: eq(eventGroups.id, input.groupId) });
    if (!g) throw errors.eventGroupNotFound();
    groupId = g.id;
  }

  // FR-029a/b: FS to a sitting President/VP is permitted (not blocked) but warned and surfaced.
  const warning =
    input.role === "financial_secretary" && (await holdsAuthorityOffice(db, input.subjectContactId))
      ? "This contact holds an authority office (President/VP). Granting Financial Secretary " +
        "concentrates role-assignment and money in one person; it will be flagged on the annual review."
      : undefined;

  return db.transaction(async (tx) => {
    const [grant] = await tx
      .insert(roleGrants)
      .values({
        contactId: input.subjectContactId,
        role: input.role,
        seriesId,
        groupId,
        grantedBy: input.grantedBy,
      })
      .onConflictDoNothing()
      .returning();
    // onConflictDoNothing → idempotent re-grant returns the existing row.
    const row =
      grant ??
      (await tx.query.roleGrants.findFirst({
        where: and(
          eq(roleGrants.contactId, input.subjectContactId),
          eq(roleGrants.role, input.role),
          seriesId ? eq(roleGrants.seriesId, seriesId) : isNull(roleGrants.seriesId),
          groupId ? eq(roleGrants.groupId, groupId) : isNull(roleGrants.groupId),
        ),
      }));
    if (!row) throw new Error("grant insert failed");
    if (grant) {
      await recordAudit(tx, {
        kind: "authz.grant.created",
        actorContactId: input.grantedBy,
        details: { subject: input.subjectContactId, role: input.role, seriesId, groupId },
      });
    }
    return { grant: row, warning };
  });
}

/** Revoke one grant by id. Idempotent-ish: a missing grant is a 404. */
export async function revokeRole(db: Db, grantId: string, revokedBy: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(roleGrants).where(eq(roleGrants.id, grantId)).returning();
    if (!row) throw errors.grantNotFound();
    await recordAudit(tx, {
      kind: "authz.grant.revoked",
      actorContactId: revokedBy,
      details: {
        subject: row.contactId,
        role: row.role,
        seriesId: row.seriesId,
        groupId: row.groupId,
      },
    });
  });
}

/** Designate a contact as a volunteer — eligibility to sign in (FR-028). */
export async function designateVolunteer(
  db: Db,
  contactId: string,
  by: string | null,
): Promise<void> {
  const subject = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
  if (!subject) throw errors.contactNotFound();
  if (subject.isVolunteer) return; // idempotent
  await db.transaction(async (tx) => {
    await tx.update(contacts).set({ isVolunteer: true }).where(eq(contacts.id, contactId));
    await recordAudit(tx, {
      kind: "volunteer.designated",
      actorContactId: by,
      details: { subject: contactId },
    });
  });
}

/** The grants a clear WOULD revoke — for report-then-confirm (FR-028a). UI reads this before clearing. */
export async function grantsForContact(db: Db, contactId: string): Promise<RoleGrantRow[]> {
  return db.select().from(roleGrants).where(eq(roleGrants.contactId, contactId));
}

/**
 * Clear a volunteer's designation, cascading: revoke ALL their grants in ONE transaction (FR-028b).
 *
 * The atomicity is the requirement, not a nicety (R3): if the clear succeeded but a revoke failed, the
 * orphaned grants would linger, and re-designating that person later would SILENTLY restore their old
 * authority — exactly what FR-028b forbids. Report-then-confirm (FR-028a) is the UI's job; this is the
 * guarantee behind it. Returns what was revoked, for the audit/UI.
 */
export async function clearVolunteer(
  db: Db,
  contactId: string,
  by: string | null,
): Promise<RoleGrantRow[]> {
  const subject = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
  if (!subject) throw errors.contactNotFound();

  return db.transaction(async (tx) => {
    const revoked = await tx
      .delete(roleGrants)
      .where(eq(roleGrants.contactId, contactId))
      .returning();
    await tx.update(contacts).set({ isVolunteer: false }).where(eq(contacts.id, contactId));
    for (const g of revoked) {
      await recordAudit(tx, {
        kind: "authz.grant.revoked",
        actorContactId: by,
        details: {
          subject: contactId,
          role: g.role,
          seriesId: g.seriesId,
          groupId: g.groupId,
          reason: "volunteer cleared",
        },
      });
    }
    await recordAudit(tx, {
      kind: "volunteer.cleared",
      actorContactId: by,
      details: { subject: contactId, revokedGrants: revoked.length },
    });
    return revoked;
  });
}

/**
 * Record the President/VP's annual approval of a volunteer (FR-035).
 *
 * ⚠️ ADVISORY ONLY (FR-037). This writes columns nothing on the session path reads — a volunteer whose
 * approval lapses keeps every scrap of access. That is deliberate: reading these on sign-in would turn a
 * governance ritual into a club-wide lockout on a forgotten meeting.
 */
export async function approveVolunteer(db: Db, contactId: string, by: string): Promise<void> {
  const subject = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
  if (!subject) throw errors.contactNotFound();
  if (!subject.isVolunteer) throw errors.grantRequiresVolunteer();
  await db.transaction(async (tx) => {
    await tx
      .update(contacts)
      .set({ volunteerApprovedAt: new Date(), volunteerApprovedBy: by })
      .where(eq(contacts.id, contactId));
    await recordAudit(tx, {
      kind: "volunteer.approved",
      actorContactId: by,
      details: { subject: contactId },
    });
  });
}

export type VolunteerRow = {
  contactId: string;
  displayName: string;
  grants: {
    id: string;
    role: Role;
    seriesId: string | null;
    groupId: string | null;
    /**
     * Feature 086 (FR-007): what the grant actually COVERS, not just its identifier. The screen used to
     * print the bare words "series-scoped" because an id is all it had — so two Bookers at two series
     * looked identical, and the club concluded a volunteer could hold only one. Null for a club-wide or
     * group-scoped grant, which is a different thing from a series with no name.
     */
    seriesKey: string | null;
    seriesName: string | null;
  }[];
  approvedAt: Date | null;
  /** FR-036: approval is null or older than a year. Advisory flag for the screen. */
  overdue: boolean;
  /** FR-029b: holds an authority office AND Financial Secretary — a standing concentration. */
  concentrationOfDuties: boolean;
};

/** Every volunteer with their grants, the overdue flag, and the FS-concentration flag (FR-031, FR-036). */
export async function listVolunteers(db: Db): Promise<VolunteerRow[]> {
  const vols = await db
    .select({
      contactId: contacts.id,
      displayName: contacts.displayName,
      approvedAt: contacts.volunteerApprovedAt,
    })
    .from(contacts)
    // Feature 076 (close-out §2b): only ACTIVE contacts. Without this a contact merged away still showed as a
    // volunteer with no roles — its grants had moved to the survivor — and an archived one lingered too.
    // The same predicate 071 added at session read and 072 added at sign-in enrolment; this read path was
    // the one left behind.
    .where(
      and(
        eq(contacts.isVolunteer, true),
        isNull(contacts.mergedIntoId),
        isNull(contacts.archivedAt),
      ),
    );

  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  const out: VolunteerRow[] = [];
  for (const v of vols) {
    const grants = await db
      .select({
        id: roleGrants.id,
        role: roleGrants.role,
        seriesId: roleGrants.seriesId,
        groupId: roleGrants.groupId,
        seriesKey: series.key,
        seriesName: series.name,
      })
      .from(roleGrants)
      .leftJoin(series, eq(series.id, roleGrants.seriesId))
      .where(eq(roleGrants.contactId, v.contactId));
    const hasAuthority = grants.some((g) => g.role === "president" || g.role === "vice_president");
    const hasFs = grants.some((g) => g.role === "financial_secretary");
    out.push({
      contactId: v.contactId,
      displayName: v.displayName,
      grants,
      approvedAt: v.approvedAt,
      overdue: v.approvedAt === null || v.approvedAt < yearAgo,
      concentrationOfDuties: hasAuthority && hasFs,
    });
  }
  return out;
}
