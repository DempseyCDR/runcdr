# Quickstart: validating the `cdob` rename

**Feature**: [spec.md](./spec.md) |
**Contract**: [contracts/series-key.md](./contracts/series-key.md)

## Before

**Stop the dev server** — run nothing against the database while it is up. Then capture what must
not change (read-only):

```bash
psql "$DATABASE_URL" -Atc "select s.key, count(e.id) from series s left join events e on e.series_id = s.id group by s.key order by s.key"
```

Note the community dance's dance count, and open the TNC organizer report for the current year and
the last full year; note its figures.

## Apply and test

```bash
pnpm db:migrate
pnpm vitest run
pnpm tsc --noEmit
```

Expected: the migration reports `0060_cdob_series_key.sql` applied; the suite is green, including
the guard that no source outside the migrations still names `community_dance`.

## After

1. Re-run the count above: the series is listed as `cdob`, with the **same** dance count; no
   `community_dance` row; still four series.
2. Open `/organizer/cdob` — the community dance's report. Open `/organizer/community_dance` — not
   found.
3. Open the TNC organizer report for the same two years — the **same** figures as before.
4. At a community dance, check someone in as an open-band musician — accepted. At a TNC dance —
   refused.
5. Booking Central: a community dance wants no sound tech.
6. Public site: a community dance's event page shows its photo and colour; `/whats-on?series=cdob`
   lists community dances; the dances landing page and the printable calendar ("CD") look as before.
