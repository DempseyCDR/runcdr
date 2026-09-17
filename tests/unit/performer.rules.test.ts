import { describe, expect, it } from "vitest";
import { PERFORMER_RULES, bookingRequiresCheck } from "@/server/domain/performers/performerRules";

// FR-001, FR-002, FR-003
describe("performer rules", () => {
  it("encodes paid/check/public per type", () => {
    expect(PERFORMER_RULES.caller).toMatchObject({
      paid: true,
      requiresCheck: true,
      publicDisplay: "full_bio",
    });
    // Feature 081 (FR-009): free by default, but payable once given an amount.
    expect(PERFORMER_RULES.open_band_musician).toMatchObject({
      paid: false,
      requiresCheck: true,
      publicDisplay: "open_band_label",
    });
    expect(PERFORMER_RULES.sound_tech).toMatchObject({ paid: true, publicDisplay: "hidden" });
    expect(PERFORMER_RULES.instructor).toMatchObject({
      paid: false,
      requiresCheck: true,
      publicDisplay: "name_note",
    });
  });

  it("treats a plain musician as paid, checked when paid, shown publicly", () => {
    expect(PERFORMER_RULES.musician).toMatchObject({
      paid: true,
      requiresCheck: true,
      publicDisplay: "full_bio",
    });
  });

  it("requires a check only when the rule says so AND pay > 0", () => {
    expect(bookingRequiresCheck("caller", 15000)).toBe(true);
    expect(bookingRequiresCheck("caller", 0)).toBe(false); // donated / unpaid
    expect(bookingRequiresCheck("musician", 12000)).toBe(true);
    expect(bookingRequiresCheck("musician", 0)).toBe(false); // donated musician
    expect(bookingRequiresCheck("open_band_musician", 0)).toBe(false);
    expect(bookingRequiresCheck("instructor", 0)).toBe(false);
    expect(bookingRequiresCheck("instructor", 5000)).toBe(true); // 081: an instructor given a pay
    expect(bookingRequiresCheck("open_band_musician", 5000)).toBe(true);
  });
});
