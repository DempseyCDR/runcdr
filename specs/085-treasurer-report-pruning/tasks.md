# Tasks: The gate report answers with what it shows

**Feature**: 085-treasurer-report-pruning | **Branch**: `085-treasurer-report-pruning`

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/report.md](./contracts/report.md),
[quickstart.md](./quickstart.md)

**Tests**: included — Test-First is a constitution principle, and in a pruning feature the tests *are*
the feature. Every rule moves to a surviving part and is seen to pass **before** the field it used to be
asserted through is removed.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2, US3 from [spec.md](./spec.md)

---

## Phase 1: Setup — take the baseline before anything moves

**Purpose**: SC-002 says no figure changes. That claim cannot be checked afterwards from memory, so the
evidence is captured first. Nothing else may start until it is.

- [X] T001 Confirm no dev server and no build is running against the development database, then start one dev server for the baseline capture only
- [X] T002 Capture a busy evening — sales, a check received, a performer payment, a void, a deposit, a venue with rent — with `curl -s "http://localhost:3000/api/events/<EVENT_ID>/treasurer-report" > /tmp/report-before.json`, per [quickstart.md](./quickstart.md)
- [X] T003 [P] Capture a bare evening the same way to `/tmp/report-before-bare.json`
- [X] T004 [P] Print or screenshot `/treasurer` for both evenings, so the page can be compared by eye as well as by `diff`

**Checkpoint**: two baselines on disk and two printouts. Stop the dev server before any suite run.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: move every rule off a departing field and onto a surviving one, with the departing fields
**still in place**. The suite must be green at the end of this phase — that green is the proof that
nothing is lost when Phase 3 deletes. This blocks all three stories.

Each task rewrites the assertions named for that file in [research.md](./research.md) R1. Assert the same
numbers; only the path through the report changes.

- [X] T005 [P] Rewrite the nine cases in `tests/integration/treasurer.report.test.ts` against `receipts.lines`, `expenses.rent`, `attendance`, `deposits`, `card` and `receipts.admission` — including the two R1 flags for judgement: "assembles all sections with mapping" loses its mapping half, and keeps the named-customer split as a `receipts.lines` assertion
- [X] T006 [P] Rewrite `tests/integration/treasurer.fees.test.ts` — the door fee is asserted on `card.fee`, beside `receipts.totals` which stay gross
- [X] T007 [P] Rewrite `tests/integration/treasurer.paymentLines.test.ts` — per-line notes, voids and check-number order asserted on `expenses.payments`; cross-event settlement on `paidTonightForEarlier`
- [X] T008 [P] Rewrite the backfill case in `tests/integration/treasurer.paymentsCutover.test.ts` against `expenses.payments` (leave the reconciliation case to T013)
- [X] T009 [P] Rewrite `tests/integration/treasurer.performer-payments.test.ts` — the check number asserted on `expenses.payments[].checkNumber`
- [X] T010 [P] Rewrite `tests/integration/treasurer.same-evening.test.ts` — the surviving rule is that two events on one date report independently, each with its own `receipts`; the "both Contra Gate" half was the QuickBooks customer and goes
- [X] T011 [P] Rewrite the remaining departing-field assertions in `tests/integration/treasurer.gateReport.test.ts` against `receipts.lines`, `expenses` and `deposits`
- [X] T012 Run `pnpm vitest run tests/integration/treasurer` with the old fields still present and confirm every case passes — the rules have moved

**Checkpoint**: every rule is now proved through a part the page shows. Phase 3 may delete.

---

## Phase 3: User Story 1 — The report says the evening once (P1)

**Goal**: the report carries the ten parts the page shows and nothing else, plus the reconciliation on the
page.

**Independent test**: fetch a report; it carries the ten named parts and no other; open `/treasurer` and
every figure reads as it did in the T004 printout.

