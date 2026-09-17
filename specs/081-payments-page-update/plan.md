# Implementation Plan: Performer payments, rebuilt for Mary

**Branch**: `081-payments-page-update` | **Date**: 2026-09-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/081-payments-page-update/spec.md`

## Summary

Rebuild `/payments` for a phone and make the payment record trustworthy.

The page is split into a small page and a set of dialogs, topped by the event confirmation from
`/checkin` and a new summary shared with `/gate`. The integrity rules move into the database where
they can: a payment now has a **method** (check or cash), check numbers are unique club-wide, and a
booking has at most one **live** payment line — enforced by a partial unique index on a denormalised
`live` flag that voiding clears (research R2, R3). The rules that need a person's judgement — a
second payment to the same performer, an existing check number — are server refusals the page turns
into a choice (R4, R5).

Cash payments to performers flow into the gate: the stored deposit is recomputed on every
cash-affecting write, so the gate, organizer and treasurer reports stay correct without a second
entry (R7). A performer not paid on the night can be paid from any evening in the next 90 days; the
payment belongs to the evening the money comes from, as feature 023 already allows (R14). The
treasurer report lists every check — live and voided — by number, with booked-versus-paid where they
differ (R15).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node 24, pnpm

**Primary Dependencies**: Next.js 16 (App Router), React 19, Drizzle ORM, Zod

**Storage**: PostgreSQL 16. Hand-written SQL migrations, applied lexically. Next migration **0051**

**Testing**: Vitest — real-Postgres integration tests and jsdom component tests; the phone layout
checked in the browser preview at 390 × 844, with a check at 360 wide

**Target Platform**: Node server; `/payments` and `/gate` on a phone browser

**Project Type**: Web service with admin and door UIs (single Next.js app)

**Performance Goals**: an event has a handful of bookings and payments; the summary and list are a
few small queries. The earlier-bookings lookup is bounded to one performer and 90 days

**Constraints**:

- Money writes are `performer_payment.write`, scoped to the event's series; the gate's are
  `gate.write`.
- Cross-event lines (023) must keep working.
- The stored deposit is read by the gate, organizer report and treasurer report, so it must be
  refreshed inside the same transaction as any cash-affecting write.
- The migration must not guess at existing duplicates — it stops and names them (R3).

**Scale/Scope**: 1 migration; 6 changed routes, 5 new routes; 3 services changed (payments,
bookings, door record) plus the treasurer report; `/payments` rebuilt as a page and ~10 components;
2 shared components (`EventConfirm` moved, `PaymentSummaryView` new); `/gate` and `/treasurer`
updated

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Assessed against constitution **v1.4.0**.

| Principle | Assessment |
|---|---|
| **I. Test-First (NON-NEGOTIABLE)** | PASS. Every rule — method and number, unique number, one live line, second-payment confirmation, cash single-booking, void once, replacement link, deposit refresh, free-unless-set, substitution copying, earlier bookings, the summary invariant, the treasurer report's new lists — gets a failing integration test against a real database first, including a direct-to-service race for the unique rules. The migration's refusal on duplicates is tested. Page behaviour gets jsdom tests; the phone layout is verified in the browser preview. |
| **II. Simplicity / YAGNI** | PASS, with one justified addition: the `live` flag on `payment_bookings` duplicates "payment not voided" so the database can enforce one live payment per booking (R2) — the service-only alternative relies on every write path remembering a lock. No new tables. The new routes are each the only way a dialog can get what it shows (roles and rates, unpaid earlier bookings, the shared summary, add-a-line). |
| **III. Type Safety** | PASS. `payment_method` is a DB enum mirrored in Zod; request bodies stay Zod-validated with refinements for method/number/lines; the summary and payment view are exported types shared by routes and components; 409 details are typed per code. |
| **IV. Observability** | PASS. Create, update, void and delete keep their audit events, with delete now recording what was erased (number, method, amount, lines); the deposit refresh is logged with the event and the new figure. Refusals are logged server-side with request IDs, as all API errors are. |

**Development Workflow**: single-contributor mode. Branch and PR mandatory; the author merges; the
full gate suite is the only reviewer.

**Result: no unjustified violations.** Complexity Tracking below records the one addition.

**Post-design re-check**: still PASS. Phase 1 added no capability: the new read routes are `base` or
`performer_payment.write`; creating a performer from a dialog uses the existing `performer.write`
route, which the Financial Secretary already holds.

## Project Structure

### Documentation (this feature)

```text
specs/081-payments-page-update/
├── spec.md                  # /speckit-specify + /speckit-clarify
├── plan.md                  # this file
├── research.md              # Phase 0: 19 decisions (R1–R18 and R3a)
├── data-model.md            # Phase 1: migration 0051 and entity rules
├── quickstart.md            # Phase 1: gates, duplicate cleanup, manual pass
├── contracts/
│   └── payments.md          # Phase 1: routes, errors, page contracts
├── checklists/
│   └── requirements.md      # /speckit-specify
└── tasks.md                 # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
src/server/db/
├── migrations/0051_payment_integrity.sql     # NEW: method, unique number, live lines, requires_check rule
└── schema/
    ├── enums.ts                              # paymentMethodEnum
    └── performerPayments.ts                  # method; payment_bookings.live

