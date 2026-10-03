# Implementation Plan: Booking Central on a phone

**Branch**: `091-booking-central-cards` | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/091-booking-central-cards/spec.md`

## Summary

Booking Central (feature 087) becomes usable on a phone and opens where the Booker's work is.

- **Cards at every width** (US1): one card per dance — date, series, label, caller and band, each
  name with its state letter, the gap marks. On a phone a tap anywhere opens the dance in the shared
  dialog with everything its row offers; from 48rem the card is live itself, as 087's table row was
  (the table is retired, 2026-10-01 — research R6's note). The cards and the opened dance render
  from **one set of parts** (research R4), so they cannot disagree.
- **Opening and scrolling both ways** (US2): the hub's read pages **forwards** as well as back from
  a split date (R1). The page opens with the first dance dated today or later last in view (R2, R3),
  loads later dances above without a jump and older ones below, with a button at each end. "Showing
  dances from" is retired.
- **Above the dances** (US3): one title line, "Booking Central — {series}"; on a phone a
  **Performers** button opens the search and the needs-a-contact list (R7).

No schema change. One API change: `/api/bookings/report` gains `split` and `direction` and loses
`horizon` (contracts/report-api.md).

## Technical Context

**Language/Version**: TypeScript (strict), Node 24

**Primary Dependencies**: Next.js 16 (App Router), React 19, Drizzle ORM, Zod

**Storage**: PostgreSQL — no migration

**Testing**: Vitest — unit, component (jsdom, Testing Library), integration (real database)

**Target Platform**: Browsers on phones (iPhone Safari and Chrome, Android Chrome and Samsung
Internet), tablets and computers

**Project Type**: Web application (one Next.js app; `src/app` pages, `src/server` domain)

**Performance Goals**: the opened page shows its first dances as quickly as today's (two small
requests in parallel instead of one); loading a page at either end does not move what is in view

**Constraints**: no sideways scroll from 320 px; every control at least 44 × 44 px (`--tap-min`,
feature 089); nothing only on hover; works on Safari, which lacks CSS scroll anchoring (R3)

**Scale/Scope**: a club calendar of a few hundred dances across four series; pages of 10–40 dances

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan meets it | Pass |
|---|---|---|
| I. Test-First | Each story's tests come first and fail first: the report's two directions and partition (integration), the page's opening position, loading at both ends, cards, the opened dance and the Performers dialog (component), the stylesheet guard entries (unit). | ✅ |
| II. Simplicity / YAGNI | No new endpoint, no schema change, no separate phone page. One set of dance parts instead of three renderers (R4); the default dance comes from the two first pages, not new server logic (R2). One small extraction (`NeedingContactList`) for its second use. | ✅ |
| III. Type Safety | The report's query is validated with a Zod schema at the route (R8); the two directions share the existing typed row shape. | ✅ |
| IV. Observability | The route keeps the structured request logging every `withAuth` route emits; a rejected query answers 422 (`VALIDATION_ERROR`), which the request wrapper logs with its code. No new write path. | ✅ |

**Post-design re-check (after Phase 1)**: unchanged — the contracts add parameters to one read
endpoint and restructure one page; no new write, no new capability, no escape hatch.

## Project Structure

### Documentation (this feature)

```text
specs/091-booking-central-cards/
├── plan.md              # This file
├── research.md          # Phase 0: R1–R9
├── data-model.md        # Phase 1: no new tables; the read's two directions
├── quickstart.md        # Phase 1: validation run
├── contracts/
│   ├── report-api.md    # /api/bookings/report — split, direction, cursor
│   └── page.md          # Booking Central's layout at each width, the card, the opened dance
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/server/domain/bookings/reportService.ts   # split + direction; beforeCursor beside afterCursor
src/server/validation/bookings.ts             # NEW: the report's query schema (R8)
src/app/api/bookings/report/route.ts          # validate; pass split/direction; horizon retired

src/app/(admin)/bookings/
├── page.tsx                  # two-way loading, opening position, the cards, title, Performers
├── danceParts.tsx            # NEW: a dance's parts from (row, actions) — R4
├── HubRow.tsx                # RETIRED with the table (2026-10-01) — the wide card replaces it
├── HubCard.tsx               # NEW: the card (parts without actions; stretched button — R5)
├── DanceView.tsx             # NEW: the opened dance, in Dialog (parts with actions)
├── NeedingContactList.tsx    # NEW: the needs-a-contact list, used by two dialogs (R7)
└── hub.module.css            # cards, the opened dance, the two ends of the list

tests/integration/bookings.report.test.ts     # both directions, the partition, 422s
tests/integration/bookingsReport.booker.test.ts  # unchanged: reads with no split, so `older` stays the default
tests/component/bookingCentral.*.test.tsx     # opening, both ends, cards, opened dance, title
tests/component/fixtures/bookingCentral.ts    # the fixture answers both directions
tests/unit/volunteerStyle.test.ts             # hub.module.css joins the guard (not yet in it)
```

**Structure Decision**: the existing single Next.js app. Domain change in
`src/server/domain/bookings`; the page and its parts stay together under
`src/app/(admin)/bookings/`.

## Complexity Tracking

No violations to justify.
