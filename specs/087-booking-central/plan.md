# Implementation Plan: Booking Central — the Booker's hub

**Branch**: `087-booking-central` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/087-booking-central/spec.md`

## Summary

One page that reads like the Booker's spreadsheet — a row per dance, newest first, the gaps as loud
as the bookings — with every record he needs reachable from the row he is looking at. Four pages are
removed when it is done.

The plan's central finding is that **most of this already exists**. `assembleBookingsReport` returns
a row that is nearly the hub's row; `patchBooking` already advances a status and cascades a band
lead; `createBooking`, `book-band` and `substitutePerformer` are all built and tested. So US2 and
US4 are largely presentation over services that work, and the genuinely new server work is small:
two note columns, a keyset cursor, a performer's booking history, and one combined search.

The risk is not novelty, it is **subtraction**. This feature deletes four pages, and four separate
capabilities were nearly deleted with them during specification alone — the meeting view, the
Financial Secretary's performer editing, the table's filters, and the ability to create a booking at
all. The plan treats every removal as a thing to prove, not to assume.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19, Next.js 16 App Router

**Primary Dependencies**: none new

**Storage**: PostgreSQL 16 via Drizzle. **One migration** adds one nullable column, `events.note`
(the booking's note already exists). No other schema change; band membership stays undated by
decision

**Testing**: Vitest — integration against real Postgres, component tests in jsdom

**Target Platform**: the Booker at a desk. The phone is a separate feature

**Project Type**: web application (one Next.js app; `src/app` + `src/server`)

**Performance Goals**: the table pages by keyset, so scrolling back through years never grows a
query. Not a target — a consequence of choosing a cursor over an offset

**Constraints**: **SC-007 is the safety property** — every capability unchanged. This feature moves
where work happens; it must move nobody's authority. And each of the four page removals must be
shown to have rehomed what the page did

**Scale/Scope**: five stories, one migration, one new page, four deleted, one page (`/payments`)
gaining a host for an existing component

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this feature satisfies it |
|---|---|
| **I. Test-First** | Every story is red-first, and two deserve naming: the status control **must be proved unable to decline anyone** however many times it is clicked (FR-011), and a band's membership change must be proved to leave every booking untouched (FR-025, SC-005). Both are properties, not examples, and both are tested as such. |
| **II. Simplicity / YAGNI** | The feature is large but nothing in it is speculative — every story answers something Rich named. Explicitly NOT building: dated band membership (R4), the retired filters (FR-001b), event creation in the hub (FR-013b), a phone surface, a printable view (B59). The table's only control is the horizon. |
| **III. Type Safety** | The row type is one shape shared by the read and the page; adding the notes and instructor to it makes every consumer a compile error rather than a silent omission. |
| **IV. Observability** | Unchanged. Booking writes already record audit rows; the new note columns ride the existing booking and event writes. |

**Result: PASS.** Re-checked after Phase 1 — still PASS; Complexity Tracking stays empty. The size
is managed by strict story order, not by an exemption: US1 alone replaces the spreadsheet for
reading, and each later story removes a menu entry only once its replacement is real.

## Project Structure

### Documentation (this feature)

```text
specs/087-booking-central/
├── plan.md              # This file
├── research.md          # Phase 0 — nine findings; R1 and R9 changed the design
├── data-model.md        # Phase 1 — migration 0058 and the row's evolution
├── quickstart.md        # Phase 1
├── contracts/
│   └── hub.md           # Phase 1 — the table read, the writes, the removals
├── checklists/
│   └── requirements.md  # From /speckit-specify — 16/16
└── tasks.md             # /speckit-tasks — NOT created here
```

### Source Code (repository root)

```text
src/
├── server/
│   ├── db/migrations/0058_booking_notes.sql     # events.note (bookings.note exists)
│   └── domain/bookings/
│       ├── reportService.ts                     # becomes the hub's read (R1)
│       └── performerHistory.ts           # NEW — a performer's dances (US3; the phone reuses it)
├── app/
│   ├── (admin)/bookings/                        # the hub (R8) — replaces the thin list
│   ├── (admin)/_components/AdminPage.module.css # the admin identity (R7)
│   ├── (admin)/payments/page.tsx                # hosts the performer editor (FR-030a)
│   ├── (admin)/bookings-report/                 # DELETED
│   ├── (admin)/bands/                           # DELETED
│   └── (admin)/manage/performers/               # DELETED — its form becomes a shared component
└── server/auth/nav.ts                           # four entries out, one in

tests/
├── integration/   # the row, the cursor, notes, history, search, the capability guard
└── component/     # the table, the gaps, the status control, the band lineup, the hosted editor
```

**Structure Decision**: the hub takes over `/bookings` — the thin booking list it replaces — rather
than inventing a path. `/bookings-report`, `/bands` and `/manage/performers` are removed outright.

## Phase 0 — Research

See [research.md](./research.md). Nine questions; the two that changed the design:

- **R1 — the hub's row already exists.** `BookingsReportRow` carries the venue short name,
  `hasSoundTech`, caller, band, musicians, sound tech, cancelled, and every booking's id, type and
  status. The hub needs four additions (start time, label, venue id, notes), one removal that is a
  **behaviour change** (open-band musicians are in that row today and must leave, FR-007), and a
  cursor. This is an evolution, not a new read.
- **R9 — the writes are all built.** `patchBooking` advances a status **and already cascades a band
  lead**; `createBooking` fills a gap; `book-band` books a lineup; `substitutePerformer` does US4's
  substitution. US2 and US4 are presentation over tested services.

The rest: **R2** keyset pagination on `(date, id)` descending, with the horizon as the upper bound;
**R3** one new note column — the booking's already existed; **R4** band membership stays undated
because the bookings are the history; **R5** the performer editor is already a component and only
needs a second host; **R6** both searches already accept `?q=`; **R7** the admin identity is a layer
over tokens that already exist in `globals.css`, not a design system; **R8** the hub takes
`/bookings`.

## Phase 1 — Design

- [data-model.md](./data-model.md) — migration 0058, the row's evolution, and what must not move.
- [contracts/hub.md](./contracts/hub.md) — the table read and its cursor, the writes reused
  unchanged, the two new reads, and the four removals.
- [quickstart.md](./quickstart.md) — gates, then a manual pass per story, ending with the guard that
  the four removals cost nobody anything.

## Complexity Tracking

> No constitution violations. Table intentionally empty.
