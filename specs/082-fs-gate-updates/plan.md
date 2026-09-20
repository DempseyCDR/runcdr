# Implementation Plan: The gate evening, and the report the Treasurer reads

**Branch**: `082-fs-gate-updates` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/082-fs-gate-updates/spec.md`

## Summary

Rebuild the gate page for a phone, record each check the door takes in, and turn the treasurer page
into the gate report the Treasurer reads and prints.

The Treasurer's answer decided the shape: every check is recorded with its writer and what it pays
for. A check's lines *are* gate sales, so a check becomes a small `gate_checks` row and its lines
become `gate_sales` rows with `payment_method = 'check'` (research R1, R2) — which keeps the money
derivation, the membership enrolment and both reports working with one change each. Admission gains
a third source (paid by check), the counting dialog loses checks, and the deposit becomes a list:
the evening's main deposit plus one for each check Mary marks for its own (R3, R4).

Two habits change on the way. The gate's Save keeps the money figures and the anonymous totals,
while named sales and checks are written one at a time, so a sale the door records is never replaced
(R5). And every one of these writes records the signed-in volunteer, so the report can say who
filled it in (R7) — which is also what lets the door correct its own entries without holding the
gate's authority (R6).

One rule rides along, because it is about what a payment means: paying a performer whose booking is
still proposed, requested or tentative confirms that booking (R12).

**Revised 2026-09-18 after the P1 review** (research R16–R19): the gate's Save stops carrying sales
— every sale, named or anonymous, is its own line written through the shared dialog, now **Add a
sale** with cash, check or card; "How many?" and a quantity are optional on any line (migration
0055); and the treasurer page is laid out as the paper gate report — a header, receipts and expenses
side by side, then deposits and notes. Phase 11 of tasks.md carries it.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node 24, pnpm

**Primary Dependencies**: Next.js 16 (App Router), React 19, Drizzle ORM, Zod

**Storage**: PostgreSQL 16. Hand-written SQL migrations, applied lexically. Next migrations **0052**
and **0053** (two files: an enum value cannot be used in the transaction that adds it)

**Testing**: Vitest — real-Postgres integration tests and jsdom component tests; the phone layout
and the print layout verified in the browser preview (390 × 844, 360 wide; print to landscape
letter)

**Target Platform**: Node server; `/gate` and `/checkin` on a phone at the door, `/treasurer` on a
laptop

**Performance Goals**: an evening has a handful of sales and checks; the money preview is arithmetic
on the client, and the report is a few small queries

**Constraints**:

- `computeEventGate` feeds the organizer report as well as the treasurer report, so its two derived
  figures must keep their meaning while admission gains a third source.
- Gate money stays `gate.write`, event-scoped; the door holds `attendance.write` and must be able to
  add a sale or check without it.
- Gate records are never purged (the 90-day purge is check-ins only).
- The gate page is a phone page; the report is a laptop page that prints.

**Scale/Scope**: 2 migrations; 1 new table and 6 new columns; 6 new routes and 4 changed; 3 services
changed (door record, gate money, payments) plus the treasurer report; `/gate` rebuilt as a page and
~8 components; 1 shared sale-or-check dialog used by `/checkin`; `/treasurer` re-laid out with print
styles

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Assessed against constitution **v1.4.0**.

| Principle | Assessment |
|---|---|
| **I. Test-First (NON-NEGOTIABLE)** | PASS. Every rule lands as a failing test first: the migration's constraints, a check and its lines (including a membership line enrolling), admission by check, the deposit list, the narrowed Save, the door's authority and "your own entry", who recorded it, the cash count kept and cleared, the report's new sections, and paying confirming a booking. Page behaviour gets jsdom tests (sections and order, live figures, warnings only after Save, the unsaved guard, the counting keypad, the shared dialog on both pages, the report's blocks). Print and the phone layouts cannot be proven in jsdom, so they are verified in the browser preview and walked in the quickstart. |
| **II. Simplicity / YAGNI** | PASS. A check's lines reuse `gate_sales` rather than a second line table; deposits are derived, not stored; the count in progress is a column on the row that already holds the evening, not a table. The one new table is the check itself, which has facts of its own (writer, note, deposit-separately). No new capability: the door's existing `attendance.write` carries its new action (R6). |
| **III. Type Safety** | PASS. `payment_method` gains `check` in the DB enum and in the Zod schemas that mirror it; the sale, check, deposit and report views are exported types shared by routes, pages and the report; the money derivation is one pure typed function used by both the client preview and the server. |
| **IV. Observability** | PASS, and it improves what exists: gate money, sales, checks and payments now record the signed-in contact and write audit events naming them, replacing today's "door"/"admin" placeholders. |

**Development Workflow**: single-contributor mode. Branch and PR mandatory; the author merges; the
full gate suite is the only reviewer.

**Result: no violations.** Complexity Tracking is empty and omitted.

**Post-design re-check**: still PASS. Phase 1 added no capability and no third table; the door's new
action is authorised by a capability it already holds, and every cross-page figure comes from one
shared function.

## Project Structure

### Documentation (this feature)

```text
specs/082-fs-gate-updates/
├── spec.md                  # /speckit-specify
├── plan.md                  # this file
├── research.md              # Phase 0: 15 decisions
├── data-model.md            # Phase 1: migrations 0052/0053 and the entity rules
├── quickstart.md            # Phase 1: gates, a manual pass, the print check
├── contracts/
│   └── gate.md              # Phase 1: routes, errors and the three page contracts
├── checklists/
│   └── requirements.md      # /speckit-specify
└── tasks.md                 # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
src/server/db/
├── migrations/0052_gate_payment_method_check.sql   # NEW: the enum value, alone
├── migrations/0053_gate_checks.sql                 # NEW: gate_checks, line columns, note, count, recorded-by
└── schema/
    ├── enums.ts                                    # payment_method gains "check"
    └── door.ts                                     # gateChecks; gate_sales + door_records columns

