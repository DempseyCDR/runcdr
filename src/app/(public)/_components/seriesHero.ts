// Feature 049 (P7-R5): per-series → committed static hero asset under public/series/ (D-4: curated,
// committed, low-churn — no upload substrate). Keyed by the stable series key, taken from SERIES_KEYS
// (088, B48). Filenames are as supplied — note tnc's image is named `contra`. Any unmapped
// or future series → null, so the event page renders a clean series-colored header (no broken image).
// `public/series/meeting.jpg` is reserved for future meeting events; no dance series maps to it today.

import { isSeriesKey, SERIES_KEYS, type SeriesKey } from "@/server/domain/series/seriesKeys";

// Feature 088: typed over SeriesKey, so a series left out of this map fails the type check instead of
// quietly losing its photo. The community dance's photo was renamed with its key (cdob.jpg).
const SERIES_HERO: Record<SeriesKey, string> = {
  [SERIES_KEYS.tnc]: "/series/contra.webp",
  [SERIES_KEYS.ecd]: "/series/ecd.jpg",
  [SERIES_KEYS.cdob]: "/series/cdob.jpg",
  [SERIES_KEYS.general]: "/series/general.jpg",
};

/** The committed hero image path for a series, or null when the series has no curated image. */
export function seriesHeroSrc(seriesKey: string): string | null {
  return isSeriesKey(seriesKey) ? SERIES_HERO[seriesKey] : null;
}
