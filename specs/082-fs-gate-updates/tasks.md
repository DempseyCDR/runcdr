---
description: "Task list for feature 082 — the gate evening, and the report the Treasurer reads"
---

# Tasks: The gate evening, and the report the Treasurer reads

**Input**: Design documents from `/specs/082-fs-gate-updates/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/gate.md](./contracts/gate.md),
[quickstart.md](./quickstart.md)

**Tests are NOT optional here.** Constitution Principle I (Test-First) is NON-NEGOTIABLE: every
behaviour lands as a failing test before its implementation. Run each new test and watch it fail for
the right reason before writing the code.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: may run in parallel (different files, no dependency on an incomplete task)
- **[US1]** etc.: the user story the task serves

## Path Conventions

Single Next.js app. Server code under `src/server/`, routes under `src/app/api/`, the gate page
under `src/app/(door)/gate/`, the check-in page under `src/app/(door)/checkin/`, the report under
`src/app/(admin)/treasurer/`, shared client components under `src/app/_components/`. Integration
tests under `tests/integration/` (real Postgres; `ensureSchema`/`resetDb`/`closeDb` from
`./helpers/db`, factories from `./helpers/factories`, `jsonReq`/`jsonReqAs`/`ctx` from
`./helpers/http`), component tests under `tests/component/` (jsdom; stub `fetch` as
`tests/component/gate.reload.test.tsx` does), pure tests under `tests/unit/`.

Research decisions are cited as R1–R15; the exact error codes, payloads and page wording are in
[contracts/gate.md](./contracts/gate.md) and are to be matched, not re-invented.

**Never run the suite or migrations while a dev server is running** against the database.

---

## Phase 1: Setup (migrations, schema, errors, validation)

**Purpose**: migrations 0052 and 0053 and the types, error codes and schemas every story uses.

- [X] T001 Write `tests/integration/migration.gateChecks.test.ts` (pattern: `tests/integration/migration.dropNonDanceIncome.test.ts`, reading both migration files as text). Tests: after `ensureSchema`, (a) `payment_method` accepts `'check'`; (b) `gate_checks` exists with `writer_contact_id` NOT NULL and cascades from `door_records`; (c) deleting a check deletes its `gate_sales` lines; (d) each `gate_sales` constraint refuses its case — a `check_id` with `payment_method='cash'`, a `payment_method='check'` with no `check_id`, an `admission` line with no `check_id`, a `people_count` on a non-admission line, an `admission` line with `people_count` null or 0; (e) `door_records.cash_count` defaults to `{}` and `evening_note` / `money_recorded_by_contact_id` exist and are nullable; (f) `performer_payments.recorded_by_contact_id` exists; (g) both migration texts run twice on a clean database without error (idempotent)
- [X] T002 Create `src/server/db/migrations/0052_gate_payment_method_check.sql` — `ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'check';` and nothing else (R2: the value cannot be used in the transaction that adds it)
- [X] T003 Create `src/server/db/migrations/0053_gate_checks.sql` exactly as [data-model.md](./data-model.md) §Migration 0053 describes, **idempotent** (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, constraints added only when absent via a `pg_constraint` check, `CREATE INDEX IF NOT EXISTS`): `gate_checks`; `gate_sales.check_id` / `people_count` / `recorded_by_contact_id` with the five check constraints and the `check_id` index; `door_records.evening_note` / `cash_count jsonb NOT NULL DEFAULT '{}'` / `money_recorded_by_contact_id`; `performer_payments.recorded_by_contact_id`. No backfill. Run `pnpm db:migrate`, then T001 — passes
- [X] T004 [P] Update Drizzle schema in `src/server/db/schema/enums.ts` (`paymentMethodEnum` gains `"check"`; export the widened `PaymentMethod` type) and `src/server/db/schema/door.ts` (new `gateChecks` table with `GateCheckRow`; `gateSales` gains `checkId`, `peopleCount`, `recordedByContactId`; `doorRecords` gains `eveningNote`, `cashCount` (jsonb, default `{}`), `moneyRecordedByContactId`); re-export from `src/server/db/schema/index.ts` if that file lists tables
- [X] T005 [P] Add `recordedByContactId` to `performerPayments` in `src/server/db/schema/performerPayments.ts`
- [X] T006 [P] Add the four error factories to `src/server/lib/apiError.ts` (codes added to the code union), with the statuses and messages in [contracts/gate.md](./contracts/gate.md): `checkNeedsLines()` 422 `CHECK_NEEDS_LINES`, `admissionNeedsPeople()` 422 `ADMISSION_NEEDS_PEOPLE`, `admissionNeedsCheck()` 422 `ADMISSION_NEEDS_CHECK`, `notYourEntry()` 403 `NOT_YOUR_ENTRY`
- [X] T007 Write `tests/unit/door.validation.test.ts` (pure Zod, no DB): `gateSaleCreateSchema` requires `contactId` for `donation`/`future_event`/`membership`, requires `membershipLevel` on `membership` and forbids it elsewhere, **accepts** `admission` as a category (the service refuses it with `ADMISSION_NEEDS_CHECK`, so the schema must not swallow it first — see T013), accepts an optional `note`; `gateSalePatchSchema` accepts any of the patchable fields and at least one; `gateCheckCreateSchema` requires `writerContactId` and at least one line, requires `peopleCount > 0` on an `admission` line and forbids `peopleCount` elsewhere, accepts per-line notes and `depositSeparately`; `gateSalesPutSchema` now refuses a named category. Then implement them in `src/server/validation/door.ts` alongside the narrowed `gateSalesPutSchema` and add `eveningNote` / `cashCount` to `doorRecordPatchSchema`; T007 passes
- [X] T008 Run `pnpm tsc --noEmit` and fix the call sites the widened `payment_method` and the narrowed `gateSalesPutSchema` break, without changing behaviour yet (exhaustive switches over the payment method, the gate page's current save body)

**Checkpoint**: `pnpm db:migrate` clean; T001 and T007 pass; `pnpm tsc --noEmit` clean.

---

## Phase 2: Foundational (the money, the deposits, one sale at a time, who recorded it)

**Purpose**: the shared derivations and the write paths every story builds on. **Blocking** — in
particular, narrowing the gate's Save (T014) and the new per-sale routes (T015) must land together,
or saving the money destroys named sales.

- [X] T009 [P] Write `tests/unit/gate.deriveMoney.test.ts` (pure): admission by cash (gross − float − non-admission cash), by card (card gross − non-admission card) and by check (the checks' admission lines) with the total being the three added; the card fee from `posFeeCents`; the checks total; the main deposit = counted cash − float − other payouts − performers' cash + the checks not marked. Then implement `deriveGateMoney(input): GateMoney` in a new pure module `src/server/domain/gate/deriveGateMoney.ts` — no DB imports, type-only schema imports, so the page may import it directly (R10); passes
- [X] T010 Write `tests/integration/gate.checkMoney.test.ts`: inserting a check with an admission line for 2 people, a merchandise line and a donation line (rows inserted directly) leaves `grossCashCents` untouched, puts the admission line into `admissionCheckCents`, makes `admissionCents` the sum of the three sources, sets `checksCents` to every check's lines, and leaves `admissionCashCents` / `admissionCardCents` at their existing values. Then extend `EventGate` and `computeEventGate` in `src/server/domain/gate/eventMoney.ts` with `admissionCheckCents` and `checksCents`, excluding check lines from the non-admission cash/card sums (R3); passes
- [X] T011 Write `tests/integration/gate.deposits.test.ts`: an evening with counted cash, a float, a payout, performers' cash and three checks (one marked) lists the main deposit with its make-up and one deposit for the marked check; with no checks, only the main deposit; a marked check with no cash still lists both. Then implement `eventDeposits(db, eventId): Deposit[]` in `src/server/domain/door/deposits.ts` and make `depositCents` / `refreshDeposit` in `src/server/domain/door/doorRecordService.ts` add the unmarked checks to the stored main deposit (R4); passes
- [X] T012 Write `tests/integration/gate.sales.test.ts` covering the sale contract end to end: `POST /api/door-records/{id}/sales` creates one named sale and returns the sale view with `recordedBy`; a membership sale enrols (as today); `admission` is refused with `ADMISSION_NEEDS_CHECK`; `PATCH` and `DELETE /api/gate-sales/{id}` change and remove just that sale; the narrowed `PUT /api/door-records/{id}/gate-sales` replaces only `merchandise`/`gift_card`/`misc_sales` and **leaves named sales and checks untouched**, and refuses a named category (422); a door attendant (`attendance.write`, no `gate.write`) may create and correct **their own** sale but gets `NOT_YOUR_ENTRY` on someone else's and 403 on the PUT
- [X] T013 Implement `src/server/domain/door/gateSaleService.ts` — `createGateSale`, `patchGateSale`, `deleteGateSale`: authority via `assertEventScopeAny("attendance.write", "gate.write")` for create and for your own row, `gate.write` for someone else's (`NOT_YOUR_ENTRY`, R6); `recorded_by_contact_id` set on create and updated when someone else corrects the row (R7); an `admission` category refused here with `ADMISSION_NEEDS_CHECK` (the service owns that refusal, not the schema — T007); membership lines go through the existing `enrollDoorMemberships` path (R13); a `recordAudit` row naming the signed-in contact
- [X] T014 Narrow `putGateSales` in `src/server/domain/door/doorRecordService.ts` to the anonymous categories: the replace-all delete is scoped to `category IN ('merchandise','gift_card','misc_sales') AND check_id IS NULL`, and a named category is refused (R5, FR-026)
- [X] T015 Add the sale routes — `src/app/api/door-records/[id]/sales/route.ts` (POST) and `src/app/api/gate-sales/[id]/route.ts` (PATCH, DELETE) — following the existing route shape (`parseBody`, `requireActor`, the error envelope); T012 passes
- [X] T016 Write `tests/integration/gate.recordedBy.test.ts`: saving the evening's money records the signed-in contact on the door record; creating a sale, creating a check and recording a performer payment each record theirs; a second person's correction replaces it; the durable `audit_events` rows name the real contact rather than `"door"` / `"admin"`
- [X] T017 Implement the recorded-by plumbing: `money_recorded_by_contact_id` set in `updateDoorRecord`, `recorded_by_contact_id` set in `createPerformerPayment` / `patchPerformerPayment` in `src/server/domain/payments/performerPaymentService.ts`, and the door-record and gate-sale writes switched from the log-only `writeAudit` to `recordAudit(db, { kind, actorContactId, details })`; T016 passes
- [X] T018 Write `tests/integration/door.payload.test.ts`: `GET` and `POST /api/events/{id}/door-record` return `checks` (check views, their lines included) beside `gateSales`, and the door record carries `admission` (cash / card / check / total), `checksTotal`, `cardFee`, `deposits`, `eveningNote`, `cashCount` and `moneyRecordedBy` exactly as [contracts/gate.md](./contracts/gate.md) states; an evening with no checks returns an empty list and the main deposit alone; the figures agree with `computeEventGate` for the same evening
- [X] T019 Extend `getDoorRecord` in `src/server/domain/door/doorRecordService.ts` and `src/app/api/events/[id]/door-record/route.ts` so the payload carries `checks` (check views) beside `gateSales`, plus the figures the PATCH response gains — `admission` (cash / card / check / total), `checksTotal`, `cardFee`, `deposits`, `eveningNote`, `cashCount`, `moneyRecordedBy` — exactly as [contracts/gate.md](./contracts/gate.md) states; T018 passes
- [X] T020 Update the existing tests the new shapes break, keeping their intent: `tests/integration/door.gate-sales.test.ts` (named sales now have their own routes), `door.record-update.test.ts`, `gate.membership.test.ts`, `gate.membershipLevel.test.ts`, `gate.note.test.ts`, `treasurer.report.test.ts`, `organizer.report.test.ts`
- [X] T021 [P] Write `tests/integration/gate.retention.test.ts`: after the 90-day purge runs, an old evening's door record, gate sales and checks are all still there (FR-038, R15) — a pin, expected to pass without production changes
- [X] T022 Run `pnpm vitest run` and `pnpm tsc --noEmit`; both clean before any page work begins

**Checkpoint**: the money derives, the deposits list, a sale is written on its own, and every
write says who did it — the stories can begin.

---

## Phase 3: User Story 1 — Record the evening's money on a phone (Priority: P1) 🎯 MVP

**Goal**: a phone-first gate page — the event confirmed, the summary and the deposit above the fold,
the sections in Mary's working order, the figures following her typing, and the warnings arriving
with the Save.

**Independent Test**: on a 390 × 844 screen, enter an evening's cash, card and other sales; confirm
the section order, that admission / fee / deposit update while typing, that the deposit needs no
scrolling, and that saving reports the warnings without blocking.

### Tests for User Story 1

- [X] T023 [P] [US1] Write `tests/integration/door.warnings.test.ts`: `PATCH /api/door-records/{id}` returns `NEGATIVE_ADMISSION` when the other cash sales exceed the counted cash, `PAYOUT_WITHOUT_REASON` when cash is paid out with no reason, and `CARD_GROSS_WITHOUT_COUNT` when card gross has no transaction count; each save **still succeeds** (FR-007); a clean save returns no warnings; the evening's note (FR-030) is saved, returned and cleared by an empty string
- [X] T024 [P] [US1] Write `tests/component/gate.page.test.tsx` (jsdom, `fetch` stubbed): the event is confirmed at the top as `/checkin` and `/payments` confirm it — series, label, date, 12-hour time, a Change control and the not-today warning (FR-002; this is the named replacement for the retired `gate.eventSelector.test.tsx`, T033); the sections render in order — summary, Door counts, Cash, Card, Other sales, Named sales, Checks; the summary shows admission by cash / card / check, the card fee, the checks total and the deposit; the door's comp and gift-card counts are shown beside Mary's figures and the open-band count is read-only; typing gross cash, the float, a payout, card gross or an anonymous sale changes the summary **before** any save; no warning text appears while typing; after Save the server's warnings are shown; changing the event or leaving with unsaved entries warns first; the evening's note is shown, edited and sent with the Save (FR-030); money inputs carry `inputMode="decimal"` and count inputs `inputMode="numeric"`

### Implementation for User Story 1

- [X] T025 [US1] Implement the warnings in `updateDoorRecord` (`src/server/domain/door/doorRecordService.ts`) and return them from `PATCH /api/door-records/[id]/route.ts` with the rest of the new response fields; T023 passes
- [X] T026 [US1] Create `src/app/(door)/gate/gate.module.css` — mobile-first, one column, large tap targets, no fixed widths that force sideways scrolling; section and summary styles the components below share
- [X] T027 [P] [US1] Create `src/app/(door)/gate/types.ts` (the page's `DoorRecord`, `GateSale`, `GateCheck`, `Deposit`, `Warning`, `RowState` types, mirroring the contract) and `src/app/(door)/gate/save.ts` (a `send()` helper returning a discriminated `Sent<T>`, plus `money`, as `src/app/(admin)/payments/savePayment.ts` does)
- [X] T028 [P] [US1] Create `src/app/(door)/gate/MoneyPreview.tsx` — admission by cash / card / check, the card fee, the checks total and the **deposit**, fed by `deriveGateMoney` from what is typed, sitting beside the 081 performer-pay summary above the fold (FR-003)
- [X] T029 [P] [US1] Create `src/app/(door)/gate/DoorCounts.tsx` — comps and gift cards editable beside "the door recorded N", the open-band count read-only (FR-005)
- [X] T030 [P] [US1] Create `src/app/(door)/gate/CashSection.tsx` (gross cash, seed float, other cash paid out and its reason, the 081 performers'-cash line, and the **Count** button wired in US2) and `src/app/(door)/gate/CardSection.tsx` (card gross, transaction count, the derived fee)
- [X] T031 [P] [US1] Create `src/app/(door)/gate/OtherSales.tsx` — the anonymous categories and the section's note, saved by the page's Save
- [X] T032 [US1] Rebuild `src/app/(door)/gate/page.tsx`: `EventConfirm` at the top, then `MoneyPreview` and the 081 summary, then the sections in order (the Named sales and Checks sections render read-only lists at this point; US3 and US4 add their controls), the evening's note box, Save with the server's warnings shown afterwards, and the unsaved-work guard on changing the event or leaving; T024 passes
- [X] T033 [US1] Rewrite or retire the old gate component tests — `tests/component/gate.anonComment.test.tsx`, `gate.cashCounting.test.tsx`, `gate.eventSelector.test.tsx`, `gate.membershipLevel.test.tsx`, `gate.noSubstitute.test.tsx`, `gate.performerCash.test.tsx`, `gate.reload.test.tsx` — and record in this file's **Deviations** a coverage map saying which new test covers each retired case (as 081's T065 did). Nothing may be retired without a named replacement
- [X] T034 [US1] Verify on a phone-sized preview (390 × 844 and 360 wide): the section order, no sideways scrolling, the deposit visible without scrolling, and the keypads the money and count fields ask for

**Checkpoint**: the evening's money can be recorded on a phone and saved, with the figures live
and the warnings honest.

---

## Phase 4: User Story 2 — Count the cash with a keypad (Priority: P1)

**Goal**: a counting dialog with its own on-screen keypad, a running total, a count that survives a
reload and is dropped by the Save, and no place for checks.

**Independent Test**: open the dialog, key each denomination and the coins, confirm the total, and
use it as gross cash; reopen after a reload and the counts are still there; save the gate and they
are gone.

### Tests for User Story 2

- [X] T035 [P] [US2] Write `tests/integration/gate.cashCount.test.ts`: `PATCH /api/door-records/{id}` with `cashCount` stores it and returns it; a later PATCH that saves the money **without** `cashCount` clears it to `{}` (FR-012, R8); a PATCH that sets it again while saving keeps what it set
- [X] T036 [P] [US2] Write `tests/component/gate.countDialog.test.tsx`: the dialog lists $100, $50, $20, $10, $5, $1 and coins as one amount; the keypad's digit and delete keys change the focused denomination; next/previous move between them; the running total follows (2 × $100, 4 × $20, 6 × $5, coins 4.35 → $314.35); **Use as gross cash** sets gross cash and closes; reopening shows the kept counts; there is no checks field

### Implementation for User Story 2

- [X] T037 [US2] Persist `cashCount` in `updateDoorRecord` (`src/server/domain/door/doorRecordService.ts`) — written when the request sets it, cleared to `{}` when the money is saved without it; T035 passes
- [X] T038 [US2] Create `src/app/(door)/gate/CountDialog.tsx` (+ styles in `gate.module.css`) — the denominations, the on-screen keypad with a delete key and next/previous, the running total and **Use as gross cash**; the keys are buttons so they work with no hardware keyboard (R9)
- [X] T039 [US2] Wire **Count** in `src/app/(door)/gate/CashSection.tsx` to the dialog, saving the count as it is keyed and reading it back from the door record on load; T036 passes
- [X] T040 [US2] Walk quickstart §2 on a phone-sized preview, including the reload and the clearing Save

**Checkpoint**: the drawer can be counted on the phone, and a half-finished count survives.

---

## Phase 5: User Story 3 — Record each check received (Priority: P1)

**Goal**: every check recorded against its writer with a line for each thing it pays for, out of the
cash count, feeding admission and the deposits, and saved on its own.

**Independent Test**: record a check for an existing contact and one for a new person; give one an
admission line for two people, a merchandise line and a donation line; mark a third for its own
deposit; confirm the checks total, the admission figures and the deposits listed.

### Tests for User Story 3

- [X] T041 [P] [US3] Write `tests/integration/gate.checks.test.ts`: `POST /api/door-records/{id}/checks` records a check with its lines and returns the check view (amount = the sum of its lines, `recordedBy` set, each line carrying `checkId`); a membership line enrols or renews at its level; a check with no lines is refused `CHECK_NEEDS_LINES`; an `admission` line with no or zero `peopleCount` is refused `ADMISSION_NEEDS_PEOPLE`; `PATCH /api/gate-checks/{id}` replaces the lines and changes the writer and note; removing the last line removes the check; `DELETE /api/gate-checks/{id}` removes the check and its lines; `depositSeparately` needs `gate.write` — refused 403 for the door, never silently ignored — while the door may still record a check and correct its own. **The race path too** (T045): with the service's pre-check bypassed, each database constraint violation (`23514`) still surfaces its own code rather than a 500
- [X] T042 [P] [US3] Write `tests/component/gate.checks.test.tsx`: the checks section lists each check with its writer, amount, lines (category, amount, people, whose, note), note, **deposit separately** (shown only with `gate.write`) and who recorded it; **Add a check** opens the dialog; Edit and Remove save on their own; the deposits list shows the main deposit and each marked check with what makes it up

### Implementation for User Story 3

- [X] T043 [US3] Implement `src/server/domain/door/gateCheckService.ts` — `createGateCheck`, `patchGateCheck`, `deleteGateCheck`: the lines written as `gate_sales` rows with `payment_method = 'check'` and `check_id` set (R1), the amount always derived, the line rules enforced before the constraints can fire, `depositSeparately` gated on `gate.write`, the authority and `recorded_by` rules of T013, enrolment through `enrollDoorMemberships` (R13), and a `recordAudit` row
- [X] T044 [US3] Add the check routes `src/app/api/door-records/[id]/checks/route.ts` (POST) and `src/app/api/gate-checks/[id]/route.ts` (PATCH, DELETE); T041 passes
- [X] T045 [US3] Map Postgres `23514` check-constraint violations onto the matching error codes in `src/server/domain/door/gateCheckService.ts` (by constraint name, as the `23505` mapping in `src/server/domain/payments/performerPaymentService.ts` does), so a race surfaces the same refusal as the pre-check; the race assertions added to T041 pass
- [X] T046 [P] [US3] Create the shared dialog shell `src/app/_components/SaleOrCheckDialog.tsx` (+ `.module.css`) with its **check** shape: the writer (079's contact search, with Add contact when the person is not a contact yet), the lines with category / amount / people / whose / note, the check's note, the deposit-separately tick for `gate.write`, and the running total (R14). The sale shape follows in US4
- [X] T047 [P] [US3] Create `src/app/(door)/gate/CheckList.tsx` — one block per check with its lines and note, Edit and Remove each saving on their own
- [X] T048 [P] [US3] Create `src/app/(door)/gate/DepositList.tsx` — the main deposit and each marked check, each with what makes it up, read from `deposits` in the payload
- [X] T049 [US3] Wire the checks section and the deposits into `src/app/(door)/gate/page.tsx`, and feed the checks total and admission-by-check into `MoneyPreview` as checks are added and removed; T042 passes
- [X] T050 [P] [US3] Write `tests/component/saleOrCheckDialog.test.tsx` for the check shape: lines added and removed, the running total, a check with no lines refused where the action was taken, an admission line asking how many people, the deposit-separately tick hidden without `gate.write`
- [X] T051 [US3] Confirm the counting dialog still offers no checks, and that recording a check leaves gross cash untouched (FR-013, FR-019) — an assertion in `gate.countDialog.test.tsx` and in `gate.checkMoney.test.ts`
- [X] T052 [US3] Walk quickstart §3 on a phone-sized preview, including the writer who is not yet a contact and the separately deposited check

**Checkpoint**: every check is recorded with what it pays for, and the deposits match what goes to
the bank.

---

## Phase 6: User Story 4 — One dialog for a named sale, at the door or the gate (Priority: P1)

**Goal**: the same dialog on `/checkin` and `/gate`, each sale saved as it is recorded, the door
able to add and correct its own and nothing else, and Mary's Save never wiping what the door
recorded.

**Independent Test**: record a membership and a future-event sale from the door with notes; open the
gate page, confirm both are listed with their notes and who recorded them, correct one, save the
gate money, and confirm neither sale is lost.

**Depends on**: T046 (the dialog shell).

### Tests for User Story 4

- [X] T053 [P] [US4] Write `tests/component/checkin.saleOrCheck.test.tsx`: **Record a sale or check** opens the shared dialog from `/checkin`; a sale is saved as soon as it is recorded; the door sees no cash, card, deposit or Save controls
- [X] T054 [P] [US4] Write `tests/component/gate.namedSales.test.tsx`: the named-sales section lists each sale with its contact, amount, method, note and who recorded it; a sale with no note shows no empty label; **Add a sale** opens the shared dialog; Edit and Remove save on their own; saving the evening's money leaves every named sale and check in place

### Implementation for User Story 4

- [X] T055 [US4] Add the **sale** shape to `src/app/_components/SaleOrCheckDialog.tsx` — the chooser between a sale and a check, then category, the level for a membership, the amount, cash or card, the contact (found or created) and the note (FR-024)
- [X] T056 [P] [US4] Create `src/app/(door)/gate/NamedSaleList.tsx` — the list, with Edit and Remove each saving on their own
- [X] T057 [US4] Wire the named-sales section into `src/app/(door)/gate/page.tsx`; T054 passes
- [X] T058 [US4] Add the **Record a sale or check** action to `src/app/(door)/checkin/page.tsx`, opening the shared dialog and re-using 079's contact search and Add contact dialog; T053 passes
- [X] T059 [US4] Confirm `/api/me/capabilities` gives the page what it needs to show or hide the gate-only controls (the deposit-separately tick, the money sections, Save), adding a flag and its assertion in `tests/integration/me.capabilities.test.ts` if one is missing
- [X] T060 [P] [US4] Extend `tests/integration/gate.sales.test.ts` with the concurrency case that started this: a sale created by the door **while** the gate page holds stale state survives Mary's subsequent money Save (FR-026, SC-005)
- [X] T061 [US4] Walk quickstart §4 with a door-attendant sign-in and then as Mary

**Checkpoint**: a sale can be recorded wherever it happens, and nothing recorded is lost.

---

## Phase 7: User Story 5 — Paying a performer confirms they played (Priority: P2)

**Goal**: a payment settles the booking's status as well as its money.

**Independent Test**: pay a proposed, a requested and a tentative booking, and a declined one
holding a live check; the first three read confirmed and the declined one is untouched.

### Tests for User Story 5

- [X] T062 [P] [US5] Write `tests/integration/payments.confirmOnPay.test.ts`: paying a `proposed`, `requested` or `tentative` booking sets it `confirmed`; an already-confirmed booking is unchanged; a `declined` booking settled by a live check stays `declined`; voiding or deleting the payment leaves the booking `confirmed` (FR-039, FR-040); the rule holds on every path — a row, the several-performers dialog, an earlier booking and an added line

### Implementation for User Story 5

- [X] T063 [US5] In `src/server/domain/payments/performerPaymentService.ts`, after a payment's lines are written, set each settled booking whose status is `proposed`, `requested` or `tentative` to `confirmed` in the same transaction — a direct update, not a lifecycle transition (R12) — and record it in the payment's audit details; T062 passes
- [X] T064 [US5] Grep `tests/` for assertions that assumed a paid booking keeps its old status (start with `tests/integration/bookings.*.test.ts`, `booking.substituteDiscriminator.test.ts` and the bookings-report tests) and update the ones this rule changes

**Checkpoint**: no performer who was paid is still listed as unconfirmed.

---

## Phase 8: User Story 6 — The gate report the Treasurer reads (Priority: P2)

**Goal**: the treasurer page becomes the evening's gate report — each check as a receipt to its
writer, the deposits, the notes and who recorded what — laid out for a laptop and printable on
landscape letter.

**Independent Test**: for an evening with two checks (one deposited separately), cash, other sales,
named sales and performer payments, open the report on a laptop, confirm each section, print it to
landscape letter, and confirm the two names.

### Tests for User Story 6

- [X] T065 [P] [US6] Write `tests/integration/treasurer.gateReport.test.ts`: `GET /api/events/{id}/treasurer-report` returns `checksReceived` (writer, amount, note, deposit-separately, class, and each line with its category, amount, people, whose and note), `deposits`, `eveningNote` and `recordedBy` for the gate money and the performer payments; the gate-sales summary's admission line includes admission paid by check and gains a `check` column; an evening with no checks returns an empty list rather than failing; an evening recorded before this feature returns nulls for the names rather than inventing one
- [X] T066 [P] [US6] Write `tests/component/treasurer.gateReport.test.tsx`: the checks-received blocks, the deposits with their make-up, the evening's note, each check's and sale's notes, and the two "recorded by" names; "No checks received" and "None" where a section is empty, never an empty table

### Implementation for User Story 6

- [X] T067 [US6] Extend `assembleTreasurerReport` in `src/server/domain/treasurer/reportService.ts` with `checksReceived`, `deposits` (from `eventDeposits`), `eveningNote` and `recordedBy`, and add the `check` column to the gate-sales summary's admission line; T065 passes
- [X] T068 [US6] Re-lay out `src/app/(admin)/treasurer/page.tsx` for a laptop with the new sections in the report's reading order, each empty section saying so plainly (FR-036)
- [X] T069 [US6] Create `src/app/(admin)/treasurer/treasurer.module.css` with the print rules — `@media print { @page { size: letter landscape; margin: 0.4in } … }`, hiding everything but the report region and giving each report section `break-inside: avoid` so a section is not split across sheets (SC-007) — following `PrintableCalendar.module.css`; point the existing Print button at the report region; T066 passes
- [X] T070 [US6] Update `tests/component/treasurer.page.test.tsx` for the new layout, keeping what it already proves
- [X] T071 [US6] Print the report (or use the browser's print preview) for an evening with two checks and confirm landscape letter, the report only — no site or volunteer navigation — no cut-off columns, and no section split across two sheets (SC-007)
- [X] T072 [P] [US6] Confirm the organizer report still reads `computeEventGate` correctly with admission's third source — `tests/integration/organizer.report.test.ts` asserts the takings and average ticket over an evening that includes admission paid by check
- [X] T073 [US6] Walk quickstart §5 on a laptop

**Checkpoint**: the Treasurer can enter the evening in the books from one page, and print it for
the binder.

---

## Phase 9: User Story 7 — The report on a phone (Priority: P3)

**Goal**: the report readable on a phone held sideways. **Droppable** — nothing else depends on it.

**Independent Test**: open the report at 844 × 390 and confirm it is readable without sideways
scrolling.

- [X] T074 [US7] Add one media query at the end of `src/app/(admin)/treasurer/treasurer.module.css` for 844 × 390 and narrower — smaller type, the report's tables stacked or scrolled within their own region, no sideways page scrolling (FR-037)
- [X] T075 [US7] Verify at 844 × 390 in the browser preview, and confirm the laptop and print layouts are unchanged

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T076 Re-read [contracts/gate.md](./contracts/gate.md) against the built routes and pages, and fix any drift in a code, a payload field or a page's wording
- [X] T077 [P] Confirm the new routes appear in the generated route index (`src/server/lib/routeInventory.ts`) and that `tests/integration/auth.routeInventory.test.ts` passes — every new route default-denies without its capability
- [X] T078 [P] Check the audit trail end to end: gate money, a sale, a check and a payment each write a durable `audit_events` row naming the signed-in contact, with no `"door"` or `"admin"` placeholder left behind (FR-034)
- [X] T079 Run the full gate suite with **no dev server running**: `pnpm db:migrate`, `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`, `pnpm lint:md`, plus `pnpm exec eslint` and `pnpm exec prettier --check` on the changed files only
- [X] T080 Walk the whole of [quickstart.md](./quickstart.md) — §1–§4 on a phone, §5 on a laptop, §6 on the payments page — and record what fails here before fixing it
- [X] T081 Record any deviation from the design documents in the **Deviations** section below, and correct the document it deviates from
- [X] T082 Run the quickstart's cleanup SQL against the development database
- [X] T083 Commit the feature as one commit on `082-fs-gate-updates` and open the PR (constitution: branch and PR mandatory, the author merges, the full gate suite is the reviewer)

---

## Phase 11: The P1 review — one sale path, one dialog, the paper report

**Purpose**: Rich's review of the P1 build and the printed report (spec clarifications 2026-09-18,
research R16–R19, contract revised). Every sale becomes its own line and the gate's Save stops
carrying sales; the shared dialog becomes **Add a sale** (cash, check or card; Payer; admission only
with a check); a quantity is optional on any line; the report is laid out as the paper one.

### Data and the sale path (R16, R17)

- [X] T084 Extend `tests/integration/migration.gateChecks.test.ts` for migration **0055**: `gate_sales.quantity` exists and `people_count` does not; a quantity on a merchandise line is accepted; an admission line with no quantity is accepted; a quantity of 0 is refused (`gate_sales_quantity_positive`); admission outside a check is still refused; 0055 re-runs without error
- [X] T085 Create `src/server/db/migrations/0055_gate_sale_quantity.sql` (idempotent: rename only if `people_count` exists; drop `gate_sales_people_on_admission` and `gate_sales_admission_needs_people`; add `gate_sales_quantity_positive` only if absent); rename `peopleCount` to `quantity` in `src/server/db/schema/door.ts` and in every reader (sale view, check view, payload, deposits, report, pages, tests). Run `pnpm db:migrate`; T084 passes
- [X] T086 Update `tests/unit/door.validation.test.ts` first — `quantity` optional and above zero on a sale and on a check's line; an admission line needs no count; the sale schema takes an anonymous category with no contact and a quantity; `gateSalesPutSchema` is gone — then `src/server/validation/door.ts`
- [X] T087 Retire `ADMISSION_NEEDS_PEOPLE`: remove the factory and code from `src/server/lib/apiError.ts`, the `peopleCount` mapping in `src/server/lib/parseBody.ts`, and the checks in `gateSaleService` / `gateCheckService` / `explainCheckViolation`; update `gate.checks` (component and integration) and `saleOrCheckDialog` tests that asserted it
- [X] T088 Update `tests/integration/gate.sales.test.ts` first: an anonymous sale is recorded on its own with a quantity and no contact, by the door or the gate; the door corrects its own anonymous line and is refused someone else's; the gate's Save (`PATCH /api/door-records/{id}`) leaves every sale alone; the retired `PUT …/gate-sales` route no longer exists
- [X] T089 Retire the replace-all path: delete `putGateSales` and `ANONYMOUS_CATEGORIES` from `src/server/domain/door/doorRecordService.ts`, the route `src/app/api/door-records/[id]/gate-sales/route.ts` and `gateSalesPutSchema`; make `makeDoorRecord` in `tests/integration/helpers/factories.ts` insert every sale directly; update the tests that called the PUT or `putGateSales` (`door.gate-sales`, `gate.note`, `doorRecord.reload`, `gate.retention`, and any the type check finds); T088 passes

### The report (R19)

- [X] T090 Extend `tests/integration/treasurer.gateReport.test.ts` first: `header` (date, start time, the label or else the series name, the venue, the band — or the musicians' last names, lead first — the caller, the sound tech); `receipts.lines` (every sale line with quantity, name and `for`, in its cash, check or card column, with its note), `receipts.admission`, `receipts.totals`; `expenses.payments` (role, payee, check number or cash, amount, voided with its reason as a note and out of the totals, a check's further bookings and booked-versus-paid as notes), `expenses.otherPaidOut`, `expenses.totals`, `expenses.rent` (unpaid, out of the totals); `card`; `paidTonightForEarlier`
- [X] T091 Implement those fields in `src/server/domain/treasurer/reportService.ts`, keeping the existing fields; T090 passes

### The dialog and the pages (R18, R19)

- [X] T092 Rewrite `tests/component/saleOrCheckDialog.test.tsx` first for **Add a sale**: Paid by cash, check or card; **Payer** (required for a check and for a membership, donation or future event; optional for merchandise, gift cards and other items); cash and card record one line through `POST …/sales`, a check several through `POST …/checks`; admission offered only when **Check** is chosen, with an optional "How many?"; a quantity on the other lines; **For** on a named line; editing keeps the way it was paid; deposit separately only for whoever may record gate money
- [X] T093 Rebuild `src/app/_components/SaleOrCheckDialog.tsx` to the new shape (one form; the chooser goes); T092 passes
- [X] T094 Update `tests/component/gate.page.test.tsx`, `gate.namedSales.test.tsx` (→ the Sales section: every sale that is not a check's line, anonymous included, with quantity, name, note and who recorded it; one **Add a sale**) and `gate.checks.test.tsx` (no "Add a check"; Edit opens the same dialog) first; the Save sends no sales
- [X] T095 Rework `src/app/(door)/gate/`: the Other sales grid goes (`OtherSales.tsx` deleted); `NamedSaleList.tsx` becomes the Sales list; one **Add a sale** button; the preview reads the sales from the loaded record; "Payer" wherever "Writer" was; T094 passes
- [X] T096 Update `tests/component/checkin.saleOrCheck.test.tsx` first — the button is **Add a sale**; **Your sales and checks tonight** includes the viewer's anonymous sales — then `src/app/(door)/checkin/page.tsx`
- [X] T097 Rewrite `tests/component/treasurer.gateReport.test.tsx` first for the layout: the header's two lines; **Receipts** (qty, name, cash, check, card; a note directly beneath its line; admission; total) and **Expenses** (role, name, check # or "cash", amount; voided with its reason; notes beneath; other cash paid out; totals; rent unpaid) side by side; then **Deposits** with the card fee, and **Notes** with bookings paid at another evening; no QuickBooks class or customer; "None" for an empty part
- [X] T098 Rebuild `src/app/(admin)/treasurer/page.tsx` and `treasurer.module.css` to that layout — two columns for a laptop and for print (landscape letter, report only, no split sections), stacked below 52.75rem; update `treasurer.page.test.tsx`; T097 passes

### Close

- [X] T099 [P] Add backlog **B54** (rent paid on the night) to `specs/BACKLOG.md`
- [X] T100 Update [quickstart.md](./quickstart.md) for the new dialog, the Sales section and the report layout
- [X] T101 Walk the changed parts in the browser: the dialog at 390 × 844 from `/gate` and `/checkin`, the Sales section, and the report on a laptop and at 844 × 390
- [X] T102 Run the full gate suite with no dev server running

**Checkpoint**: Rich prints the report (T071) and walks the changes; then cleanup (T082) and the PR
(T083).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — the migrations and schema come first.
- **Foundational (Phase 2)**: depends on Setup. **Blocks every story.** T014 and T015 must land
  together: narrowing the Save without the per-sale routes leaves no way to record a named sale.
- **US1 (Phase 3)** and **US2 (Phase 4)**: depend on Foundational. US2's dialog hangs off US1's Cash
  section, so US1 first.
- **US3 (Phase 5)**: depends on Foundational and on US1's page shell (T032).
- **US4 (Phase 6)**: depends on US3's dialog shell (T046) and on US1's page shell.
- **US5 (Phase 7)**: depends only on Setup (T005) and Foundational (T017) — it touches the payments
  service alone and may be done at any point after them.
- **US6 (Phase 8)**: depends on Foundational (the deposits and the recorders) and reads what US3 and
  US4 write, so it is verified after them.
- **US7 (Phase 9)**: depends on US6. Droppable.
- **Polish (Phase 10)**: last.

### Within Each Story

- Tests first, failing for the right reason, before the implementation they describe.
- Services before routes; routes before the pages that call them.
- Pure modules before anything that imports them.

### Parallel Opportunities

- Setup: T004, T005 and T006 are three different files.
- Foundational: T009 (pure) and T021 (a pin) are independent of the rest.
- Each story's tests are marked [P] against each other — different test files.
- Within US1 the section components (T027–T031) are separate files and may be written together.
- US5 is independent of the gate work entirely; it can be done while the page work is in flight.

## Parallel Example: User Story 1

```bash
# The two tests first, together:
Task: "tests/integration/door.warnings.test.ts"
Task: "tests/component/gate.page.test.tsx"

