# Implementation Plan: The Booker's records — edit anything, find it by name, archive it

**Branch**: `084-booker-record-editing` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/084-booker-record-editing/spec.md`

## Summary

Three repairs to the Booker's records, and one page removed.

**Edit anything**: venues, performers and events collect more when created than can be changed afterwards.
The fix is one form per record used for both, sending only the fields that were touched. The event form
already exists — `EventModal` edits nearly everything — it is simply unreachable from `/events`.

**Find by name**: the performers and bands pages list the whole roster. They become search-led, copying
the contact directory's proven shape (focus on open, search as you type, 20 results with a truncation
flag, an "include archived" switch).

**Archive**: only `bands` can be retired today. Venues and performers gain `archived_at` (migration
**0056**), the read paths that offer them gain the predicate, and history keeps naming them. Bands gains
the **restore** it never had.

**And the unlinked performers** — 19 of them, deferred since feature 072 — are settled as each is opened:
link, create, or archive. The suggestion must survive a misspelling, because the live case is a performer
recorded as "Clara Reidlinger" whose contact is "Clara Riedlinger" (research R5).

Venue rents move onto the venue form; the separate page and its menu entry go.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19, Next.js 16 App Router

**Primary Dependencies**: none new — `pg_trgm` is already installed and already used by the duplicate queue

**Storage**: PostgreSQL 16 via Drizzle. One migration: `archived_at` on `venues` and `performers`

**Testing**: Vitest — integration against real Postgres, component tests in jsdom, unit for pure logic

**Target Platform**: the Booker at a laptop; the forms must still work at phone width

**Project Type**: web application (one Next.js app; `src/app` + `src/server`)

**Performance Goals**: a search returns within the page's normal render; 20 results plus a truncation
probe, as the contact directory does

**Constraints**: no report of a past event may change (SC-006); archiving must never delete; the public
roster must not advertise an archived performer

**Scale/Scope**: ~200 performers, ~20 venues, ~19 unlinked performers to drain, a few hundred events

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this feature satisfies it |
|---|---|
| **I. Test-First** | Every slice is driven by a failing test: the migration's columns and their absence beforehand; each read path that must exclude an archived record (and each that must not); search order and truncation; the fuzzy link suggestion, asserted on the real "Reidlinger / Riedlinger" pair; partial-field saves; rent deletion refused when an event used the row. |
| **II. Simplicity / YAGNI** | Nothing new is invented: search copies `searchContacts`, the suggestion reuses the duplicate queue's `similarity()` on `dedup_normalized`, archiving copies `archiveBand`, and venue rents are already append-only so FR-029 needs no change at all. No version column, no optimistic-locking machinery — clarification Q1 settled that. |
| **III. Type Safety** | Archived state is a nullable timestamp, as on bands; no new escape hatches. Search and suggestion results are typed view models at the service boundary, as the contacts service already returns. |
| **IV. Observability** | Archive and restore write audit entries beside `band.deleted`'s; the rent delete does too, since it removes a row a report once resolved. |

**Result: PASS.** Re-checked after Phase 1 — still PASS. Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/084-booker-record-editing/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── records.md       # Phase 1 output — the routes and the form contracts
├── checklists/
│   └── requirements.md  # From /speckit-specify, re-validated by /speckit-clarify
└── tasks.md             # /speckit-tasks — NOT created here
```

### Source Code (repository root)

```text
src/
├── server/
│   ├── db/
│   │   ├── migrations/0056_archive_venues_performers.sql   # NEW
│   │   └── schema/{venues,performers}.ts                   # + archivedAt
│   └── domain/
│       ├── venues/venueService.ts          # archive/restore; list excludes archived
│       ├── venues/venueRentService.ts      # NEW or extended — delete an unused rent
│       ├── performers/performerService.ts  # archive/restore; search; list excludes archived
│       ├── performers/linkSuggestions.ts   # NEW — fuzzy contact candidates for a performer
│       ├── bands/bandService.ts            # + restore, + search
│       ├── public/publicPerformers.ts      # archived never public (FR-031)
│       └── public/publicVenues.ts          # archived venue not offered
├── app/
│   ├── (admin)/venues/page.tsx             # one form, rents section, archive
│   ├── (admin)/manage/performers/page.tsx  # search-led, one form, archive, link question
│   ├── (admin)/bands/page.tsx              # search-led
│   ├── (admin)/events/page.tsx             # reuse EventModal for edit
│   ├── (admin)/venue-rents/                # DELETED (FR-017)
│   ├── (admin)/_modals/EventModal.tsx      # the one event form
│   └── api/
│       ├── performers/route.ts             # + ?q=&archived=
│       ├── performers/[id]/archive/route.ts        # NEW
│       ├── performers/[id]/link-suggestions/route.ts # NEW
│       ├── bands/route.ts                  # + ?q=&archived=
│       ├── venues/[id]/archive/route.ts    # NEW
│       └── venue-rents/[id]/route.ts       # NEW — DELETE an unused rent
└── server/auth/nav.ts                      # venue-rents entry removed

tests/
├── integration/   # migration, archive + read paths, search, link suggestions, rent delete
├── component/     # the three forms, the search pages, the link question
└── unit/          # anything pure that falls out
```

**Structure Decision**: unchanged app structure. Services keep the rules (what is offered, what is
suggested, what may be deleted); pages render them. The one deliberate reuse is `EventModal` — it becomes
*the* event form rather than a second way to edit an event.

## Phase 0 — Research

See [research.md](./research.md). Seven questions; the load-bearing findings:

- **R1** Bands has archive but **no restore** — the spec requires one (FR-012), so restore is added for all
  three. FR-020's "leave bands as it is" is corrected to "bands gains restore and search".
- **R3** Venue rents are **already append-only** (POST only, no PATCH). Clarification Q2's decision is what
  the data already does; only the delete-an-unused-row path is new.
- **R5** `matchPerformers` matches on **exact** normalized name, which is why Clara was never linked. The
  duplicate queue's `similarity()` scores the real pair at **0.619** against a next-best of **0.240**, with
  the existing threshold at 0.4 — so the fuzzy suggestion is a reuse, not an invention.
- **R6** Every PATCH endpoint already applies only the fields present, so FR-028 is a rule about what the
  forms SEND, not a server change.

## Phase 1 — Design

- [data-model.md](./data-model.md) — migration 0056, the archived-state rules, and which reads gate on it.
- [contracts/records.md](./contracts/records.md) — the new and changed routes, and what each form owes.
- [quickstart.md](./quickstart.md) — gates, then the manual pass, including draining Clara's queue entry.

## Complexity Tracking

> No constitution violations. Table intentionally empty.