src/server/domain/payments/
├── performerPaymentService.ts                # method rules, unique number, one live line, second-payment,
│                                             # add line, void once, replacement link, delete audit,
│                                             # deposit refresh, list view (voided/paid elsewhere/lines)
├── paymentSummary.ts                         # NEW: getPaymentSummary
├── order.ts                                  # NEW (pure): orderBookings, compareCheckNumbers
└── unpaidBookings.ts                         # NEW: a performer's earlier unpaid bookings (90 days)
src/server/domain/bookings/bookingService.ts  # free-unless-set; settlement pay + ALREADY_BOOKED;
                                              # substitution copies the booked amount
src/server/domain/performers/performerRules.ts   # instructor / open band payable when booked
src/server/domain/performers/performerService.ts # searchPerformers bookedAs
src/server/domain/door/calc.ts                # depositCents with performer cash
src/server/domain/door/doorRecordService.ts   # refreshDeposit; performerCash on the view
src/server/domain/treasurer/reportService.ts  # checks, cashPayments, otherCashPaidOut, paidElsewhere
src/server/validation/payments.ts             # method, confirmSecondPayment, payee, add-line, pay
src/server/lib/apiError.ts                    # new codes

src/app/api/
├── performer-payments/route.ts               # changed
├── performer-payments/[id]/route.ts          # PATCH changed; DELETE used
├── performer-payments/[id]/lines/route.ts    # NEW
├── performer-payments/[id]/void/route.ts     # changed
├── events/[id]/performer-payments/route.ts   # richer view
├── events/[id]/payment-summary/route.ts      # NEW
├── events/[id]/roles/route.ts                # NEW
├── events/[id]/settlement-performer/route.ts # pay
├── performers/route.ts                       # eventId → bookedAs
└── performers/[id]/unpaid-bookings/route.ts  # NEW

src/app/_components/
├── EventConfirm.tsx (+ .module.css)          # MOVED from (door)/checkin
└── PaymentSummaryView.tsx (+ .module.css)    # NEW
src/app/(door)/checkin/page.tsx               # import EventConfirm from its new home
src/app/(admin)/payments/
├── page.tsx                                  # rebuilt: top, list, actions
├── payments.module.css                       # NEW, mobile-first
├── PerformerRow.tsx                          # NEW: to pay / free / paid / paid elsewhere / voided
├── PerformerPicker.tsx                       # NEW: search, bookedAs, create performer (+ contact)
├── AddPerformerDialog.tsx                    # NEW
├── SubstituteDialog.tsx                      # NEW
├── SeveralPerformersDialog.tsx               # NEW (checks only)
├── EarlierBookingDialog.tsx                  # NEW
├── EditPaymentDialog.tsx                     # NEW
├── VoidDialog.tsx / DeleteDialog.tsx         # NEW
├── ConfirmDialog.tsx                         # NEW: second payment, number taken
└── savePayment.ts                            # NEW: one client path that turns 409s into the choices
src/app/(door)/gate/page.tsx                  # summary; performers' cash line; "Other cash paid out"
src/app/(admin)/treasurer/page.tsx            # checks list; cash payments; paid elsewhere

