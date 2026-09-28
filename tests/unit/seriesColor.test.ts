import { describe, it, expect } from "vitest";
import { seriesColorVar } from "@/app/(public)/_components/seriesColor";
import { SERIES_KEYS } from "@/server/domain/series/seriesKeys";

// Feature 048 (P7-R4): the per-series → R1-color map that colors every event card. Keyed by the stable
// series key (never the display name); an unmapped/future series falls back to the neutral accent token.
describe("seriesColorVar", () => {
  it("maps each known series key to its R1 event-type color", () => {
    expect(seriesColorVar("tnc")).toBe("var(--type-contra)");
    expect(seriesColorVar("ecd")).toBe("var(--type-english)");
    expect(seriesColorVar(SERIES_KEYS.cdob)).toBe("var(--type-special)");
    expect(seriesColorVar("general")).toBe("var(--type-assembly)");
  });

  it("falls back to the neutral default for an unmapped/unknown series key", () => {
    expect(seriesColorVar("some_future_series")).toBe("var(--band)");
    expect(seriesColorVar("")).toBe("var(--band)");
  });
});
