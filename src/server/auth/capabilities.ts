import type { Role } from "@/server/db/schema";

/**
 * The capability catalog (feature 016) — role × capability × scope.
 *
 * A capability is a thing a person may DO to a resource, not a page. Pages are where capabilities are
 * used; the split is what makes matrix rows 2, 12 and 17/17a expressible, because one record is
 * written by different roles for different reasons (an event's blurb vs. its date; a door record's
 * money vs. its comp counts; a contact's emails vs. the record itself).
 *
 * `.read` appears ONLY where reading is not universal. Under FR-015 the Organizer base reads
 * everything except contact PII, so an `event.read` capability would be a constant `true` pretending
 * to be a decision. The two exceptions are `contact.pii.read` and `export.read`.
 *
 * Lives in code, not the database: a capability means something only because a handler checks it. A
 * DB-driven catalog would let an officer grant a capability no code implements — an admin surface
 * whose only power is to lie.
 */
export type Capability =
  | "event.write"
  | "event.public.write"
  | "venue.write"
  | "performer.write"
  | "booking.write"
  | "parameter.write"
  | "attendance.write"
  | "gate.write"
  | "performer_payment.write"
  | "treasurer_report.write"
  // Feature 086 (FR-006): reading the gate report is its own capability. It existed as `base` — every
  // signed-in volunteer could read the evening's money, which was never intended — and a WRITE capability
  // cannot stand in, because the Financial Secretary who records the money does not hold it. Holding
  // `treasurer_report.write` does not imply this; both are granted explicitly.
  | "treasurer_report.read"
  | "contact.write"
  | "contact.mailing.write"
  | "contact.pii.read"
  | "dedup.write"
  // Feature 065 (M-R11/M-R12): permanent contact deletion. `contact.delete` is the SAFE delete (removes
  // only a bare record); `contact.delete.unrestricted` bypasses the bare-record guard. Distinct catalog
  // capabilities, not inline `role === super_user` checks.
  | "contact.delete"
  | "contact.delete.unrestricted"
  | "membership.write"
  | "export.read"
  | "mailing_list.write"
  | "role.assign"
  | "club_settings.write"
  | "volunteer.approve"
  // Feature 051 (P7-R7): edit/publish public content pages (the Webmaster's CMS). Webmaster-only, like
  // `event.public.write` — the VP delegates via the role rather than inheriting it.
  | "content.write"
  // The generated route index (FR-040b). A capability rather than an inline `role === 'super_user'`
  // check: a second authorization mechanism beside this catalog is exactly the coupling the feature
  // exists to remove, and it would be the one place roles were inlined at a call site.
  | "dev.routes.read";

/**
 * What a route declares.
 *
 * `'base'` means "any authenticated volunteer, per FR-015" — no catalog lookup, allow. It is
 * deliberately NOT a Capability and never appears below: adding `event.read` to every role's map would
 * be that constant `true`, and would imply the Organizer base is grantable, hence revocable, which
 * FR-001 does not contemplate.
 *
 * It is mandatory rather than omittable because a route that declares nothing is indistinguishable
 * from one where someone forgot — which is exactly what the route-inventory guard exists to catch.
 */
export type Requirement = Capability | "base";

/**
 * `scoped` honours the grant's own series/group filters. `global` confers the capability everywhere,
 * regardless of the grant's own scope.
 */
export type ScopeMode = "scoped" | "global";

type Catalog = Record<Role, Partial<Record<Capability, ScopeMode>>>;

/** Every capability of the Financial Secretary. Spelt out so Treasurer ⊇ FS is mechanical, below. */
const FS_CAPABILITIES = {
  gate: "gate.write",
  payments: "performer_payment.write",
  // Feature 019 (B28): the FS pays performers and enters substitute payees, so they must also correct the
  // performer directory (fix a name, add an unknown substitute) — not only the Booker. Directory-wide, as
  // `performer.write` has no create-only variant; the club accepts that (FS/Treasurer own performer money).
  performer: "performer.write",
  attendance: "attendance.write",
  contact: "contact.write",
  membership: "membership.write",
  pii: "contact.pii.read",
} as const;

/**
 * role → capability → scope mode.
 *
 * The three supersets (FR-012) are FLATTENED here rather than resolved at runtime: Treasurer ⊇ FS,
 * VP ⊇ President, Super-user ⊇ everything. So the evaluator has no notion of role hierarchy at all,
 * which matches FR-004 ("authority is the union") and means a superset cannot drift out of sync with
 * the role it supersets — the map IS the relationship.
 *
 * `Role` and `Capability` are string-literal unions, so this object is exhaustively checked: a role
 * missing from the map is a compile error, not a silent deny.
 */
