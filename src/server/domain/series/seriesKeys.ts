/**
 * Feature 088 (research R1, backlog B48): the club's series keys, in one place.
 *
 * A series' key is the short name the system matches on — the open band at the door, the organizer report
 * that counts the community dance with Thursday Night Contra, the public site's colour, photo and landing
 * page. Before this list the keys were typed by hand wherever they were needed, so a rename could miss one
 * and nothing would fail: an unmapped series simply falls back to a neutral colour or a plain header. Every
 * such place now takes its key from here, and the public maps are typed over `SeriesKey`, so a map that
 * leaves a series out does not compile.
 *
 * Constants only, so client components may import it. Series are still rows in a table; this names the
 * four the club has (B18, self-service series, would make it advisory).
 */
export const SERIES_KEYS = {
  /** Thursday Night Contra. */
  tnc: "tnc",
  /** Sunday English Country Dance. */
  ecd: "ecd",
  /** Community Dance / Open Band — the series whose dances have an open band. */
  cdob: "cdob",
  /** General / Joint Events. */
  general: "general",
} as const;

export type SeriesKey = (typeof SERIES_KEYS)[keyof typeof SERIES_KEYS];

const KNOWN: readonly string[] = Object.values(SERIES_KEYS);

/** Whether a key read from an address or a row is one of the club's series — so a map typed over
 *  `SeriesKey` can be read without a cast, and an unknown key falls to that map's default. */
export function isSeriesKey(key: string): key is SeriesKey {
  return KNOWN.includes(key);
}
