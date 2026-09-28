# Research: The community dance series key becomes `cdob`

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-28

## R1 — One typed list of series keys (backlog B48), done now

**Decision**: add a single shared list of the four series keys, with a `SeriesKey` type, in a new
`src/server/domain/series/seriesKeys.ts`. Every place that names a series key — the colour, hero,
landing and printable-calendar maps, the organizer report's TNC pairing, check-in's open-band rule,
the seed, and the tests' series helper — takes the key from that list instead of typing it. The
public maps become `Record<SeriesKey, …>`, so a map missing a series fails the type check.

**Rationale**: the rename has to touch every one of these places anyway, and the spec's sharpest
risk is a mapping that is missed without failing: the hero photo quietly becomes a plain coloured
header (spec, User Story 3). A literal typed in nine places is what made that risk possible; with
one list, `cdob` is written once and a map that forgets a series will not compile. The same list
satisfies SC-006 (nothing still matches on `community_dance`) by construction. This is exactly B48's
proposal ("a shared `SERIES_KEYS` const + `SeriesKey` union … so a new or renamed series is a
one-line change and typos are caught by `tsc`"), and the key is needed in far more than the three
places Principle II asks for before a shared helper.

The list is **hand-maintained**, not generated. Series remain rows in a table; the list names the
four the club has, as B48 noted, and self-service series creation (B18) would make it advisory.

**Alternatives considered**: (a) replace each literal with `"cdob"` and stop — rejected: leaves the
silent-miss risk exactly where it is, and the next rename repeats this feature; (b) a Postgres enum
— rejected: the club's series are data, and an enum would make adding one a migration.

## R2 — The data change is one row

**Decision**: migration `0060` renames the key in place —
`UPDATE series SET key = 'cdob' WHERE key = 'community_dance'` — and does nothing else.

**Rationale**: every table that belongs to a series refers to it by its **id**, never its key:
`events`, `series_parameters`, `series_parameter_audit`, `venue_rents`, `venue_rent_audit`,
`role_grants`, `admission_prices` and `quarterly_attendance_counts` (checked against the database's
foreign keys, 2026-09-28). Renaming the key therefore moves nothing and cascades nothing — which is
FR-005 by construction. `series.key` is unique, and `cdob` is not in use.

The statement is naturally idempotent: run twice, the second finds no `community_dance` row.

**Alternatives considered**: insert a new `cdob` series and move the records across — rejected:
many tables, many chances to miss one, for no gain over renaming the one row.

## R3 — Where the community dance series comes from on a fresh installation

**Decision**: change the seed (`src/server/db/seed.ts`) and the tests' series helper
(`tests/integration/helpers/db.ts`) to create `cdob`.

**Rationale**: no migration creates the community dance series — only the seed and the tests'
helper do (0012 creates only `general`). The helper inserts the four series with
`ON CONFLICT (key) DO NOTHING`; the test database is migrated first, so its row is already `cdob`.
If the helper still named `community_dance`, it would find no conflict and create a **fifth**
series — a second community dance with none of the first's history. Changing the helper is
therefore not tidying; it is required.

## R4 — What stays as written

**Decision**: leave these alone:

- **Old migrations** (`0022`, `0057`) that mention `community_dance` in comments — they record what
  was true when they ran, and editing an applied migration changes nothing but its history.
- **The printable calendar's "CD"** and the series' **name** "Community Dance" — what visitors
  read (spec, Clarifications).
- **Historical specs and the backlog's past entries** — they record their own time.

Living reference documents are updated: `docs/use-cases.md` and `specs/DATA_MODEL.md` (FR-008).

**The photo file is renamed**, not kept *(decided 2026-09-28, analysis I1)*:
`public/series/community_dance.jpg` becomes `public/series/cdob.jpg`. Keeping the old name would
leave the old key inside `src/` — in the hero map's path — and the guard (R5) would need an
exception. Visitors never see a photo's file name, and the picture is the same.

## R5 — Proving nothing still matches on the old key (SC-006)

**Decision**: a guard test scans `src/` — excluding `src/server/db/migrations/`, whose history
legitimately names the old key, including `0060` itself — and fails if `community_dance` appears.

**Rationale**: a compile error catches a missed map (R1), but a string comparison such as
`key === "community_dance"` would still compile and silently never match. The guard catches that
class, and it keeps catching it after this feature.

## R6 — The organizer report's address and the public filter

**Decision**: no code change beyond R1. Both take the key from the address — the organizer report
at `/organizer/{key}`, the public list at `/whats-on?series={key}` — and look it up. After the
rename they answer to `cdob`; the old key behaves as any unknown key does (not found; an empty
list). The app is not deployed, so no outside link carries the old key (spec, Clarifications).
