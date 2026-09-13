/** Consistent API error shape: { error: { code, message } }. */
export type ApiErrorCode =
  | "EMAIL_DUPLICATE"
  // Feature 069 (M-R21): a merge held for a decision the survivor cannot make for itself.
  | "HELD_MERGE_NOT_FOUND"
  | "HELD_MERGE_REASON_MISMATCH"
  // Feature 074: undoing a merge.
  | "MERGE_NOT_FOUND"
  | "MERGE_NOT_REVERSIBLE"
  // Feature 068 (M-R/FR-003a, FR-009): membership account guards.
  | "LEVEL_CAPACITY_EXCEEDED"
  | "LEVEL_ADMITS_NO_MEMBERS"
  | "PAYER_NOT_DETACHABLE"
  | "ACCOUNT_NOT_FOUND"
  // Feature 067 (M-R23): shared/family email reference guards.
  | "REFERENCE_SELF"
  | "REFERENCE_TARGET_NOT_ACTIVE"
  | "REFERRER_OWNS_EMAIL"
  | "CONTACT_NOT_FOUND"
  | "EMAIL_NOT_FOUND"
  | "LOGIN_NOT_PERMITTED"
  | "PURPOSES_REQUIRED"
  | "CONSENT_TOPICS_REQUIRED"
  | "READ_ONLY_FIELD"
  | "ALREADY_MERGED"
  | "SAME_CONTACT"
  | "SERIES_NOT_FOUND"
  | "EVENT_GROUP_NOT_FOUND"
  | "EVENT_NOT_FOUND"
  | "DOOR_RECORD_EXISTS"
  | "DOOR_RECORD_NOT_FOUND"
  | "ATTENDANCE_NOT_FOUND"
  | "ALREADY_CHECKED_IN"
  | "CASH_PAYOUT_REASON_REQUIRED"
  | "PERFORMER_NOT_FOUND"
  | "BOOKING_NOT_FOUND"
  | "SOUND_TECH_NOT_ALLOWED"
  | "MAILING_LIST_NOT_FOUND"
  | "BAND_NOT_FOUND"
  | "VENUE_NOT_FOUND"
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "UNAUTHORIZED"
  | "FIELD_NOT_PERMITTED"
  | "EXCLUSIVE_ROLE_CONFLICT"
  | "GRANT_REQUIRES_VOLUNTEER"
  | "ROLE_NOT_UI_GRANTABLE"
  | "GRANT_NOT_FOUND"
  | "EVENT_HAS_HISTORY"
  | "EVENT_HAS_ATTENDANCE"
  | "RECURRENCE_TOO_LARGE"
  | "PERFORMER_PAYMENT_NOT_FOUND"
  | "BOOKING_EVENT_MISMATCH"
  | "CONTENT_PAGE_NOT_FOUND"
  | "CONTENT_SLUG_TAKEN"
  | "CAMPAIGN_NOT_FOUND"
  | "CONTACT_HAS_REFERENCES"
  | "EMAIL_ACTIVE_ELSEWHERE";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** For UNAUTHORIZED / FIELD_NOT_PERMITTED: the capability or field refused, for the audit trail. */
  readonly detail?: string;
  /** Structured payload merged into the error body (e.g. feature 066's colliding contact). */
  readonly data?: Record<string, unknown>;

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    detail?: string,
    data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.data = data;
  }

  toResponseBody(): {
    error: { code: ApiErrorCode; message: string; detail?: string } & Record<string, unknown>;
  } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.detail !== undefined ? { detail: this.detail } : {}),
        ...(this.data ?? {}),
      },
    };
  }
}

/**
 * Feature 077: what to do instead of deleting, by WHY the delete was refused. "Merge or archive it" was
 * the only advice, and it is wrong for two cases this feature adds — a contact that has acted as staff can
 * never be deleted at all, and a survivor that absorbed others should have its merges undone first if any
 * were mistakes. Staff wins when both apply, because undoing merges would still not make it deletable.
 */
