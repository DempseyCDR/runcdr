# Implementation Plan: Mobile door check-in

**Branch**: `079-mobile-door-checkin` | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/079-mobile-door-checkin/spec.md`

## Summary

Rebuild the door check-in page for a phone, and make the evening's paying count trustworthy.

The page becomes a compact top region — the event confirmed, search, one extras row, Check in anonymously,
Add contact, Show checked in — above scrolling results. Results follow feature 076's name rule and mark who
is already in. Add contact becomes a dialog that suggests existing contacts and, when an email belongs to
someone else, asks rather than silently dropping the address. The roster moves into a dialog.

Research turned on one fact: the paying count needs figures — children, and performers checked in — that
are derived from check-in rows the 90-day purge deletes. So one function computes the whole breakdown for
all four places it appears (research R1), deriving it live while the rows exist so it follows booking
changes, and the purge rolls up what it deletes into a one-row-per-event table (research R2). The organizer
report's rule changes with it: a booked performer is subtracted only when checked in.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node 24, pnpm

**Primary Dependencies**: Next.js 16 (App Router), React 19, Drizzle ORM, Zod

**Storage**: PostgreSQL 16. Hand-written SQL migrations, applied lexically. Next migration **0050**

**Testing**: Vitest — real-Postgres integration tests and jsdom component tests; the phone layout verified in
the browser preview at 390 × 844 (medium phone), with a check at 360 wide

**Target Platform**: Node server; the check-in page on a phone browser at the door

**Project Type**: Web service with admin and door UIs (single Next.js app)

**Performance Goals**: A check-in and its refreshed results feel immediate on a phone. The breakdown is a
handful of small queries per event; the organizer report runs it once per event in the year

**Constraints**: Check-ins are purged after 90 days, and no figure may change when they are (FR-029). Contact
details stay gated by `contact.pii.read`. The door attendant holds `attendance.write`, `contact.write` and
`contact.pii.read` — not `contact.mailing.write`

**Scale/Scope**: 1 new table, 1 new route, 4 extended routes, 1 rebuilt page, 3 new client components
(`AttendanceBreakdownView`, `AddContactDialog`, `CheckedInDialog`) plus `EventConfirm`, 1 component moved
(`ContactName`)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Assessed against constitution **v1.4.0**.

| Principle | Assessment |
|---|---|
| **I. Test-First (NON-NEGOTIABLE)** | PASS. The breakdown, the checked-in-only rule, double bookings, the purge rollup, the email-collision outcomes, the search's `checkedIn` and address rules and the display sort are all tested against a real database. The page's behaviour — extras row reset, Enter, checkmark, dialogs, disabled anonymous with open band — gets jsdom component tests. "Above the fold" cannot be proven in jsdom, so it is verified in the browser preview at a phone viewport and walked in the quickstart. |
| **II. Simplicity / YAGNI** | PASS. One table, justified: FR-029 needs figures the purge would destroy, and the rollup has a single writer. Rejected the heavier alternatives (counters on a dozen write paths, kind on the check-in row) in research R2. The new route is the only way the gate page and door dialog can read one computation; the name rule and correction dialog are reused, not rebuilt. |
| **III. Type Safety** | PASS. The breakdown is one exported type shared by the route, the treasurer report and the component. Request bodies stay Zod-validated; `shareEmail` is an optional literal. |
| **IV. Observability** | PASS. Check-ins, corrections and the purge keep their existing audit and logging. Linking a door-created contact to a shared address records the existing `contact.reference.linked` audit. |

**Development Workflow**: single-contributor mode. Branch and PR mandatory; the author merges; the full gate
suite is the only reviewer.

**Result: no violations.** Complexity Tracking is empty and omitted.

**Post-design re-check**: still PASS. Phase 1 added no capability. The one new route declares `base` and
returns counts and performer names only (research R13). Linking a shared address at door creation adds no
new authority to the door attendant beyond recording the walk-in's address, which she already holds
(research R6).

## Project Structure

### Documentation (this feature)

```text
specs/079-mobile-door-checkin/
├── spec.md                        # /speckit-specify, with Clarifications
├── plan.md                        # this file
├── research.md                    # Phase 0: 13 decisions
├── data-model.md                  # Phase 1
├── quickstart.md                  # Phase 1: automated gates + manual pass at a phone viewport
├── contracts/
│   └── door-checkin.md            # Phase 1: routes + UI contract
├── checklists/
│   └── requirements.md            # /speckit-specify
└── tasks.md                       # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
src/server/db/
├── migrations/0050_event_attendance_rollups.sql  # NEW table
└── schema/attendance.ts                          # eventAttendanceRollups

src/server/domain/attendance/
├── breakdownService.ts            # NEW: getAttendanceBreakdown — the one computation
├── attendanceService.ts           # new contact: owner check, shareEmail link in one transaction, no silent
│                                  # email drop; race → ALREADY_CHECKED_IN; listEventAttendance 'display' sort
└── retentionService.ts            # purge adds children + performers-by-kind to the rollup before deleting

src/server/domain/organizer/
├── danceResult.ts                 # payingDancers unchanged; its performer argument is now checked-in only
└── reportService.ts               # paying from getAttendanceBreakdown
src/server/domain/treasurer/reportService.ts      # report gains `attendance`
src/server/domain/contacts/referenceService.ts    # linkMessageRecipient callable within a transaction
src/server/validation/attendance.ts               # newContact.shareEmail

src/app/api/
├── attendance/search/route.ts                    # eventId → checkedIn; names; active emails; reachedVia
└── events/[id]/
    ├── attendance-breakdown/route.ts             # NEW GET
    └── attendance/route.ts                       # sort=display