src/server/domain/gate/
├── eventMoney.ts                 # admission by check; checks total
└── deriveGateMoney.ts            # NEW (pure): admission, fee, checks total, main deposit — client and server
src/server/domain/door/
├── doorRecordService.ts          # evening note, cash count, money recorder, warnings, deposits
├── gateSaleService.ts            # NEW: one named sale at a time (create/patch/delete, enrolment, authority)
├── gateCheckService.ts           # NEW: a check and its lines (create/patch/delete, enrolment, authority)
└── deposits.ts                   # NEW: eventDeposits — the main deposit and one per marked check
src/server/domain/payments/performerPaymentService.ts  # recorded-by; paying confirms the booking (R12)
src/server/domain/treasurer/reportService.ts           # checks received, deposits, notes, recorded-by
src/server/validation/door.ts                          # anonymous-only PUT; sale, check and line schemas
src/server/lib/apiError.ts                             # 4 new codes

src/app/api/
├── door-records/[id]/sales/route.ts       # NEW POST
├── door-records/[id]/checks/route.ts      # NEW POST
├── gate-sales/[id]/route.ts               # NEW PATCH, DELETE
├── gate-checks/[id]/route.ts              # NEW PATCH, DELETE
├── door-records/[id]/route.ts             # PATCH: note, count, warnings, deposits, recorder
├── door-records/[id]/gate-sales/route.ts  # anonymous only
└── events/[id]/door-record/route.ts       # payload gains checks and the new figures

src/app/_components/
└── SaleOrCheckDialog.tsx (+ .module.css)  # NEW: the shared dialog (a sale, or a check with lines)
src/app/(door)/checkin/page.tsx            # NEW action: record a sale or check
src/app/(door)/gate/
├── page.tsx                                # rebuilt: sections in order, live figures, Save + warnings
├── gate.module.css                         # NEW, mobile-first
├── MoneyPreview.tsx                        # NEW: admission, fee, checks total, deposit — above the fold
├── DoorCounts.tsx / CashSection.tsx / CardSection.tsx / OtherSales.tsx   # NEW sections
├── CountDialog.tsx                         # NEW: denominations + on-screen keypad
├── NamedSaleList.tsx / CheckList.tsx       # NEW: the lists, each row saved on its own
└── DepositList.tsx                         # NEW
src/app/(admin)/treasurer/
├── page.tsx                                # checks received, deposits, notes, recorded-by
└── treasurer.module.css                    # NEW: laptop layout + @page landscape letter (+ phone, last)