tests/integration/
├── payments.method.test.ts                   # NEW: check/cash rules, cash single booking
├── payments.integrity.test.ts                # NEW: number form and uniqueness, one live line,
│                                             #      races, second payment
├── payments.correct.test.ts                  # NEW: edit payee/lines, add line, delete audit, void once,
│                                             #      replacement link
├── payments.deposit.test.ts                  # NEW: cash refreshes deposit; gate update keeps it
├── payments.summary.test.ts                  # NEW: figures, invariant, declined, free, earlier paid here
├── payments.earlier.test.ts                  # NEW: 90-day list, scope, paid elsewhere
├── payments.migration.test.ts                # NEW: 0051 refuses duplicates; backfills cash and live
├── payments.addSettlementPerformer.test.ts   # extended: pay, ALREADY_BOOKED, free unless set
├── booking.substituteDiscriminator.test.ts   # extended: booked amount copied on both paths
├── performerSearch.test.ts                   # extended: bookedAs
├── treasurer.paymentLines.test.ts            # extended: checks, cash, paid elsewhere, booked vs paid
└── performerPayments / paymentVoid / payments.multiCheckEdit / treasurer.performer-payments /
    eventDelete.crossEventPayment             # updated for `method`, void once, no number-less checks
tests/component/
├── payments.page.test.tsx                    # NEW: order, summary, row states, record, cash, notes box
├── payments.dialogs.test.tsx                 # NEW: add, substitute, several, earlier, edit
├── payments.choices.test.tsx                 # NEW: number taken, second payment, void, delete wording
├── paymentSummary.test.tsx                   # NEW
├── gate.performerCash.test.tsx               # NEW
├── treasurer.page.test.tsx                   # extended: checks list, cash payments, paid elsewhere
└── payments.addPerformer / allocation / donateAtSettlement / freeRows / inlineEdit /
    multiCheckGuard / perPerformer / substitute   # rewritten or retired with the old page
