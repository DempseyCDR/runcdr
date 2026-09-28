import { describe, it, expect } from "vitest";
import { getStyleLanding, STYLE_SLUGS } from "@/app/(public)/dances/landingContent";
import { SERIES_KEYS } from "@/server/domain/series/seriesKeys";

// Feature 050 (P7-R6): the committed per-style landing content registry. Migrated club voice; role/gendered-
// language notes are style-specific (spec FR-001) — contra & community use Larks/Robins, English does not.
describe("landing content registry", () => {
  it("covers exactly the three styles", () => {
    expect([...STYLE_SLUGS].sort()).toEqual(["community", "contra", "english"]);
  });

  it("maps each style to its club series key", () => {
    expect(getStyleLanding("contra")?.seriesKey).toBe("tnc");
    expect(getStyleLanding("english")?.seriesKey).toBe("ecd");
    expect(getStyleLanding("community")?.seriesKey).toBe(SERIES_KEYS.cdob);
  });

  it("gives every style a title and non-empty prose sections, incl. a 'no partner' reassurance", () => {
    for (const slug of STYLE_SLUGS) {
      const c = getStyleLanding(slug)!;
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.intro.length).toBeGreaterThan(0);
      expect(c.whyYoullLove.length).toBeGreaterThan(0);
      expect(c.whatToExpect.length).toBeGreaterThan(0);
      expect(c.whatToExpect.join(" ").toLowerCase()).toContain("no partner");
    }
  });

  it("returns null for an unknown slug", () => {
    expect(getStyleLanding("tango")).toBeNull();
    expect(getStyleLanding("")).toBeNull();
  });

  it("uses style-specific role terminology — Larks/Robins for contra/community, NOT for English", () => {
    expect(getStyleLanding("contra")!.whatToExpect.join(" ").toLowerCase()).toContain("larks");
    expect(getStyleLanding("community")!.whatToExpect.join(" ").toLowerCase()).toContain("larks");
    const english = getStyleLanding("english")!.whatToExpect.join(" ").toLowerCase();
    expect(english).not.toContain("larks");
    expect(english).toContain("men's line"); // English uses traditional terminology
  });
});