function deleteAdvice(categories: string[]): string {
  if (categories.includes("staff_history")) {
    return "anyone who has acted as staff is never deleted, so archive it instead.";
  }
  if (categories.includes("merged_contacts")) {
    return "deleting it would delete them too. Undo those merges first if any were mistakes, or archive it instead.";
  }
  return "merge or archive it instead of deleting.";
}

export const errors = {
  /** Feature 015: no valid staff session. Deliberately says nothing about why. */
  unauthenticated: () => new ApiError("UNAUTHENTICATED", 401, "Authentication required."),
  /**
   * Feature 016: signed in, but not permitted (FR-026).
   *
   * NAMES the capability — the opposite posture to `unauthenticated` above, and deliberately so. 401
   * is silent because anyone could probe it without signing in. A 403's actor is a known volunteer
   * who, under FR-015, could already READ the thing they were refused: concealing the reason protects
   * nothing and only costs them the ability to understand what happened. The one carve-out is
   * FR-026a — a refusal must never echo or partially render contact PII.
   */
  unauthorized: (capability: string) =>
    new ApiError("UNAUTHORIZED", 403, `Not permitted: ${capability}.`, capability),
  /**
   * Feature 016: the write contained a field this actor does not own (FR-021/FR-022).
   *
   * The whole write is REFUSED, never stripped. Zod's instinct — drop unknown keys and carry on — is
   * the exact failure FR-022 forbids: a Webmaster who submits a date change must be told, not quietly
   * ignored.
   */
  fieldNotPermitted: (field: string) =>
    new ApiError("FIELD_NOT_PERMITTED", 403, `Field not permitted: ${field}.`, field),
  emailDuplicate: () =>
    new ApiError("EMAIL_DUPLICATE", 409, "Email already in use by an active or transition record."),
  /**
   * Feature 066 (M-R15.3): the address is already active on ANOTHER contact — a duplicate signal, not a
   * dead-end error. Carries the other contact so the editor can offer "review as duplicate".
   */
  emailActiveElsewhere: (other: { contactId: string; displayName: string; emailId?: string }) =>
    new ApiError(
      "EMAIL_ACTIVE_ELSEWHERE",
      409,
      `Already active on ${other.displayName} — review as duplicate.`,
      other.contactId,
      { other },
    ),
  /**
   * Feature 067 (FR-003/FR-014/FR-017): shared-email reference guards. A reference is a pointer to
   * ANOTHER contact's active owned email; a contact that still has a working address of its own is not
   * a referrer (the address-edit path retires the edited row first, so it links cleanly).
   */
  referenceSelf: () =>
    new ApiError("REFERENCE_SELF", 422, "That email belongs to this contact — nothing to share."),
  referenceTargetNotActive: () =>
    new ApiError(
      "REFERENCE_TARGET_NOT_ACTIVE",
      422,
      "That address is not active, so it cannot be shared.",
    ),
  referrerOwnsEmail: () =>
    new ApiError(
      "REFERRER_OWNS_EMAIL",
      409,
      "This contact has an active email of its own — retire it first to share someone else's.",
    ),
  /**
   * Feature 068: the level is the payer's and caps who the account may cover (FR-003a). A refusal names
   * the PEOPLE who would be displaced — a count would leave the FS guessing who to remove.
   */
  levelCapacityExceeded: (level: string, displaced: string[]) =>
    new ApiError(
      "LEVEL_CAPACITY_EXCEEDED",
      422,
      `A ${level} membership covers only the payer — ${displaced.join(", ")} would no longer be covered. Remove them first.`,
      level,
      { displaced },
    ),
  levelAdmitsNoMembers: (level: string) =>
    new ApiError(
      "LEVEL_ADMITS_NO_MEMBERS",
      409,
      `A ${level} membership covers only the payer, so no one else can be added to it.`,
      level,
    ),
  payerNotDetachable: () =>
    new ApiError(
      "PAYER_NOT_DETACHABLE",
      409,
      "The payer owns this membership and cannot be removed from it.",
    ),
  accountNotFound: () =>
    new ApiError("ACCOUNT_NOT_FOUND", 404, "This contact has no membership account."),
  heldMergeNotFound: () =>
    new ApiError("HELD_MERGE_NOT_FOUND", 404, "That held merge no longer exists."),
  /** Feature 074: no merge with that id. Distinct from a merge that exists but cannot be undone. */
  mergeNotFound: () => new ApiError("MERGE_NOT_FOUND", 404, "That merge no longer exists."),
  /**
   * Feature 074 (FR-007 to FR-010): the merge exists but cannot be undone.
   *
   * The verdict rides in `detail` rather than only in the prose, because the caller has to explain
   * WHICH condition applies (FR-028) and must not have to parse a sentence to find out. The message is
   * Mel's, the detail is the client's.
   */
  mergeNotReversible: (verdict: string, message: string) =>
    new ApiError("MERGE_NOT_REVERSIBLE", 409, message, verdict),
  /** The choice offered must match what actually collided — a login cannot resolve an account clash. */
  heldMergeReasonMismatch: (reason: string) =>
    new ApiError(
      "HELD_MERGE_REASON_MISMATCH",
      422,
      `This merge is held because of ${reason === "two_logins" ? "two staff sign-ins" : "two membership accounts"}; the choice offered does not resolve that.`,
      reason,
    ),
  contactNotFound: () => new ApiError("CONTACT_NOT_FOUND", 404, "Contact not found."),
  /**
   * Feature 065 (M-R11): a SAFE delete refuses when the contact is referenced by any substantive table.
   * Names the categories so the editor can explain (merge or archive instead). The unrestricted delete
   * bypasses this.
   */
  contactHasReferences: (labels: string[], categories: string[] = labels) =>
    new ApiError(
      "CONTACT_HAS_REFERENCES",
      409,
      `Contact has ${labels.join(", ")} — ${deleteAdvice(categories)}`,
      categories.join(","),
    ),
  emailNotFound: () => new ApiError("EMAIL_NOT_FOUND", 404, "Email not found."),
  loginNotPermitted: () =>
    new ApiError(
      "LOGIN_NOT_PERMITTED",
      422,
      "A login email may only be set on a volunteer contact (Phase 1).",
    ),
  purposesRequired: () =>
    new ApiError("PURPOSES_REQUIRED", 422, "At least one email purpose is required."),
  consentTopicsRequired: () =>
    new ApiError("CONSENT_TOPICS_REQUIRED", 422, "At least one consent topic is required."),
  readOnlyField: (field: string) =>
    new ApiError("READ_ONLY_FIELD", 422, `Field is read-only: ${field}.`),
  alreadyMerged: () =>
    new ApiError("ALREADY_MERGED", 409, "One of the contacts has already been merged."),
  sameContact: () =>
    new ApiError("SAME_CONTACT", 422, "Canonical and merged contacts must differ."),
  validation: (message: string) => new ApiError("VALIDATION_ERROR", 422, message),
  /**
   * FR-005a: President / VP / Treasurer are mutually exclusive — separation of authority from money.
   * A cross-ROW invariant on the contact, so it cannot be a row CHECK; enforced in grantService and
   * on every path including the CLI (FR-033). Names the conflicting role held.
   */
  exclusiveRoleConflict: (held: string) =>
    new ApiError(
      "EXCLUSIVE_ROLE_CONFLICT",
      422,
      `President, VP and Treasurer are mutually exclusive; this contact already holds ${held}.`,
    ),
  /** R3: only a volunteer may hold grants (the retired roles_require_volunteer, re-expressed here). */
  grantRequiresVolunteer: () =>
    new ApiError(
      "GRANT_REQUIRES_VOLUNTEER",
      422,
      "Roles may only be granted to a volunteer; designate the contact first.",
    ),
  /** FR-030a: Super-user is grantable from no screen, by nobody — only the operator CLI. */
  roleNotUiGrantable: (role: string) =>
    new ApiError(
      "ROLE_NOT_UI_GRANTABLE",
      422,
      `${role} may only be granted from the operator CLI.`,
    ),
  grantNotFound: () => new ApiError("GRANT_NOT_FOUND", 404, "Grant not found."),
  seriesNotFound: () => new ApiError("SERIES_NOT_FOUND", 404, "Series not found."),
  eventGroupNotFound: () => new ApiError("EVENT_GROUP_NOT_FOUND", 404, "Event group not found."),
  eventNotFound: () => new ApiError("EVENT_NOT_FOUND", 404, "Event not found."),
  // Feature 019 US4 (FR-019): the refusal NAMES the blocker (gate sales / money / check / payment) so the
  // organizer knows what to clear. `detail` carries the specific blocker.
  eventHasHistory: (blocker: string) =>
    new ApiError(
      "EVENT_HAS_HISTORY",
      409,
      `This event has ${blocker} — cancel it instead of deleting.`,
      blocker,
    ),
  // Feature 019 US4 (FR-018a): attendance no longer hard-blocks; it must be confirmed. The count travels
  // in `detail` so the UI can show it before the destructive retry with confirmDiscardAttendance.
  eventHasAttendance: (attendeeCount: number) =>
    new ApiError(
      "EVENT_HAS_ATTENDANCE",
      409,
      `This event has ${attendeeCount} checked-in attendee(s). Confirm to delete and discard them.`,
      String(attendeeCount),
    ),
  recurrenceTooLarge: (cap: number) =>
    new ApiError(
      "RECURRENCE_TOO_LARGE",
      422,
      `That range would generate more than ${cap} events; narrow it or split into runs.`,
    ),
  doorRecordExists: () =>
    new ApiError("DOOR_RECORD_EXISTS", 409, "This event already has a door record."),
  doorRecordNotFound: () => new ApiError("DOOR_RECORD_NOT_FOUND", 404, "Door record not found."),
  attendanceNotFound: () =>
    new ApiError("ATTENDANCE_NOT_FOUND", 404, "Attendance record not found."),
  alreadyCheckedIn: () =>
    new ApiError("ALREADY_CHECKED_IN", 409, "This contact is already recorded for this event."),
  cashPayoutReasonRequired: () =>
    new ApiError("CASH_PAYOUT_REASON_REQUIRED", 422, "A reason is required for cash paid out."),
  performerNotFound: () => new ApiError("PERFORMER_NOT_FOUND", 404, "Performer not found."),
  bookingNotFound: () => new ApiError("BOOKING_NOT_FOUND", 404, "Booking not found."),
  performerPaymentNotFound: () =>
    new ApiError("PERFORMER_PAYMENT_NOT_FOUND", 404, "Performer payment not found."),
  // Feature 019 US2: settlement is per event; a payment may not aggregate bookings across events.
  bookingEventMismatch: () =>
    new ApiError(
      "BOOKING_EVENT_MISMATCH",
      422,
      "All bookings on a payment must belong to the payment's event.",
    ),
  soundTechNotAllowed: () =>
    new ApiError(
      "SOUND_TECH_NOT_ALLOWED",
      422,
      "Sound Tech is not allowed for this event's series.",
    ),
  mailingListNotFound: () => new ApiError("MAILING_LIST_NOT_FOUND", 404, "Unknown mailing list."),
  bandNotFound: () => new ApiError("BAND_NOT_FOUND", 404, "Band not found."),
  venueNotFound: () => new ApiError("VENUE_NOT_FOUND", 404, "Venue not found."),
  // Feature 051 (P7-R7): content pages.
  contentPageNotFound: () => new ApiError("CONTENT_PAGE_NOT_FOUND", 404, "Content page not found."),
  contentSlugTaken: () =>
    new ApiError("CONTENT_SLUG_TAKEN", 409, "A page with that slug already exists."),
  // Feature 057 (P7-R14): the campaign slot.
  campaignNotFound: () => new ApiError("CAMPAIGN_NOT_FOUND", 404, "Campaign not found."),
};