```

**Structure Decision**: the payments domain keeps the rules; two small modules join it for the
summary and the earlier-bookings lookup. The page is split into components beside it, as `/checkin`
was in 079. The two cross-page components live in `src/app/_components/`.

## Design notes carried into tasks

Settled by research, not to be re-decided during implementation:

- **The database enforces** one number per check (live or voided) and one live line per booking; the
  service checks first to give a clear 409 and maps unique violations to the same codes for races.
- **A check number is `^[0-9]+[A-Z]?$`**, upper-cased and trimmed on the way in (lower-case letters
  accepted and capitalised), enforced by a table check as well as Zod; sorted by its digits, then
  its letter (research R3a).
- **The server decides the choices**: `CHECK_NUMBER_TAKEN` (with `sameEvent`, `voided`) and
  `SECOND_PAYMENT_TO_PAYEE` (overridden by `confirmSecondPayment`). The page never pre-checks.
- **Cash** = no number, one line, never voided; refreshes the deposit. **Check** = number, one or
  more lines.
- **Deposit** = gross − float − other paid out − live performer cash at the event, refreshed in the
  same transaction as the write that changes any of them.
- **A payment belongs to the event where the money was paid**; lines may settle bookings up to 90
  days earlier (the lookup's limit — the create path still accepts any existing booking, as 023
  does).
- **Counted bookings** exclude declined bookings with no live line.
- **Free unless set** applies at booking time only; paying a $0 booking never changes its booked
  amount.
- **Substitution copies** `pay_cents`, `is_overridden` and `requires_check`.
- **The treasurer report keeps its old fields** alongside the new ones until the page stops reading
  them.
- **The migration stops on existing duplicates.** The development database is cleaned first
  (quickstart).

## Deliberately not in this feature

- The gate page's rebuild, named sales and the counting dialog (MARY-R8, R15, R16).
- A home for unmatched online payments (B52); unconfirmed-booking warnings (BK-C5).
- Payment methods other than check and cash; a second role for an already-booked performer.
- Automatic repair of duplicate check numbers.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| `payment_bookings.live` (denormalised "payment not voided") | Lets a partial unique index enforce one live payment per booking (FR-011, SC-002) | A service-side lock holds only while every write path remembers it; a trigger is more machinery than one flag that only voiding changes |

## Verification

- **Automated gates (T066), 2026-09-17**, with no dev server running: `pnpm db:migrate` (nothing
  new), `pnpm tsc --noEmit`, the full suite (**1572 tests / 334 files**), eslint and prettier on the
  changed files, `pnpm build` and `pnpm lint:md` — all clean. `.next/dev` cleared after the build.

- **P1 checkpoint — automated, 2026-09-16**: full suite 1545 tests / 332 files green; `tsc`, eslint
  and prettier clean on the changed files. Migration 0051 applied to the development database (no
  duplicate or malformed check numbers; 13 number-less payments became cash).
- **P1 checkpoint — phone layout (first run of T067), 2026-09-16**, in the browser pane on Rich's
  dev server, signed in as the super-user, on the 2026-09-13 English Country Dance (7 bookings, 2
  checks):
  - **390 × 844**: no horizontal scrolling on `/payments`; rows in paying order; the summary starts
    at 457 (below the super-user's long menu) and the first row is above the fold. Every button,
    field and select in the page and its dialogs is at least 44 px tall, except the radio circles
    (13 px — their labels are 44 px and take the tap) and the shared **Change** link (27 px, as
    accepted on `/checkin` in 079). The Void (261 px), Edit (455 px) and several-performers (647 px
    with two bookings ticked) dialogs sit within the viewport.
  - **360 × 640**: no horizontal scrolling; the row fields drop to one column; the
    several-performers dialog with every booking ticked scrolls inside its panel (bottom at 632);
    Edit fits (488).
  - **`/gate` at 390**: the payments summary sits under the attendance breakdown; "Other cash paid
    out" is labelled. The page still scrolls sideways (425 px) because of its existing
    anonymous-sales table — the gate rebuild (MARY-R15) replaces it; not an 081 change.
  - The pane's screenshots lag the emulated viewport, so the check relied on measured layout rather
    than images. Nothing was saved.
- **Phone layout, all dialogs (T067), 2026-09-17**, same setup, on the 2026-09-17 Thursday Night
  Contra (4 bookings). Nothing was saved.
  - **390 × 844**: no horizontal scrolling. The four actions (Add, Substitute, One check several
    performers, Pay an earlier booking) sit two per row, 44–47 px tall. **Add a performer** with a
    long result list and **Substitute** fill the viewport and scroll inside their panel; once a
    performer is picked, Add shrinks to 236 px (Role, Amount). **Pay an earlier booking** for a
    performer with two unpaid bookings lists them as 44 px choices ("2026-09-16 · musician ·
    $125.00") and, once one is chosen, the payment fields — 463 px in all; for one with none it says
    "No unpaid bookings in the 90 days before this event." Nothing in any dialog is under 44 px, bar
    radio circles whose labels take the tap.
  - **360 × 640**: no horizontal scrolling; the actions stack in one column; Add (picked 306 px;
    creating a new person 422 px), Substitute (264 px) and Pay an earlier booking (533 px with a
    booking chosen) fit without scrolling.
  - **375 × 667**: no horizontal scrolling; the summary at 437 and the first row at 487.
  - **`/treasurer` at 390**: no horizontal scrolling; the checks list and the Cash paid out section
    render (this evening: "No checks", "None"). Opening the report records a generation, as it
    always has, so this evening's Delete now carries the "treasurer report has been generated"
    warning.
  - The first call to a new route compiles slowly in the dev server; the earlier-booking list
    appeared once it had.
- **Manual pass (T068), 2026-09-17**: Rich walked quickstart §1–§5 on fresh throwaway data; all five
  pass. Findings, all fixed before the PR:
  - The event heading reads series first, then label, date and a 12-hour time — on `/checkin` too,
    since they share `EventConfirm`.
  - The Void/Delete explanation was on every paid row; Rich asked for tooltips on the buttons, or
    failing that the text once above the list. Phones cannot hover, so it is now shown once, above
    the list.
  - A voided check's quiet line now sits directly under the payment line and note, above the
    actions.
  - The delete warning appears only when the treasurer report was generated after the event's day
    (Mike works from it the next day) and no longer names him: "It may already be in the ledger."
  - The quickstart said the several-performers dialog could not raise the second-payment question;
    it can, when the performer still has an unpaid booking (corrected).
  - For the gate feature: the deposit line should sit above the fold, near the performer-payments
    summary (recorded under MARY-R15).
- **After the fixes, 2026-09-17**: full suite **1576 tests / 334 files**, `pnpm build`, `tsc`,
  eslint and prettier clean; no server code changed.
