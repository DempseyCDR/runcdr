import { pgEnum } from "drizzle-orm/pg-core";

export const emailPurposeEnum = pgEnum("email_purpose", [
  "personal",
  "booking",
  "public_profile",
  "other",
]);

export const emailStatusEnum = pgEnum("email_status", ["active", "transition", "inactive"]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "current",
  "lapsed",
  "long_lapsed",
  "never",
]);

// Feature 044 (contact load): membership tier, imported from the CDR workbook Payer sheet "Level" column.
export const membershipLevelEnum = pgEnum("membership_level", [
  "individual",
  "family",
  "supporter",
  "student",
]);

export const emailConsentTopicEnum = pgEnum("email_consent_topic", [
  "contra",
  "english",
  "openband",
  "special_events",
  "jane_austen_ball",
  "contact_tracing",
  "do_not_contact",
]);

export const gateCategoryEnum = pgEnum("gate_category", [
  "admission",
  "merchandise",
  "donation",
  "future_event",
  "membership",
  "gift_card",
  "misc_sales",
]);

export const paymentMethodEnum = pgEnum("payment_method", ["cash", "card"]);

// Feature 081 (research R1): how a performer was paid — a numbered check, or cash from the evening's takings.
export const performerPaymentMethodEnum = pgEnum("performer_payment_method", ["check", "cash"]);

export const performerTypeEnum = pgEnum("performer_type", [
  "caller",
  "lead_musician",
  "musician",
  "open_band_musician",
  "sound_tech",
  "instructor",
]);

export type PerformerType = (typeof performerTypeEnum.enumValues)[number];

// Feature 018 (B23): per-booking lifecycle. Feature 020 (US3) adds 'tentative' — a performer's "maybe",
// between requested and confirmed (skippable). Transitions are enforced in bookingStatus.ts.
export const bookingStatusEnum = pgEnum("booking_status", [
  "proposed",
  "requested",
  "tentative",
  "confirmed",
  "declined",
]);

// Feature 018 (B25): a cancelled event is retained and shown (marked) on the public site.
export const eventStatusEnum = pgEnum("event_status", ["scheduled", "cancelled"]);

export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number];
export type EventStatus = (typeof eventStatusEnum.enumValues)[number];

export type GateCategory = (typeof gateCategoryEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
export type PerformerPaymentMethod = (typeof performerPaymentMethodEnum.enumValues)[number];

export type EmailPurpose = (typeof emailPurposeEnum.enumValues)[number];
export type EmailStatus = (typeof emailStatusEnum.enumValues)[number];
export type MembershipStatus = (typeof membershipStatusEnum.enumValues)[number];
export type MembershipLevel = (typeof membershipLevelEnum.enumValues)[number];
export type EmailConsentTopic = (typeof emailConsentTopicEnum.enumValues)[number];