# Then the section components, together:
Task: "src/app/(door)/gate/MoneyPreview.tsx"
Task: "src/app/(door)/gate/DoorCounts.tsx"
Task: "src/app/(door)/gate/CashSection.tsx + CardSection.tsx"
Task: "src/app/(door)/gate/OtherSales.tsx"
```

---

## Implementation Strategy

### MVP (the P1 stories)

The feature's MVP is US1–US4 together: the evening's money on a phone, the counting dialog, the
checks, and the shared dialog. US1 alone is a usable increment (the money records and saves), but
the Treasurer's answer — the reason for the feature — is only met at US3.

1. Phase 1 → Phase 2, then **stop**: migrations clean, suite green, types clean.
2. US1 → validate on a phone-sized preview (quickstart §1).
3. US2 → quickstart §2. US3 → quickstart §3. US4 → quickstart §4.
4. **Stop and validate the P1 checkpoint** with Rich before the P2 work.
5. US5, then US6 → quickstart §5 and §6. US7 if there is room.
6. Polish, the full gate suite, one commit, one PR.

### Notes

- [P] tasks touch different files and depend on nothing incomplete.
- Nothing is retired without a named replacement (T033).
- Commit after each task or logical group; the PR carries one squashed commit.

---

## Deviations

Recorded during `/speckit-implement`.

- **T013 — shared authority.** `assertMayRecord` / `assertMayCorrect` live in `gateSaleService` and
  the check service imports them, so the door's rule is written once. Layer 1 of every sale and
  check route asks for `attendance.write`: everyone holding `gate.write` also holds it (FS,
  Treasurer, super-user).
- **T014 — the Save's return.** `putGateSales` no longer returns `enrolled`: only named sales enrol,
  and it no longer writes any. It also records who saved the anonymous lines.
- **T016 — checks.** The recorded-by case for a check is asserted in T041, once checks have a route.
  Every performer-payment write (create, change, add a line, void) now records the signed-in contact
  and writes a durable `audit_events` row in its own transaction; `writeAudit` is gone from that
  service.
- **T019 — the payload has its own module.** `doorRecordPayload.ts` composes the door record, the
  sales, the checks and the deposits, so imports run one way. `getDoorRecord` stays as the raw
  getter four existing tests read; its older, different sale type is renamed `GateSaleRowWithName`.
  The payload's money comes from `deriveGateMoney`, as the page's will.
- **T019 — the old gate page until T032.** The payload's sales are now in dollars (`amount`), and
  the Save refuses named categories, so the pre-082 gate page misreads reloaded named sales and
  cannot save them. It is replaced at T032; nothing between here and there runs it.
- **T020 — five new references to `contacts`.** Two parity guards failed, as designed, and needed
  real decisions rather than test edits. By 072's rule (move what a person owns, leave what they
  did): `gate_checks.writer_contact_id` MOVES on a merge, like a named sale; the four `recorded_by`
  columns are LEFT. For deleting a contact: the four `recorded_by` columns are `staff_history`
  (never deleted, 077), and a new `check_writer` category blocks even the unrestricted delete — the
  column is NOT NULL and the books credit the check to its writer for as long as the record is kept
  (FR-038).
- **T020 — tests ported, not deleted.** `gate.membership`, `gate.membershipLevel`,
  `doorRecord.reload` and `door.free-event` now record named sales through `gateSaleService` / the
  sale route. Case (e) of `gate.membership` is now "a failed membership sale leaves neither the sale
  nor an account": atomicity is per sale, which is the point. The `gateSalesSchema` alias served
  only one test and now named the wrong contract, so it is removed. `contacts.delete.test.ts`'s
  category list gains `check_writer`.
- **T033 — the old page's seven component tests, retired.** Every case that still describes the page
  was ported into `gate.page.test.tsx` first ("carried over from the old page's tests"). What covers
  each:
  - `gate.reload` (D2) — "reopens with everything already saved, and a Save round-trips it"; the
    breakdown shown and fetched again after a save — "shows who came and what the performers are
    owed".
  - `gate.anonComment` (031) — the comment sent with the anonymous lines ("saves the anonymous
    sales…") and reloaded from them ("reopens with everything already saved…").
  - `gate.cashCounting` (031) — typing gross cash directly: "follows the typing". The helper itself
    becomes US2's counting dialog (`gate.countDialog.test.tsx`); counting checks into the cash is
    removed on purpose (FR-013).
  - `gate.performerCash` (081) — "lists the cash paid to performers…", "counts the performers' cash
    out of the deposit as Mary types", and the summary fetched again after a save.
  - `gate.eventSelector` (028) — the default event opened ("confirms the event…") and a picked one
    opened ("changes the event without asking…").
  - `gate.noSubstitute` (043) — "has no substitute-a-performer control".
  - `gate.membershipLevel` (080) — the refusal messages ("says nothing was saved…", "the sales were
    saved, but the money was not…", "cannot be reached", "who may record gate money"). Choosing a
    membership's level no longer happens on a Save line: it moves to the shared sale dialog in US4
    (`saleOrCheckDialog.test.tsx`), and the server rule stays pinned by
    `gate.membershipLevel.test.ts` and `tests/unit/door.validation.test.ts`. **Between US1 and US4
    the gate page cannot add a named sale** — the page lists them read-only until the dialog lands.
- **T025 — cash paid out with no reason.** Making it a warning (FR-007) needed more than removing
  the service's refusal: migration 0004's `payout_reason_required` constraint refused it in the
  database. Migration **0054** drops it (its own file — 0053 was already applied).
  `CASH_PAYOUT_REASON_REQUIRED` is gone, and `door.record-update.test.ts` no longer asserts the
  refusal.
- **T025 — saving the money kept the checks out of the deposit.** `updateDoorRecord` recomputed the
  stored deposit from the cash alone, so a Save dropped every unmarked check from it. It now calls
  `refreshDeposit` in the same transaction (test: `gate.deposits.test.ts`, "keeps the checks in the
  stored deposit when the money is saved again").
- **T025 — the card fee, and feature 002.** 002's FR-007/SC-003 say the door volunteer never sees
  the POS fee; MARY-R15 Q10 says Mary sees it as she types. Both hold: the payload carries `cardFee`
  only for a caller who may record gate money in the event's scope, and the page shows it only then.
  The door opens the door record too (to post a sale), so the rule is kept in the payload rather
  than trusted to a page not rendering it. `door.record-update.test.ts`'s "omits the POS fee" became
  "returns the card fee" for the gate.
- **T032 — `gateWrite` / `attendanceWrite`.** Added to `/api/me/capabilities` now (planned for
  T059): the gate page needs it from US1 to hide Save from someone without gate authority.
- **T029 — "what the door recorded".** The door and the gate keep one count each (the door adds to
  `comp_count` at check-in; the gate's Save sets it). Rather than add a second column the data model
  never planned, the hint reads "the door recorded N" until the money is first saved and "last saved
  N" after, so it never claims a number is the door's when it is not. **To ask Rich** whether the
  door's own count is wanted separately.
- **T031/T047/T056 — the lists.** `NamedSaleList` and `CheckList` are created read-only in US1 so
  the sections render in order; US3 and US4 add their controls.
- **T036/T038 — the count's writes.** A count-only PATCH takes its own light path: it sets
  `cash_count` and nothing else, and names no one and audits nothing (scratch work, R8), or every
  keypress would. The dialog keeps the count whenever Mary moves off a denomination, closes it or
  uses it, rather than on every keypress.
- **T038 — `Dialog` moved to `src/app/_components/`.** With the counting dialog and the shared
  sale-or-check dialog it had three users, so it left `/payments` (as 081 moved `EventConfirm`); the
  nine payments dialogs import it from there and its rules left `payments.module.css`.
- **T041/T044 — `CHECK_NEEDS_LINES` and `ADMISSION_NEEDS_PEOPLE`.** The schema refuses a check with
  no lines and an admission line with no people count; `parseBody` maps those two field errors to
  their codes, as 081 does for a malformed check number, so the contract's codes reach the caller.
- **T041 — the mark.** The door is refused the deposit-separately mark when a request would SET it
  on a new check or CHANGE it on an existing one; sending the value a check already has is not a
  refusal.
- **T045 — the race path** is tested by provoking each constraint in the database and passing the
  real error through `explainCheckViolation` — the only way to exercise it without timing two
  requests.
- **T046 — `ContactPicker`.** 079's Add contact dialog creates a contact *and* checks them in, so it
  cannot serve here. The shared dialog uses a small picker that offers existing contacts first and
  then "Add … as a new contact" with first and last names (`POST /api/contacts`); an email can be
  added on the contact record later.
- **T049 — a reload keeps unsaved money.** Recording, correcting or removing a check reloads the
  checks and the named sales but leaves the form alone, so figures typed and not yet saved survive.
- **T055 — the sale shape takes the named sales only.** Membership, donation and future event. An
  anonymous sale recorded through the dialog would be an anonymous line with no contact, which the
  gate's Save replaces as a set — so the door's T-shirt would be wiped by Mary's next Save.
  Anonymous totals stay the Save's (research R5).
- **T058 — the door's own entries.** "Your sales and checks tonight" on `/checkin` lists what the
  signed-in volunteer recorded, each with Edit, so the door can correct its own (FR-027); nobody
  else's is shown. The page learns who is signed in from a new `contactId` on
  `/api/me/capabilities`. The evening's record is opened (created if needed) the first time the door
  records something, as `/gate` opens it; the door's page shows none of its money.
- **T059 — done at T032.** `gateWrite` / `attendanceWrite` were added for US1; `contactId` was added
  here.
- **P1 walk-through (quickstart §1–§4, 2026-09-18, signed in as a club-wide FS, 390 × 844 and 360
  wide).** §1–§3 pass in full, and §4 steps 1–2 (the door's dialog, as the FS on `/checkin`). No
  sideways scroll at either width; the deposit sits at 440px of 844. Four defects found and fixed,
  each test-first: negative money read `$-15.00` (now `−$15.00`); a saved payout reason could not be
  cleared (the schema now takes `null`, and an emptied box sends it); a check's membership line did
  not show its level; and `/checkin`'s own-entries list showed the gate's anonymous totals (it now
  lists named sales and checks only). **§4 steps 3–4 still need a Door Attendant–only sign-in** —
  T061 stays open until then.
- **US5 — written while the dev server was in use.** `payments.confirmOnPay.test.ts` (T062) and the
  confirmation in `performerPaymentService` (T063) are written; the integration test runs with the
  next suite, when the database is free. T064 found no existing assertion to change: every test
  expecting a still-unconfirmed status is on a booking never paid, and the paid ones in
  `bandRepoint` and `booking.substituteDiscriminator` are declined afterwards by the repoint or
  substitution.
- **T067 — two errors in the report, fixed.** A check's lines fell into the **card** column by
  elimination (anything not cash was card), so a T-shirt paid by check would have been reported as a
  card sale; the summary now has a `check` column. And a donation or membership paid by check
  appeared both among the named-customer receipts and under its check; named receipts now hold cash
  and card sales only, since the books credit a check to its writer. Named receipts gain `notes`.
- **T068 — the page is titled "Gate report"** and the report sits in one `<article>` the print
  styles show alone; the Print button and the event selector are outside it.
  `treasurer.page.test.tsx` shares a fixture with the new test, and its QBO-order check now reads
  "Deposits" (plural — one per slip).
- **T076 — contract updated** for what was built beyond it: the door-record payload's fee rule and
  its `gateSales` holding no check lines; `contactId`, `gateWrite` and `attendanceWrite` on
  `/api/me/capabilities`; the count-only PATCH; `cashPaidOutReason: null`; the deposit-separately
  rule's exact wording; the report's `check` column and `notes`; `/checkin`'s own-entries list and
  the sale shape's named categories.
- **US5/US6 database run (2026-09-18).** `payments.confirmOnPay` and `organizer.report` passed as
  written. `treasurer.gateReport` had one wrong expectation — cash admission left out Jo's $15 cash
  payment for a future event ($445, not $460); the code was right.
- **T073 — the report on a laptop, and a fifth defect.** The report for Gatecheck Test agrees with
  what was recorded (cash admission $229.35, admission by check $42, main deposit $401.35, recorded
  by the FS and by Rich); an evening with no checks says "No checks received", "None" and "not
  recorded", with no empty tables. A check's membership line did not show its level on the report,
  as it had not on the gate page; report lines gain `level`.
- **T071 — print.** The browser pane cannot open a print preview. Checked instead that the print
  rules reach the browser — landscape letter, everything but the report hidden, `break-inside:
  avoid` on sections — and that the Print button sits outside the printed region. The printed pages
  themselves are left to Rich's pass.
- **T075** — at 844 × 390 the report does not scroll sideways and its type drops to 14px.
- **T078 — the audit trail.** Gate money, a sale, a check and a payment each write a durable
  `audit_events` row naming the volunteer (`gate.recordedBy`, `gate.checks`). Four log-only
  `writeAudit` calls remain on purpose: opening a door record, the door's comp and gift-card taps,
  and a membership enrolment — none records money, a sale, a check or a payment (FR-034's scope),
  and the sale behind an enrolment has its own durable row.
- **T079 — the gate suite.** Migrations clean; 1760 tests in 348 files; type check, eslint, prettier
  (on the changed TypeScript and CSS — SQL is not prettier's), the production build and markdownlint
  all clean. `checksBankedWithCashCents` was removed as dead code.
- **T008 — three test files deferred to T020.** `pnpm tsc --noEmit` is clean for `src/`, but
  `tests/integration/gate.membership.test.ts`, `gate.membershipLevel.test.ts` and
  `doorRecord.reload.test.ts` call `putGateSales` directly with named sales — the path that moves to
  the new per-sale routes, which do not exist until T015. They are updated at T020, as planned, and
  the type check is not clean in between.
- **T011 — no import cycle.** `deposits.ts` reads `doorRecordService` for the performers' cash, so
  `refreshDeposit` queries the checks banked with the cash directly rather than importing back. The
  stored `door_records.deposit_cents` IS the main deposit (data-model.md) — the checks not marked
  are added there, not again when the list is built.
- **T008 — `makeDoorRecord`.** The factory now inserts named sales directly rather than through
  `putGateSales`, so a test that only needs a sale to exist does not have to drive a route. Tests of
  the sale routes themselves still call them.
- **T089 — `door.gate-sales.test.ts` retired.** It exercised only the replace-all `PUT …/gate-sales`
  route, now gone; `gate.sales.test.ts` covers its replacement (a sale on its own, anonymous
  included) and asserts the route file no longer exists.
- **T091 — receipt lines carry `notes` and `level`.** A line's own note and, after a check's last
  line, the note on the check, are both notes beneath it — so `notes` is a list, not one `note`. The
  level goes with a membership line, as on the checks received. `gate_sales` has no `created_at`,
  so a sale's receipts are ordered by category, then name. contracts/gate.md is corrected.
- **T091 — the older report fields are kept.** `gateSalesSummary`, `namedCustomerReceipts`,
  `checksReceived`, `bills`, `checks`, `cashPayments` and the rest are no longer read by the page,
  only by the integration tests of features 023–082. Pruning them touches seven test files and is
  left as a follow-up rather than widened into this feature.
- **T096 — `/checkin` reads the gate's category labels.** `CATEGORY_LABEL` is imported from
  `src/app/(door)/gate/types.ts` to name an anonymous sale in the door's own list.
- **T098 — the heading is a labelled group.** A `<header>` inside an `<article>` has no banner role,
  so the heading is `role="group"` named "The evening". `to12Hour` is exported from `EventConfirm`
  for its second use.
- **Quickstart §3.3 — a membership is the payer's.** The walk found a check's membership line "for"
  Dee opened an account for Dee. The payer always owns the membership and is a member of it; a
  membership line now names further members (`memberContactIds`, any number — Will pays, Rachel and
  Finn are members), each attached to the payer's account through `attachMember`. A check's
  membership line is written against its writer whatever `contactId` it carries. Individual and
  student levels refuse members (`LEVEL_ADMITS_NO_MEMBERS`), and the whole sale or check with them.
  "For someone else" remains for donations and future events. The members are not stored on the sale
  line: the account is their record.
- **The report reads who a membership covers.** Mike needs the members, but the purchase does not
  store them: the report joins the payer's account and lists its other members, so the line reads
  "Membership (family) — Will Payer, with Rachel Payer and Finn Payer". It is therefore who the
  account covers NOW, not who it covered that night — the account is the record.
- **The float is the "cash box seed" in the UI.** What the till starts with reads as **Cash box seed**
  on `/gate`, in each deposit's make-up ("less cash box seed $15.00") and on the door-parameters page.
  The stored column and the API field stay `seed_float` / `seedFloat`: this is wording, not data.