- [X] T013 [US1] Rewrite the reconciliation case in `tests/integration/treasurer.paymentsCutover.test.ts` to assert `expenses.reconciliation` as `{ booked, paid, outstanding }` — red, because the field is still `performerReconciliation` with `{ expected, actual, delta }`
- [X] T014 [P] [US1] Add a failing component case in `tests/component/treasurer.gateReport.test.tsx`: the expenses column shows one reconciliation line — booked, paid, outstanding — and shows it when outstanding is `$0.00`
- [X] T015 [US1] Add `tests/integration/treasurer.shape.test.ts` asserting the report's own keys are exactly the ten of [contracts/report.md](./contracts/report.md) — the guard that keeps a field from creeping back
- [X] T016 [US1] Move and rename the field in `src/server/domain/treasurer/reportService.ts`: `performerReconciliation` becomes `expenses.reconciliation` with `booked`, `paid`, `outstanding` (FR-008) — T013 and T015 go green
- [X] T017 [US1] Render the line in `src/app/(admin)/treasurer/page.tsx` after the expense totals and the rent, per the contract's wording — T014 goes green
- [X] T018 [US1] Delete the fourteen removed parts from the `TreasurerReport` type in `src/server/domain/treasurer/reportService.ts`, per the removed table in [data-model.md](./data-model.md)
- [X] T019 [US1] Delete their assembly in `assembleTreasurerReport`, and every query, join and helper that fed only them — the named-customer grouping, the gate-sales category sums, the QBO mapping lookup (FR-006)
- [X] T020 [US1] Remove the now-unused helper types in `src/server/domain/treasurer/reportService.ts` (`PaymentReportLine` and any `DepositView` member that only a removed part used), keeping what the surviving parts need
- [X] T021 [US1] Run `pnpm tsc --noEmit` and fix every stale reader it names (FR-004); expect none outside the treasurer service and its tests
- [X] T022 [US1] Run `pnpm vitest run tests/integration/treasurer tests/component/treasurer` — all green

**Checkpoint**: the report has ten parts, the page has one more line, and nothing else moved.

---

## Phase 4: User Story 2 — What the old parts proved is still proved (P2)

**Goal**: no rule a retired field was the only proof of is left unproved, and the no-figure-moved claim is
evidence rather than assertion.

**Independent test**: for each of R1's sixteen cases, name the live assertion that replaces it; run the
suite and see the same rules proved.

- [X] T023 [US2] Walk [research.md](./research.md) R1 case by case against the rewritten files and record, in R1 itself, the test name that now carries each rule — any case without a named live assertion is a gap to close, not a line to tick (SC-003)
- [X] T024 [P] [US2] Confirm or add the guard in `tests/integration/treasurer.paymentLines.test.ts`: a voided payment is listed among `expenses.payments`, marked voided, with its reason, and is **out of** `expenses.totals`
- [X] T025 [P] [US2] Confirm or add the guard in `tests/integration/treasurer.paymentLines.test.ts`: a check settling another evening's booking is still reported, on `paidTonightForEarlier` or `paidElsewhere` as the direction requires
- [X] T026 [P] [US2] Confirm or add the guard in `tests/integration/treasurer.report.test.ts`: `expenses.otherPaidOut` carries the gate's cash payouts and `expenses.rent` carries a rent owed, including the venueless `(no landlord set)` case at amount 0
- [X] T027 [US2] Confirm `tests/integration/treasurer.report.test.ts` still proves the two rules the pruning is most likely to cost silently: admission derived from gross cash and card minus the non-admission lines, and the 404 for an evening with no door record
- [X] T028 [US2] Restart the dev server, re-fetch both evenings to `/tmp/report-after*.json`, and run the quickstart's `diff` — expect no output (SC-002). Stop the dev server afterwards

**Checkpoint**: the coverage map is closed and SC-002 is evidenced on two real evenings.

---

## Phase 5: User Story 3 — The QuickBooks mapping goes (P3)

**Goal**: the mapping's page, route, service, schema, seed, menu entry and stored rows are retired.
Depends on Phase 3: the mapping cannot go while anything asks it for a class.

**Independent test**: the page is gone, the menu does not offer it, and nothing in the code refers to a
QuickBooks class, customer or mapping.