src/app/_components/
├── ContactName.tsx                # MOVED from (admin)/contacts/_components/PairContactName.tsx
└── AttendanceBreakdownView.tsx    # NEW: the breakdown and double-booking warnings
src/app/EventSelector.tsx          # default uses the device's local date
src/app/(door)/checkin/
├── page.tsx                       # rebuilt: top region, extras row, results, Enter
├── checkin.module.css             # NEW, mobile-first
├── EventConfirm.tsx               # NEW
├── AddContactDialog.tsx           # NEW: form, suggestions, email-owner choices
└── CheckedInDialog.tsx            # NEW: breakdown, sort, list, opens the existing correction dialog
src/app/(door)/gate/page.tsx       # AttendanceBreakdownView at the top
src/app/(admin)/treasurer/page.tsx # AttendanceBreakdownView at the top (replaces the comps/gift line)
src/app/(admin)/contacts/…         # import ContactName from its new home

tests/integration/
├── attendance.breakdown.test.ts   # NEW: figures, checked-in only, kinds, double bookings, booking changes
├── attendance.purge.test.ts       # extended: breakdown identical across a purge, incl. a split purge
├── door.attendance-new.test.ts    # extended: owner refusal, shareEmail, nothing created on refusal
├── door.checkin-search.test.ts    # extended: checkedIn, active emails ordered, reachedVia, PII gating
├── checkin.sort.test.ts           # extended: display sort
├── organizer.report.test.ts       # updated: performers subtracted only when checked in
└── treasurer.report.test.ts       # extended: attendance breakdown
tests/component/
├── checkin.page.test.tsx          # NEW: layout order, extras row reset, Enter, checkmark, anonymous
├── checkin.addContact.test.tsx    # NEW: suggestions, three email-owner choices
├── checkin.checkedInDialog.test.tsx  # NEW: sort, breakdown, correction refresh
├── attendanceBreakdown.test.tsx   # NEW: conditional sound tech/instructor, warnings
└── checkin.inlineRow / giftCard / correctionModal tests  # updated or retired with the per-row controls
```

**Structure Decision**: the existing attendance domain, where check-in, corrections and the purge already
live; the breakdown joins them. The door page is split into a few components beside it, as the contacts
page was split for Mel. The two cross-surface components live in `src/app/_components/`, since both the
admin and door route groups use them.

## Design notes carried into tasks

Settled by research, not to be re-decided during implementation:

- **`getAttendanceBreakdown` is the only computation.** No surface re-derives paying, children or performer
  counts; the organizer report takes paying from it.
- **Rollup + live.** Figures = `event_attendance_rollups` + what the present check-in rows say. Only the
  purge writes the rollup, adding before it deletes, in its transaction.
- **A performer is checked in through their contact**, counted once per contact under caller → band → sound
  tech → instructor; band = lead musician, musician, open-band musician. Any booking status, this event only.
- **An owned email is checked before anything is created.** Refusal reuses `EMAIL_ACTIVE_ELSEWHERE`;
  `shareEmail` creates, links and checks in in one transaction. The unique-violation swallow is deleted.
- **The extras row resets only after a successful check-in.** Check in anonymously is disabled while open
  band is ticked.
- **"Today" is the device's local date**, for the warning and the selector's default alike.
- **The roster route's default sort stays `last`**; the dialog asks for `display`.
- **Existing organizer-report tests change expectations**, not coverage: they booked performers without
  checking them in.

## Deliberately not in this feature

- Preventing or confirming double bookings at booking time (BK-C2), and performers with no contact (BK-C3).
- The paired-contra open-band comp (dropped from MEG-R7).
- Live updates pushed to another attendant's open dialog.
- Changing the gate page's comp and gift-card entry, or the treasurer report's accounting lines.

## Verification

- **Automated gates (T042), 2026-09-15**, with no dev server running: `pnpm db:migrate`, `pnpm tsc --noEmit`,
  the full suite (1451 tests / 324 files), eslint and prettier on the changed files, `pnpm build` and
  `pnpm lint:md` — all clean.

- **Phone layout (T041), 2026-09-14**, in the browser against Rich's dev server, signed in as the super-user
  (whose volunteer menu is the longest there is — about 300 points of links above the page):
  - **390 × 700** (a medium phone with the browser's bars showing): the event, search, extras row, Check in
    anonymously, Add contact and Show checked in all fit — the last ends at 618 of 700. No horizontal
    scrolling. Results beneath keep name and Check in on one line.
  - **360 × 640**: no horizontal scrolling; the actions wrap to two columns, so Show checked in falls just
    below the fold for the super-user, while Check in anonymously stays above the results (FR-002's small-phone
    rule). A door attendant's menu is three links, not twenty-four, so her page sits about 250 points higher.
  - **375 × 667**: everything down to Show checked in fits (618 of 667).
  - **Checked-in dialog**: breakdown wraps at the top, list scrolls inside the panel, which stays within the
    viewport. **Add contact dialog**: suggestions appear as she types; the panel scrolls within the viewport.
  - **Fixed during the check**: the sort in force looked the same as the other two (now bold with a border),
    and the suggestions had no visible label (now "Already here? Check them in instead:").
- **Manual pass (T043), 2026-09-15**: Rich walked quickstart §1–§4 on the throwaway event and contacts and
  confirmed they pass, then ran the cleanup (verified: no Doory contacts or performer, no Doorcheck Test
  event left). Two findings along the way, neither a 079 defect:
  - The quickstart's setup allowed a Community Dance event, whose series has no sound-tech slot, so the
    double booking could not be made there — corrected to Thursday Night Contra or English Country Dance.
  - The refused sound-tech booking's message sat below the fold on the bookings page — recorded as BK-C4 for
    the booker's mobile pass.
