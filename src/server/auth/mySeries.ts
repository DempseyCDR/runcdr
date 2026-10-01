import type { Actor } from "@/server/auth/actor";
import { SERIES_KEYS } from "@/server/domain/series/seriesKeys";

/**
 * Feature 086 (FR-010, FR-012): the series this viewer works in — every series named by any grant they
 * hold. It decides what a page STARTS at, never what it permits. Empty means "do not narrow", which covers
 * both a club-wide holder (a grant with no scope matches every series, so narrowing would be wrong) and a
 * volunteer with no grants. Lifted unchanged out of `/api/me/capabilities` by feature 090, which gave it a
 * second user: where the organizer report opens.
 */
export function mySeries(actor: Actor): string[] {
  if (actor.grants.some((g) => g.seriesId === null && g.groupId === null)) return [];
  return [...new Set(actor.grants.flatMap((g) => (g.seriesId ? [g.seriesId] : [])))];
}

/**
 * Feature 090 (FR-021, research R9): which series' organizer report the menu opens — the viewer's own when
 * their grants name exactly one; otherwise Thursday Night Contra's, as it always has.
 */
export function organizerLandingKey(
  mySeriesIds: string[],
  series: { id: string; key: string }[],
): string {
  const only = mySeriesIds.length === 1 ? mySeriesIds[0] : undefined;
  return series.find((s) => s.id === only)?.key ?? SERIES_KEYS.tnc;
}
