import { describe, it, expect } from "vitest";
import { isSeriesKey, SERIES_KEYS } from "@/server/domain/series/seriesKeys";

// Feature 088 (research R1, backlog B48): the one list of the club's series keys. Every place that names
// a series takes its key from here, so a renamed series is a one-line change and a missed one fails the
// type check instead of silently falling back.
describe("SERIES_KEYS", () => {
  it("holds exactly the club's four series", () => {
    expect(Object.values(SERIES_KEYS).sort()).toEqual(["cdob", "ecd", "general", "tnc"]);
  });

  it("names the community dance cdob — Community Dance / Open Band", () => {
    expect(SERIES_KEYS.cdob).toBe("cdob");
  });

  // A key arrives from an address or a row as plain text; this is how a map typed over SeriesKey is read
  // without a cast.
  it("recognises the club's keys, and nothing else — not the retired community_dance", () => {
    expect(["tnc", "ecd", "cdob", "general"].every(isSeriesKey)).toBe(true);
    expect(isSeriesKey("community_dance")).toBe(false);
    expect(isSeriesKey("")).toBe(false);
  });
});
