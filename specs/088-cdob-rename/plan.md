# Implementation Plan: The community dance series key becomes `cdob`

**Branch**: `088-cdob-rename` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/088-cdob-rename/spec.md`

## Summary

Rename the community dance series' key from `community_dance` to `cdob` — in the one database row
(migration `0060`), in the seed and the tests' series helper, and everywhere the code names the key
— without changing anything the series does or anything anyone sees. The rename is used to put the
four series keys in **one typed list** (backlog **B48**), so a map that misses a series fails the
type check instead of silently falling back, and a guard test proves nothing still matches on the
old key.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 24

**Primary Dependencies**: Next.js 16 (App Router), Drizzle ORM, Zod

**Storage**: PostgreSQL — one row of `series` changes; hand-written SQL migration `0060`

**Testing**: Vitest — node integration tests against real Postgres, jsdom component tests, unit
tests

**Target Platform**: the club's web app (volunteer pages and the public site)

**Project Type**: web application (single Next.js project, `src/app` + `src/server`)

**Performance Goals**: none new — one `UPDATE` of one row

**Constraints**: nothing a visitor sees may change; no redirects; every community-dance rule and
record unchanged; the dev server must be stopped while migrating and testing

**Scale/Scope**: 1 row; about 9 source files and 20 test files name the key today; 2 living docs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| **I. Test-First** | Pass. The failing tests come first: the guard (no `community_dance` in `src/` outside migrations) and a migration test (`cdob` finds the series and all its dances; `community_dance` finds nothing; four series, not five) are written and seen red before the rename. Existing behaviour tests — open band, TNC organizer pairing, public colour and photo — are moved to the new key and must stay green. |
| **II. Simplicity / YAGNI** | Pass, with one addition justified below: the `SeriesKey` list (B48). The key is named in nine places, well past the "three or more" threshold for a shared helper, and it removes the spec's named risk. No other abstraction. |
| **III. Type Safety** | Strengthened. The public maps become `Record<SeriesKey, …>`, so an unmapped series is a compile error rather than a silent fallback. No casts. |
| **IV. Observability** | Pass. No new request path; the migration is a one-row data change, run by the existing migration runner, which reports each file it applies. |

**Post-design re-check**: unchanged — Phase 1 introduced no new dependency, service or path.

## Project Structure

### Documentation (this feature)

```text
specs/088-cdob-rename/
├── plan.md              # This file
├── research.md          # R1–R6: the key list, the one-row change, the seed, what stays, the guard
├── data-model.md        # the one row, and what belongs to the series by id
├── quickstart.md        # before/after validation
├── baseline.md          # T001 — the counts and figures captured before the change
├── contracts/
│   └── series-key.md    # addresses that carry the key, before and after
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks — not created by /speckit-plan
```

### Source Code (repository root)

```text
src/server/domain/series/seriesKeys.ts         # NEW — SERIES_KEYS + SeriesKey (B48)
src/server/db/migrations/0060_cdob_series_key.sql  # NEW — the one-row rename
src/server/db/seed.ts                          # creates cdob
src/server/domain/attendance/attendanceService.ts  # open-band rule (3 sites)
src/server/domain/organizer/reportService.ts   # TNC report includes cdob
src/server/domain/public/printableCalendar.ts  # "CD" keyed by cdob
src/server/db/schema/attendance.ts, door.ts    # comments name the series
src/server/domain/bookings/reportService.ts    # comment names the series
src/app/(door)/checkin/page.tsx                # finds the community dance for the open band
src/app/(public)/_components/seriesColor.ts    # Record<SeriesKey, …>
src/app/(public)/_components/seriesHero.ts     # Record<SeriesKey, …>; points at cdob.jpg
public/series/community_dance.jpg → cdob.jpg   # the photo, renamed (research R4)
src/app/(public)/dances/landingContent.ts      # the community dance section's key
tests/integration/helpers/db.ts                # seeds cdob (research R3 — required)
tests/**                                       # ~20 files move to cdob
docs/use-cases.md, specs/DATA_MODEL.md         # the key and its meaning (FR-008)
```

**Structure Decision**: the existing single Next.js project. The only new source file is the key
list, placed beside the other domain modules under `src/server/domain/`; it holds constants only,
so client components (check-in, the public maps) can import it safely.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| `SeriesKey` list (B48) | The key is named in nine places, and a missed map fails silently (the hero photo becomes a plain header) | Replacing each literal with `"cdob"` leaves the silent-miss risk in place and makes the next rename repeat this feature |
