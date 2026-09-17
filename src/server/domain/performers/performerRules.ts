import type { PerformerType } from "@/server/db/schema";

export type PublicDisplay = "full_bio" | "open_band_label" | "hidden" | "name_note";

export type PerformerRule = {
  paid: boolean;
  requiresCheck: boolean; // base rule; actual check also requires pay > 0
  publicDisplay: PublicDisplay;
  /** Rate kind used to default pay, if any. */
  rateKind: "caller" | "sound_tech" | "musician" | null;
};

/**
 * Static performer-type rule matrix (domain invariants, not per-club config).
 * Consumed by the booking service and (later) the public site + treasurer report.
 * Lead Musician and Musician share the same rule set — "Lead" designates only the booking
 * point of contact, not a distinct pay tier (feature 009).
 */
export const PERFORMER_RULES: Record<PerformerType, PerformerRule> = {
  caller: { paid: true, requiresCheck: true, publicDisplay: "full_bio", rateKind: "caller" },
  lead_musician: {
    paid: true,
    requiresCheck: true,
    publicDisplay: "full_bio",
    rateKind: "musician",
  },
  musician: { paid: true, requiresCheck: true, publicDisplay: "full_bio", rateKind: "musician" },
  // Feature 081 (FR-009): free unless given an amount — then payable (requiresCheck follows pay > 0).
  open_band_musician: {
    paid: false,
    requiresCheck: true,
    publicDisplay: "open_band_label",
    rateKind: null,
  },
  sound_tech: { paid: true, requiresCheck: true, publicDisplay: "hidden", rateKind: "sound_tech" },
  instructor: { paid: false, requiresCheck: true, publicDisplay: "name_note", rateKind: null },
};

/** A booking requires a check only when its type's rule says so AND it is actually paid. */
export function bookingRequiresCheck(type: PerformerType, payCents: number): boolean {
  return PERFORMER_RULES[type].requiresCheck && payCents > 0;
}