export const CAPABILITIES: Catalog = {
  // ⬡ club-wide (FR-038). Check-in is the job; the gate is NOT — but that is expressed by `gate.write`
  // simply being ABSENT here, never by a deny. See can().
  door_attendant: {
    "attendance.write": "global",
    "contact.write": "global", // creates contacts at check-in (row 17)
    "contact.pii.read": "global", // matching a dancer: needs it to pick the right John Smith
  },

  // ⬤ per-series. Runs a series' programme.
  booker: {
    "event.write": "scoped",
    "event.public.write": "scoped",
    "venue.write": "scoped",
    "performer.write": "scoped",
    "booking.write": "scoped",
    "parameter.write": "scoped",
    "contact.pii.read": "global", // negotiates fees with performers, who link to contacts (§5.1.5)
    // Feature 086 (FR-001): feature 084 asks the Booker to settle a performer with no contact — link,
    // create, or archive — and creating one needs this. Global because contacts are not series-scoped,
    // the same reason the FS and the Door Attendant hold it that way. Deleting stays out of reach:
    // `contact.delete` is a separate capability (FR-002).
    "contact.write": "global",
    // Feature 086 (walk-through 2026-09-23, Rich): the Booker reads the gate report too. They
    // negotiate performer fees, so what an evening actually took and paid out is their business —
    // reading it, never recording it (`treasurer_report.write` stays with the Treasurer).
    "treasurer_report.read": "global",
  },

  // ⬤ per-series. Owns the door record's money.
  financial_secretary: {
    [FS_CAPABILITIES.gate]: "scoped",
    [FS_CAPABILITIES.payments]: "scoped",
    [FS_CAPABILITIES.performer]: "scoped", // correct/add performers for their series (B28)
    [FS_CAPABILITIES.attendance]: "scoped",
    [FS_CAPABILITIES.contact]: "global",
    [FS_CAPABILITIES.membership]: "global",
    [FS_CAPABILITIES.pii]: "global",
    // Feature 086 (FR-006c): global, NOT scoped — the club has two Financial Secretaries and they cover
    // for each other, so confining the read by series would refuse a fill-in. Which series a page shows
    // FIRST is a separate, presentational matter (FR-010).
    "treasurer_report.read": "global",
  },

  // ⬡ club-wide. Treasurer ⊇ FS across ALL series (FR-009) — every FS capability, as `global`.
  treasurer: {
    [FS_CAPABILITIES.gate]: "global",
    [FS_CAPABILITIES.payments]: "global",
    [FS_CAPABILITIES.performer]: "global", // ⊇ FS: correct performers on any series (B28)
    [FS_CAPABILITIES.attendance]: "global",
    [FS_CAPABILITIES.contact]: "global",
    [FS_CAPABILITIES.membership]: "global",
    [FS_CAPABILITIES.pii]: "global",
    "treasurer_report.write": "global",
    "treasurer_report.read": "global", // 086: the write does not imply the read
    "parameter.write": "global", // any series' parameters (row 9)
    "venue.write": "global",
  },

  // ⬡ club-wide officer. VP ⊇ President (FR-010) — so it carries role.assign and club_settings too.
  vice_president: {
    "contact.mailing.write": "global",
    "dedup.write": "global",
    "export.read": "global",
    "mailing_list.write": "global",
    "contact.pii.read": "global",
    "role.assign": "global",
    "club_settings.write": "global",
    "volunteer.approve": "global",
    "treasurer_report.read": "global", // 086: as President — oversight, not money work
  },

  webmaster: {
    "event.public.write": "global", // the blurb and price, never the date (row 2)
    "content.write": "global", // feature 051 (P7-R7): the content-pages CMS
  },

  // ⬤ per-series role — but `export.read` is `global`. THIS PAIR IS FR-008: scope varies per
  // capability, not per role. If these are ever collapsed into one capability, the exception is lost.
  mailing_list_manager: {
    "mailing_list.write": "scoped",
    "export.read": "global",
    // Feature 059 (M-R1/M-R2): the mailing-list manager maintains contacts club-wide. A contact is not
    // series-scoped, so both are `global` (like export.read / contact.pii.read above). `contact.write`
    // is the record itself (names/pronouns/phone); `contact.mailing.write` is emails/consent — distinct
    // from `mailing_list.write` (managing a SERIES' list), which stays scoped.
    "contact.write": "global",
    "contact.mailing.write": "global",
    "dedup.write": "global",
    "contact.pii.read": "global",
    // Feature 065 (M-R11): the mailing-list manager may hard-delete a BARE contact (guarded). The
    // unrestricted delete stays super_user-only.
    "contact.delete": "global",
  },

  secretary: {
    "export.read": "global", // backup exporter when the VP is absent (row 19)
    "contact.pii.read": "global",
  },

  president: {
    "role.assign": "global",
    "club_settings.write": "global",
    "volunteer.approve": "global",
    // Feature 086 (FR-005): officer oversight of the club's money. Reading the gate report, not working
    // on it — the President holds no other money capability.
    "treasurer_report.read": "global",
  },

  // Global god-mode. An app role, not a bylaws officer — and grantable ONLY from the operator CLI
  // (FR-030a), never a screen.
  super_user: {
    "dev.routes.read": "global", // only holder — the index is a developer tool (FR-040b)
    "event.write": "global",
    "event.public.write": "global",
    "venue.write": "global",
    "performer.write": "global",
    "booking.write": "global",
    "parameter.write": "global",
    "attendance.write": "global",
    "gate.write": "global",
    "performer_payment.write": "global",
    "treasurer_report.write": "global",
    "treasurer_report.read": "global",
    "contact.write": "global",
    "contact.mailing.write": "global",
    "contact.pii.read": "global",
    "dedup.write": "global",
    "contact.delete": "global",
    "contact.delete.unrestricted": "global", // feature 065 (M-R12): super_user only
    "membership.write": "global",
    "export.read": "global",
    "mailing_list.write": "global",
    "role.assign": "global",
    "club_settings.write": "global",
    "volunteer.approve": "global",
    "content.write": "global",
  },
};