tests/integration/
├── gate.checks.test.ts             # NEW: a check, its lines, membership enrolment, refusals
├── gate.checkMoney.test.ts         # NEW: admission by check, checks total, gross cash unchanged
├── gate.deposits.test.ts           # NEW: the main deposit and one per marked check
├── gate.sales.test.ts              # NEW: one sale at a time; the narrowed PUT; the door's authority
├── gate.recordedBy.test.ts         # NEW: who recorded the money, a sale, a check, a payment
├── gate.cashCount.test.ts          # NEW: kept while counting, cleared on save
├── gate.retention.test.ts          # NEW: the purge leaves gate records alone
├── payments.confirmOnPay.test.ts   # NEW: proposed/requested/tentative → confirmed; declined untouched
├── migration.gateChecks.test.ts    # NEW: 0052/0053 constraints and idempotence
├── treasurer.gateReport.test.ts    # NEW: checks received, deposits, notes, recorded-by
└── door.record-update / gate.membership / treasurer.report / organizer.report  # updated for the new shapes
tests/component/
├── gate.page.test.tsx              # NEW: order, live figures, warnings after Save, unsaved guard
├── gate.countDialog.test.tsx       # NEW: keypad, running total, use as gross cash, kept counts
├── gate.checks.test.tsx            # NEW: the check list and its dialog
├── saleOrCheckDialog.test.tsx      # NEW: both shapes, from /checkin and /gate
├── checkin.saleOrCheck.test.tsx    # NEW: the door's action and what it may not do
├── treasurer.gateReport.test.tsx   # NEW: checks received, deposits, notes, recorded-by, empty sections
└── gate.* (anonComment, cashCounting, membershipLevel, reload, noSubstitute, performerCash, eventSelector)
                                    # rewritten or retired with the old page
tests/unit/
└── gate.deriveMoney.test.ts        # NEW (pure): admission by three sources, fee, checks total, deposit
```

**Structure Decision**: the gate page becomes a page plus sections and dialogs beside it, as
`/checkin` (079) and `/payments` (081) did. The shared sale-or-check dialog lives in
`src/app/_components/`, since the door and the gate both open it. The money derivation is a pure
module under `src/server/domain/gate/`, imported by the page for its live figures.

## Design notes carried into tasks

Settled by research, not to be re-decided during implementation:

- **A check is a row plus gate-sale lines** (`payment_method = 'check'`, `check_id` set). Admission
  lines exist only on checks and carry a people count.
- **Two migrations**: the enum value alone in 0052, everything else in 0053.
- **Admission = cash + card + check**; gross cash is bills and coins; `checksCents` is new.
- **Deposits are derived** — the main one, then one per marked check. `door_records.deposit_cents`
  keeps the main figure.
- **The Save narrows** to the money, the anonymous sales and the evening's note. Named sales and
  checks are written one at a time.
- **Authority**: add or correct your own = `attendance.write` or `gate.write`; someone else's, or
  deposit-separately = `gate.write`. `recorded_by_contact_id` is what makes "your own" answerable.
- **Who recorded it** is a column on each thing the report names, plus audit events with the real
  contact.
- **The count in progress** lives in `door_records.cash_count` and is cleared by the money save.
- **Warnings come from the save**, never while typing; the live figures come from the shared pure
  function.
- **Print** is a `@page { size: letter landscape }` module on the treasurer page, hiding all but the
  report.
- **Paying confirms** a proposed / requested / tentative booking; `declined` is left alone.

## Deliberately not in this feature

- Unconfirmed-booking warnings on the three pages (BK-C5 — the booker's work).
- A home for unmatched online membership payments (backlog B52).
- Check numbers or images for checks received; exporting the report to QuickBooks; scans of the
  paper reports.
- Structuring what a note says (choosing the future event, adding household members).
- Any further change to how performers are paid (081), beyond the recorder and the confirmation
  rule.