- [X] T029 [US3] Write `src/server/db/migrations/0057_drop_qbo_mapping.sql` dropping `series_qbo_map` and `mapping_audit`, with a comment naming `0032_drop_account_mapping.sql` as its precedent, recording that the report no longer keeps class/customer columns, and noting that a re-seeded database will therefore hold no QuickBooks class
- [X] T030 [US3] Add `tests/integration/qbo.retired.test.ts`: `series_qbo_map` and `mapping_audit` do not exist after migration, and the migration re-runs without error
- [X] T031 [P] [US3] Delete `src/server/db/schema/qboMapping.ts` and its export from `src/server/db/schema/index.ts`
- [X] T032 [P] [US3] Delete `src/server/domain/treasurer/mappingService.ts`
- [X] T033 [P] [US3] Delete `src/app/api/qbo-mapping/` including `series/[seriesId]/route.ts`
- [X] T034 [P] [US3] Delete `src/app/(admin)/qbo-mapping/page.tsx` and the directory
- [X] T035 [P] [US3] Remove the `/qbo-mapping` entry from `src/server/auth/nav.ts`
- [X] T036 [P] [US3] Remove `qboClass` from `src/server/validation/treasurer.ts` and the `"qbo-mapping"` slug from `src/server/validation/content.ts`
- [X] T037 [P] [US3] Remove the `seriesQboMap` import and insert block from `src/server/db/seed.ts`
- [X] T038 [P] [US3] Remove the `"qbo_mapping.updated"` member from the audit-kind union in `src/server/lib/audit.ts`
- [X] T039 [US3] Remove `series_qbo_map` and `mapping_audit` from the `TRUNCATE` list in `tests/integration/helpers/db.ts`, and delete the `INSERT INTO series_qbo_map` seeding below it
- [X] T040 [US3] Delete `tests/integration/treasurer.mapping-audit.test.ts` — its two cases test the mapping service alone and have no surviving rule (the only deletion in this feature, and it is a deleted *subject*, not a deleted proof)
- [X] T041 [US3] Run `pnpm vitest run tests/integration/auth.routeInventory.test.ts` — the generated route index drops the two routes on its own
- [X] T042 [US3] Grep `src/` and `tests/` for `qbo`, `Qbo`, `QBO`, `quickbooks` and `QuickBooks`; the only survivors may be the historical migrations `0006` and `0032` and the new `0057` (SC-005)

**Checkpoint**: one menu destination fewer, and nothing in the app names QuickBooks.

---

## Phase 6: Polish & Close-out

- [X] T043 Run the full gates with the dev server stopped: `pnpm db:migrate`, `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`
- [X] T044 [P] Run `pnpm exec eslint` and `pnpm exec prettier --check` on the changed code files only, and `pnpm exec markdownlint-cli2 --fix` plus `pnpm lint:md` on the changed markdown
- [X] T045 Walk [quickstart.md](./quickstart.md)'s manual pass in the browser: both evenings unchanged, the reconciliation line present and correct after paying an outstanding performer, `/qbo-mapping` not found, the organizer report and gate page untouched, and the print still landscape two-column
- [X] T046 Delete the baseline files `/tmp/report-before*.json` and `/tmp/report-after*.json`
- [X] T047 Tick this task and T048 **before** committing, then make one atomic commit for the feature — never amend and force-push a pushed branch merely to mark a step complete
- [X] T048 Push the branch and open the pull request against `main`

---

## Dependencies

```text
Phase 1 (baseline)  →  Phase 2 (rules move, suite green)  →  Phase 3 (US1: fields go)
                                                               ├→ Phase 4 (US2: coverage + SC-002)
                                                               └→ Phase 5 (US3: mapping retired)
                                                                     → Phase 6 (gates, quickstart, PR)
```

- **Phase 2 blocks Phase 3 absolutely.** A field may not be deleted before the rule it proved passes
  elsewhere. This is Test-First for a removal: the new assertion is green before the old path is cut.
- **Phase 3 blocks Phase 5.** The mapping cannot be dropped while `assembleTreasurerReport` still reads it.
- **Phase 4 and Phase 5 are independent of each other** and may be done in either order.
- Within Phase 3, T013–T015 (red) precede T016–T017 (green), which precede T018–T020 (the deletions).

## Parallel opportunities

- **Phase 2**: T005–T011 are seven separate test files — all `[P]`, the widest parallel band in the feature.
- **Phase 3**: T014 (component) runs beside T013 (integration); the rest is one service file and is serial.
- **Phase 4**: T024–T026 are independent guards.
- **Phase 5**: T031–T038 are eight distinct files, all `[P]`, once T029 exists.

## Implementation strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1).** That alone delivers the feature's point: one description of
the evening, and the reconciliation answered where the Treasurer reads it. US2 is the audit that makes the
removal defensible, and US3 is the loose end the removal exposes — both are worth doing, neither is what
the feature is for.

**The failure mode to guard against** is finishing Phase 3 without Phase 2, which looks identical in a
green suite and is how a rule ships unproved.

## Task count

| Phase | Tasks | Story |
|---|---|---|
| 1 — Setup | T001–T004 (4) | — |
| 2 — Foundational | T005–T012 (8) | — |
| 3 — Report pruning | T013–T022 (10) | US1 |
| 4 — Coverage & SC-002 | T023–T028 (6) | US2 |
| 5 — Mapping retired | T029–T042 (14) | US3 |
| 6 — Polish | T043–T048 (6) | — |
| **Total** | **48** | |
