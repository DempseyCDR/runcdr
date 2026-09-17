---
description: "Task list for feature 081 — performer payments, rebuilt for Mary"
---

# Tasks: Performer payments, rebuilt for Mary

**Input**: Design documents from `/specs/081-payments-page-update/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/payments.md](./contracts/payments.md),
[quickstart.md](./quickstart.md)

**Tests are NOT optional here.** Constitution Principle I (Test-First) is NON-NEGOTIABLE: every behaviour
lands as a failing test before its implementation. Run each new test and see it fail for the right reason
before writing the code.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: may run in parallel (different files, no dependency on an incomplete task)
- **[US1]** etc.: the user story the task serves

## Path Conventions

Single Next.js app. Server code under `src/server/`, routes under `src/app/api/`, the payments page under
`src/app/(admin)/payments/`, shared client components under `src/app/_components/`, integration tests
under `tests/integration/` (real Postgres; `ensureSchema`/`resetDb`/`closeDb` from `./helpers/db`,
factories from `./helpers/factories`, `jsonReq`/`jsonReqAs`/`ctx` from `./helpers/http`), component tests
under `tests/component/` (jsdom; stub `fetch` as `tests/component/gate.reload.test.tsx` does). Research
decisions are cited as R1–R18 and R3a; contract details (error codes, payloads, page wording) are in
[contracts/payments.md](./contracts/payments.md) and are to be matched exactly.

**Never run the suite or migrations while a dev server is running** against the database.

---

## Phase 1: Setup (schema and shared contracts)

**Purpose**: migration 0051 and the types, errors and validation every story uses.

- [X] T001 Before migrating, run the two duplicate queries and the malformed-number query from [quickstart.md](./quickstart.md) against the development database (read-only). Report any rows to Rich and stop until he has deleted the extras or reset the database — do not delete data yourself
- [X] T002 Write `tests/integration/payments.migration.test.ts` (pattern: `tests/integration/migration.dropNonDanceIncome.test.ts`, reading `src/server/db/migrations/0051_payment_integrity.sql`). Tests: (a) after `ensureSchema`, `performer_payments.method` exists, the check/number constraint rejects a check with no number and cash with a number, the form constraint rejects `'#1500'` and accepts `'1500A'`, the unique index rejects a second `'1500'`, `payment_bookings.live` exists and the partial unique index rejects a second live line for a booking but accepts one when the first is `live = false`; (b) inside `sql.begin` (rolled back): drop `performer_payments_check_number` and the form constraint, insert two payments numbered `' 9001'` and `'9001'`, run the migration text, expect it to throw with a message containing `9001`; (c) likewise a payment numbered `'15OO'` → throws containing `15OO`; (d) likewise drop `payment_bookings_one_live`, give one booking lines on two non-voided payments → throws containing the booking id; (e) the migration text runs twice on a clean database without error (idempotent); (f) backfill: in a rolled-back transaction, a number-less payment and a voided payment's lines are set to `method='cash'` and `live=false` by re-running the backfill statements
- [X] T003 Create `src/server/db/migrations/0051_payment_integrity.sql` exactly as in [data-model.md](./data-model.md) §Migration 0051, **idempotent**: refusal checks as a `DO $$ … RAISE EXCEPTION … $$` block listing offending numbers/ids (upper(btrim) comparison; form `'^[0-9]+[A-Z]?$'`); `CREATE TYPE` guarded by a `pg_type` check; `ADD COLUMN IF NOT EXISTS`; constraints added only if absent (`pg_constraint` check); `CREATE UNIQUE INDEX IF NOT EXISTS`; backfills (`method='cash'` where number is null; `check_number = upper(btrim(check_number))`; `live=false` for voided payments' lines; `bookings.requires_check = (pay_cents > 0 AND NOT is_donated)`). Run `pnpm db:migrate`, then T002 — passes
- [X] T004 [P] Update Drizzle schema: `paymentMethodEnum = pgEnum("payment_method", ["check", "cash"])` and `export type PaymentMethod` in `src/server/db/schema/enums.ts`; `method: paymentMethodEnum("method").notNull().default("check")` on `performerPayments` and `live: boolean("live").notNull().default(true)` on `paymentBookings` in `src/server/db/schema/performerPayments.ts` (export from `src/server/db/schema/index.ts` if enums are re-exported there)
- [X] T005 [P] Add error factories to `src/server/lib/apiError.ts` (codes added to the code union): `bookingAlreadyPaid(details)` 409 `BOOKING_ALREADY_PAID`, `checkNumberTaken(details)` 409 `CHECK_NUMBER_TAKEN`, `invalidCheckNumber()` 422 `INVALID_CHECK_NUMBER` ("A check number is digits, optionally followed by one letter — e.g. 1500 or 1500A."), `secondPaymentToPayee(details)` 409 `SECOND_PAYMENT_TO_PAYEE`, `cashSingleBooking()` 422 `CASH_SINGLE_BOOKING`, `cashNotVoidable()` 422 `CASH_NOT_VOIDABLE`, `alreadyVoided()` 409 `ALREADY_VOIDED`, `alreadyBooked(details)` 409 `ALREADY_BOOKED`, each with a typed `details` shape per [contracts/payments.md](./contracts/payments.md)
- [X] T006 Write `tests/integration/payments.validation.test.ts` (pure Zod, no DB): `checkNumberSchema` trims and upper-cases (`" 1500a "` → `"1500A"`), rejects `"#1500"`, `"15OO"`, `"1500AB"`, `""`; `performerPaymentCreateSchema` requires `method`, requires `checkNumber` for `check`, forbids it for `cash`, rejects `cash` with two lines, accepts `confirmSecondPayment`, rejects `replacesPaymentId`; `performerPaymentPatchSchema` accepts `payeePerformerId`, `method`, `confirmSecondPayment`; `paymentLineAddSchema` = `{eventId, bookingId, amount ≥ 0}`; `settlementPerformerSchema` accepts optional `pay ≥ 0`. Then implement in `src/server/validation/payments.ts` (export `checkNumberSchema`; a malformed number must surface as `INVALID_CHECK_NUMBER` — map it in `src/server/lib/parseBody.ts` by field name `checkNumber`, like `purposes`); T006 passes
- [X] T007 Update existing integration tests that create payments to send `method` (and a well-formed number, or `method: "cash"` where they relied on a number-less payment): `tests/integration/performerPayments.test.ts`, `paymentVoid.test.ts`, `payments.multiCheckEdit.test.ts`, `payments.settlementDonate.test.ts`, `treasurer.performer-payments.test.ts`, `treasurer.paymentLines.test.ts`, `treasurer.paymentsCutover.test.ts`, `treasurer.same-evening.test.ts`, `eventDelete.crossEventPayment.test.ts`, `booking.substituteDiscriminator.test.ts`, `bookings.donated.test.ts` (grep `performer-payments\|createPerformerPayment` under `tests/`). Where a test asserted the old number-less-needs-a-note rule, change it to the cash rule. Leave assertions about behaviour this feature changes (void twice, substitution rate) for the story that changes them. **Also** make `createPerformerPayment` in `src/server/domain/payments/performerPaymentService.ts` store `method` from its input (one line in the insert), so cash payments satisfy migration 0051's method/number constraint from here on (analysis O1); T020 adds the remaining cash rules

**Checkpoint**: `pnpm db:migrate` clean; T002 and T006 pass; `pnpm tsc --noEmit` clean.

---

## Phase 2: Foundational (shared UI and view data)

**Purpose**: pieces every page story builds on.

- [X] T008 [P] Move `src/app/(door)/checkin/EventConfirm.tsx` to `src/app/_components/EventConfirm.tsx` with its own `src/app/_components/EventConfirm.module.css` (copy the `.event*` rules it uses from `src/app/(door)/checkin/checkin.module.css` and delete them there if nothing else uses them); update the import in `src/app/(door)/checkin/page.tsx`; `tests/component/checkin.page.test.tsx` and `checkin.selector.test.tsx` still pass unchanged
- [X] T009 [P] Write `tests/integration/payments.order.test.ts` (pure): `orderBookings` sorts caller, lead_musician, musician, sound_tech, instructor, open_band_musician, then by performer name (case-insensitive) within a role. Implement `orderBookings<T extends { performerType; performerName }>(rows)` in a new pure module `src/server/domain/payments/order.ts` (no DB imports, type-only schema imports, so the page can import it directly); passes
- [X] T010 Extend the payment view in `src/server/domain/payments/performerPaymentService.ts` (`PerformerPaymentView`, `toView`, `linesFor`): add `method`, `voidedAt`, `replacedByCheckNumber` (the number of a live or voided payment whose `replaces_payment_id` is this one), and per line `booked` (booking `pay_cents`), `eventId`, `eventDate`, `performer`, `performerType` (join bookings → events, performers). Add assertions for the new fields to `tests/integration/performerPayments.test.ts` first; passes

**Checkpoint**: foundation ready — user stories can begin.

---

## Phase 3: User Story 1 — Pay the evening's performers on a phone (Priority: P1) 🎯 MVP

**Goal**: a phone-first page: event confirmed, summary, ordered rows, pay by check or cash with an optional
override note, free bookings payable, cash flowing into the gate's deposit.

**Independent Test**: on a phone-sized screen, pay a caller, two musicians (one overridden with a note) and an
instructor (cash); the order, the summary before/after, and `/gate`'s cash line and deposit are right.

### Tests for User Story 1 (write first, confirm they fail)

- [X] T011 [P] [US1] Write `tests/integration/payments.method.test.ts` against `createPerformerPayment` and `POST /api/performer-payments`: a check with number and blank-amount → the booked amount is what the page sends (assert the stored line equals the sent amount); a check with no number → 422; cash with a number → 422; cash with no note → 201, `method: "cash"`, `checkNumber: null`; cash with two lines → 422 `CASH_SINGLE_BOOKING` (service-level too, bypassing Zod); a payment of $25 on a $0 instructor booking → 201 and the booking's `pay_cents` still 0 (FR-007); an override amount with `overrideReason` stores the note, and without one stores null (FR-008)
- [X] T012 [P] [US1] Write `tests/integration/payments.deposit.test.ts`: door record gross 300, float 15, other paid out 0 → deposit 285; record a $25 cash payment at the event → deposit 260 with no door-record patch; patch its amount to 30 → 255; delete it → 285; a check payment changes nothing; `PATCH /api/door-records/{id}` with other paid out 20 (+ reason) → 235 while a $30 cash payment exists (300−15−20−30); a cash payment at an event with no door record creates one; `GET/POST` door-record returns `doorRecord.performerCash` `[{ paymentId, payee, amount }]` and `cashPaidOut` = other only; a cash payment recorded at event B for event A's booking counts in B's deposit, not A's
- [X] T013 [P] [US1] Write `tests/integration/payments.summary.test.ts` for `getPaymentSummary` and `GET /api/events/{id}/payment-summary` (`base`): caller $120 + two musicians $100 + instructor $0 → booked 320, paid 0, stillToPay 320, count 3; pay caller 120 and one musician 90 → paid 210, stillToPay 100, count 1, difference −10; pay the instructor $25 → difference +15, count unchanged; a declined unpaid booking is excluded from booked and count; a declined paid booking counts as paid; a voided payment does not count; `booked = paid + stillToPay − difference` holds in every case (SC-006); `performerCash` lists live cash payments recorded at the event; a donated booking is neither booked nor still to pay
- [X] T014 [P] [US1] Extend `tests/integration/payments.addSettlementPerformer.test.ts` (free unless set, R11): `createBooking` for instructor and open_band_musician with no `pay` → `pay_cents` 0, `requires_check` false; with `pay: 50` → 5000, `requires_check` true, `is_overridden` true; `patchBooking` setting `pay` on an instructor keeps it; a donated booking has `requires_check` false
- [X] T015 [P] [US1] Write `tests/component/paymentSummary.test.tsx` for `PaymentSummaryView`: renders "Booked $320.00 · Paid $210.00 · Still to pay $100.00 (1)"; with count 0 renders "All paid" in place of the still-to-pay part; renders "Difference −$10.00" only when difference ≠ 0 (and "+$15.00" with a sign); renders "Earlier bookings paid tonight $60.00" only when > 0; is a `region` named "Payments"
- [X] T016 [P] [US1] Write `tests/component/payments.page.test.tsx` (stub `/api/events`, `/api/series`, `/api/events/e1/bookings`, `/api/events/e1/performer-payments`, `POST /api/performer-payments`): the event confirmation shows (heading with date and series; **Change**); the summary region is above the list; rows are in `orderBookings` order; a to-pay row shows a check-number field, a **Cash** option and an amount field; recording with a number and blank amount POSTs `method:"check"`, the number and the booked amount; changing the amount reveals a notes box (absent before) and the POST carries `overrideReason` only when typed; choosing Cash hides the number field and POSTs `method:"cash"`; a free row shows "free" and a **Pay** button that reveals the same controls; a paid row shows "Check #9001 $120.00" or "Cash $25.00" and the note only when present (no "Note" label otherwise); **Donated** on a to-pay row still opens the donation confirmation and POSTs `/api/bookings/{id}/donate`; the list refreshes after a save; a 422 from the POST is shown inside that row; with `/api/me/capabilities` returning `performerPaymentWrite: false`, the page shows the rows and summary but no entry controls or action buttons (FR-030, analysis C1)
- [X] T017 [P] [US1] Write `tests/component/gate.performerCash.test.tsx`: the gate page shows the payments summary region under the attendance breakdown (stub `/api/events/e1/payment-summary`); with `doorRecord.performerCash` of one payment it shows "Paid to performers in cash: Payee Fiddle $60.00"; the editable field is labelled "Other cash paid out"; add the new summary stub to the other `tests/component/gate.*.test.tsx` stubs so they keep passing

### Implementation for User Story 1

- [X] T018 [US1] In `src/server/domain/performers/performerRules.ts` set `requiresCheck: true` for `instructor` and `open_band_musician` (still `paid: false`, `rateKind: null`); in `src/server/domain/bookings/bookingService.ts` make `isForcedFree(type)` apply only when `input.pay === undefined` in `createBooking` and `patchBooking`, and compute `requires_check` as `payCents > 0 && !isDonated` via `bookingRequiresCheck`. T014 passes
- [X] T019 [US1] In `src/server/domain/door/calc.ts` add a `performerCashCents` parameter to `depositCents` (update its unit test in `tests/` if one exists); in `src/server/domain/door/doorRecordService.ts` add `performerCashFor(db, eventId)` (live cash payments recorded at the event: paymentId, payee, amount), `refreshDeposit(tx, eventId)` (recompute and store `deposit_cents` from the door record and performer cash; log `door_record.deposit_refreshed` with the event and figure), use it in `updateDoorRecord`, and add `performerCash` to the door-record view returned by open/GET
- [X] T020 [US1] In `src/server/domain/payments/performerPaymentService.ts`, `createPerformerPayment`: take `method`; normalise the number; refuse cash with more than one line (`cashSingleBooking`); insert `method`; drop client `replacesPaymentId`; run the insert and, when cash, `ensureDoorRecord` + `refreshDeposit` in one transaction; same for `patchPerformerPayment` (method/amount changes, refresh when the payment is or was cash) and `deletePerformerPayment` (refresh when cash). T011 and T012 pass
- [X] T021 [US1] Implement `getPaymentSummary(db, eventId)` in `src/server/domain/payments/paymentSummary.ts` per R10 (counted bookings; live lines wherever recorded; `earlierPaidHere`; `performerCash` via `performerCashFor`), export the `PaymentSummary` type, add `src/app/api/events/[id]/payment-summary/route.ts` (`base`, 404 `EVENT_NOT_FOUND` for an unknown event), and embed `summary` in `listPerformerPayments` / `GET /api/events/{id}/performer-payments`. T013 passes
- [X] T022 [P] [US1] Create `src/app/_components/PaymentSummaryView.tsx` and `PaymentSummaryView.module.css` (mobile-first, like `AttendanceBreakdownView`) rendering a `PaymentSummary` per the contract. T015 passes
- [X] T023 [US1] Create `src/app/(admin)/payments/payments.module.css` (mobile-first, following `src/app/(door)/checkin/checkin.module.css`: 16px gutters, tap targets ≥ 44px, no fixed widths, dialogs as full-width sheets on phones) and `src/app/(admin)/payments/savePayment.ts`: `savePayment(body)` → `{ ok: true, payment } | { ok: false, code, message, details }` wrapping `apiFetch` (reads the error envelope; network failure → code `UNREACHABLE`)
- [X] T024 [US1] Create `src/app/(admin)/payments/PerformerRow.tsx`: props booking, row state (to pay / free / paid here with its payment / paid elsewhere / voided lines), `onSaved`; renders per the contract's row table; the entry controls (number, Cash toggle, amount, notes box shown only when the amount differs from booked, Record) and the Pay button on a free row; shows a refusal inside the row; calls `savePayment`
- [X] T025 [US1] Rebuild `src/app/(admin)/payments/page.tsx`: `EventConfirm` (from `_components`, series from `/api/series`), `PaymentSummaryView` from the list response's `summary`, rows from `orderBookings` over counted bookings mapped to row states (from `payments`, `paidElsewhere`, `voidedByBooking` when present), the donation confirmation (kept), an actions bar (buttons for the dialogs added in later stories, rendered only once their dialog exists), refresh after any save; add `performerPaymentWrite: actorCan(ctx.actor, "performer_payment.write")` to `src/app/api/me/capabilities/route.ts` (held at some scope, like its siblings — the server still checks the event's series on every write; first write `tests/integration/me.capabilities.test.ts`: a Financial Secretary gets `performerPaymentWrite: true`, a base actor `false`), read it on the page as the booker screens do, and render read-only — no entry controls, no actions — when false. Remove the inline-style desk layout. T016 passes
- [X] T026 [US1] In `src/app/(door)/gate/page.tsx`: fetch and render `PaymentSummaryView` under the attendance breakdown (refetch after save); render the performers' cash line from `doorRecord.performerCash`; relabel the cash paid out field "Other cash paid out" (its `aria-label` too). T017 passes and the existing gate component tests pass

**Checkpoint**: US1 works on its own — Mary can pay an evening by check or cash on a phone.

---

## Phase 4: User Story 2 — One check per booking, one number per check (Priority: P1)

**Goal**: the server refuses duplicates; the page turns refusals into choices.

**Independent Test**: re-pay a paid booking; reuse a number here and at another event; add a booking to an
existing check; pay a performer twice.

### Tests for User Story 2 (write first, confirm they fail)

- [X] T027 [P] [US2] Write `tests/integration/payments.integrity.test.ts`: a second payment settling a booking with a live line → 409 `BOOKING_ALREADY_PAID` with `details.paymentId`; after voiding the first, allowed; two concurrent creates for the same booking (`Promise.allSettled`) → exactly one succeeds, the other `BOOKING_ALREADY_PAID`; number `9001` reused at the same event → 409 `CHECK_NUMBER_TAKEN` with `sameEvent: true, voided: false, payee, eventDate`; `9001a` when `9001A` exists → taken; reused at another event → `sameEvent: false`; reused when the holder is voided → `voided: true`; two concurrent creates with the same number → one 409; a malformed number → 422 `INVALID_CHECK_NUMBER`; a payee with a live payment at this event → 409 `SECOND_PAYMENT_TO_PAYEE` (check or cash) unless `confirmSecondPayment: true`; a live payment at another event does not trigger it; a voided one does not; a patch changing the payee to such a performer → 409 unless confirmed
- [X] T028 [P] [US2] Write `tests/integration/payments.addLine.test.ts` for `POST /api/performer-payments/{id}/lines`: adds a line and grows the total; refused `ALREADY_VOIDED` on a voided check, `CASH_SINGLE_BOOKING` on cash, `BOOKING_ALREADY_PAID` for a paid booking, 422 when the check was recorded at an event other than the request's `eventId`; **accepted** when the booking is at an earlier event and the check is at `eventId` (analysis I1); `CHECK_NUMBER_TAKEN.details.sameEvent` is true for a check at the request's `eventId` even when the booking being paid is an earlier event's; requires `performer_payment.write` in the event's scope (a base actor → 403)
- [X] T029 [P] [US2] Write `tests/component/payments.choices.test.tsx` (number taken, second payment): a row POST answered with `CHECK_NUMBER_TAKEN {sameEvent:true, voided:false}` opens a dialog naming the check with **Add this booking to check #9001** and **Change the number** (the latter showing "From a duplicate check book? Add a letter, e.g. 9001A."); Add POSTs `/api/performer-payments/{id}/lines` with the booking and amount; Change returns focus to the number field; with `sameEvent:false` or `voided:true` only Change is offered; `SECOND_PAYMENT_TO_PAYEE` opens "{payee} already has check #N tonight. Pay again?" and **Pay again** re-POSTs with `confirmSecondPayment: true`, **Cancel** sends nothing
- [X] T030 [P] [US2] Write `tests/component/payments.dialogs.test.tsx` → `describe("several performers")`: the dialog has no Cash option and no method choice; Record is refused on the page without a number; it POSTs `method:"check"` with one line per ticked booking at its entered amount; the same choice dialogs from T029 apply to its refusals

### Implementation for User Story 2

- [X] T031 [US2] In `src/server/domain/payments/performerPaymentService.ts` add `assertLinesUnpaid(tx, bookingIds, exceptPaymentId?)`, `assertNumberFree(tx, number, exceptPaymentId?)` (details per contract), `assertNoOtherPaymentToPayee(tx, eventId, payeeId, exceptPaymentId?)` (skipped when confirmed); call them in create and patch inside the transaction; map Postgres unique violations on `payment_bookings_one_live` / `performer_payments_check_number` to the same errors (re-query for details). T027 passes
- [X] T032 [US2] Add `addPaymentLine(db, id, input, actor, authz)` to `src/server/domain/payments/performerPaymentService.ts` (scope, voided, cash, check's event = the request's `eventId`, unpaid; update total; audit `performer_payment.line_added`) and `src/app/api/performer-payments/[id]/lines/route.ts` (`performer_payment.write`, `paymentLineAddSchema`). T028 passes
- [X] T033 [US2] Create `src/app/(admin)/payments/ConfirmDialog.tsx` (accessible `role="dialog"`, labelled, focus-trapped, buttons passed in) and handle `CHECK_NUMBER_TAKEN` / `SECOND_PAYMENT_TO_PAYEE` in `savePayment.ts` callers (`PerformerRow`) per T029. T029 passes
- [X] T034 [US2] Create `src/app/(admin)/payments/SeveralPerformersDialog.tsx` (payee picker from the event's booked performers plus search, number required, ticked bookings with amounts defaulting to booked, notes box, Record) replacing the old inline popup; wire it into the page's actions bar. T030 passes

**Checkpoint**: US1 + US2 — the record cannot hold duplicates.

---

## Phase 5: User Story 3 — Correct, delete or void a check (Priority: P1)

**Goal**: edit any live payment, delete with the right wording and warning, void once with a reason, keep
voids visible, link replacements.

**Independent Test**: edit a two-booking check to three; delete an unwritten check; void and replace a
written one; delete a cash payment.

### Tests for User Story 3 (write first, confirm they fail)

- [X] T035 [P] [US3] Write `tests/integration/payments.correct.test.ts`: patch changes number (rules apply), payee (second-payment rule), amount, and `lines` (add/remove/re-amount; total = Σ lines; a line settling a paid booking refused; `lines: []` refused); a patch on a voided check → `ALREADY_VOIDED`; void with blank reason → 422; void sets `voided_at`, reason and every line `live=false`; a second void → `ALREADY_VOIDED` and the first date/reason unchanged; void of cash → `CASH_NOT_VOIDABLE`; a new payment for a booking whose check was voided gets `replaces_payment_id` = that check (most recently voided when several), and the voided payment's view shows `replacedByCheckNumber`; delete removes the payment and lines, audits `performer_payment.deleted` with number, method, amount and lines, and is refused on a voided check; update `tests/integration/paymentVoid.test.ts` where it expected re-void to overwrite
- [X] T036 [P] [US3] Extend `tests/integration/performerPayments.test.ts`: `GET /api/events/{id}/performer-payments` returns `voidedByBooking` (for this event's bookings, including voids recorded at other events) and `treasurerReportGeneratedAt` (null, then the latest `treasurer_report_audit.created_at` after `assembleTreasurerReport`)
- [X] T037 [P] [US3] Extend `tests/component/payments.choices.test.tsx` with void and delete: a paid check row shows **Edit**, **Void**, **Delete** and the visible text "Void: the check was written. Delete: it was never written."; a cash row shows no Void; Delete opens "This erases check #9001 as never written. If you wrote it, void it instead." with Delete, Void and Cancel, and Delete sends `DELETE`; for cash the text is "This erases the cash payment of $25.00 to Payee Fiddle."; with `treasurerReportGeneratedAt` set the dialog adds "The treasurer report for this event has been generated — Mike may already have entered it." — for a check **and** for a cash payment (FR-034, analysis G1); Void opens a dialog naming the check, listing its bookings, with Void disabled until a reason is typed, then POSTs the reason; a booking with `voidedByBooking` shows "Voided #9004 — wrong amount" in quiet text and still after a replacement
- [X] T038 [P] [US3] Extend `tests/component/payments.dialogs.test.tsx` → `describe("edit")`: Edit opens a dialog with number (checks only), payee, and one amount per settled booking plus "Add a booking" (the event's unpaid bookings) and remove; saving PATCHes `checkNumber`, `payeePerformerId`, `lines`, `overrideReason`; refusals use the T029 choices; a voided check has no Edit

### Implementation for User Story 3

- [X] T039 [US3] In `src/server/domain/payments/performerPaymentService.ts`: patch supports `payeePerformerId` and `method` with all rules; void refuses voided (`WHERE voided_at IS NULL` + `alreadyVoided`) and cash, and sets lines `live=false` in the same transaction; create sets `replaces_payment_id` (R8); delete refuses voided and audits the erased details; the view's `replacedByCheckNumber`. T035 passes
- [X] T040 [US3] Extend `listPerformerPayments` with `voidedByBooking` and `treasurerReportGeneratedAt` (R17). T036 passes
- [X] T041 [US3] Create `src/app/(admin)/payments/EditPaymentDialog.tsx`, `VoidDialog.tsx` and `DeleteDialog.tsx`; add the paid-row actions, the explanation text and the quiet voided lines to `PerformerRow.tsx`. T037 and T038 pass

**Checkpoint**: P1 complete — **stop and verify** (a first run of T067's phone check and quickstart §1–§3) before the P2 stories.

---

## Phase 6: User Story 4 — Add a last-minute performer (Priority: P2)

**Goal**: a dialog to find or create a performer, choose an allowed role, and set the rate.

**Independent Test**: add an existing performer as a paid instructor; create and add a new person.

### Tests for User Story 4 (write first, confirm they fail)

- [X] T042 [P] [US4] Extend `tests/integration/payments.addSettlementPerformer.test.ts`: `pay` sets the booked amount (and `is_overridden`); absent `pay` uses the standard rate; an already-booked performer → 409 `ALREADY_BOOKED` with the existing booking's id and role (replacing the old return-existing assertion); a sound tech on a Community Dance event → the existing refusal
- [X] T043 [P] [US4] Write `tests/integration/events.roles.test.ts` for `GET /api/events/{id}/roles` (`base`): TNC lists caller, lead_musician, musician, sound_tech, instructor, open_band_musician with rates from `series_parameters` on the event date (instructor and open band 0); Community Dance omits sound_tech; unknown event → 404
- [X] T044 [P] [US4] Extend `tests/integration/performerSearch.test.ts`: `GET /api/performers?q=…&eventId=…` items carry `bookedAs` (the role for a performer booked on that event, else null); without `eventId` no `bookedAs` key
- [X] T045 [P] [US4] Extend `tests/component/payments.dialogs.test.tsx` → `describe("add a performer")`: typing searches `/api/performers?q=&eventId=`; a booked result shows "already booked as musician" and cannot be chosen; choosing a performer shows a role select filled from `/api/events/e1/roles` and the chosen role's rate in an editable amount; Add POSTs `settlement-performer` with `performerType` and `pay` only when changed; "Not listed? Create a performer" offers existing contacts from `/api/attendance/search` (choose → `POST /api/performers {contactId}`) or a new person (first name required, last name, email → `POST /api/performers {firstName, lastName, email}`), then continues with the created performer; a refusal (e.g. an email owned by someone else) is shown in the dialog

### Implementation for User Story 4

- [X] T046 [US4] In `src/server/domain/bookings/bookingService.ts` `addSettlementPerformer`: pass `pay` to `createBooking`; replace return-existing with `alreadyBooked`; update `src/app/api/events/[id]/settlement-performer/route.ts` if needed. T042 passes
- [X] T047 [P] [US4] Add `listEventRoles(db, eventId)` (series `has_sound_tech`; rates via `resolveParameterCents` with each role's `rateKind`, else 0) in `src/server/domain/bookings/bookingService.ts` and `src/app/api/events/[id]/roles/route.ts` (`base`). T043 passes
- [X] T048 [P] [US4] Add an optional `eventId` to `searchPerformers` in `src/server/domain/performers/performerService.ts` (left join bookings on that event → `bookedAs`) and pass it from `src/app/api/performers/route.ts`. T044 passes
- [X] T049 [US4] Create `src/app/(admin)/payments/PerformerPicker.tsx` (search with `bookedAs`, create-performer flow via existing contact or new person, `onPicked(performer)`) and `AddPerformerDialog.tsx`; wire **Add a performer** into the actions bar. T045 passes

---

## Phase 7: User Story 5 — Substitute a performer (Priority: P2)

**Goal**: a dialog; the substitute steps into the slot at the same booked amount.

**Independent Test**: substitute an unpaid $120 caller; the substitute's row is $120.

### Tests for User Story 5 (write first, confirm they fail)

- [X] T050 [P] [US5] Extend `tests/integration/booking.substituteDiscriminator.test.ts`: unpaid path — a $150 overridden caller booking re-pointed to another performer keeps `pay_cents` 15000, `is_overridden` true, `requires_check` true; live-paid path — the new booking carries the replaced booking's `pay_cents`; a donated booking's substitute is $0 and not donated; the Booker's own `patchBooking` re-point is unchanged (still resets to the standard rate)
- [X] T051 [P] [US5] Extend `tests/component/payments.dialogs.test.tsx` → `describe("substitute")`: choose a booking (select listing the event's bookings with role and booked amount); the booked amount is shown as text with no amount input; the substitute is found or created with `PerformerPicker`; Substitute POSTs `/api/bookings/{id}/substitute` with `newPerformerId`; retire `tests/component/payments.substitute.test.tsx` once its cases are covered here

### Implementation for User Story 5

- [X] T052 [US5] In `src/server/domain/bookings/bookingService.ts` `substitutePerformer`: on the unpaid path update the booking directly (performer, status `proposed`, keep `pay_cents`/`is_overridden`/`requires_check`, clear `is_donated` with pay 0 when it was donated) instead of calling `patchBooking`'s re-point; on the live-paid path create the new booking with `pay` = the replaced booking's amount and copy `is_overridden`. T050 passes
- [X] T053 [US5] Create `src/app/(admin)/payments/SubstituteDialog.tsx` using `PerformerPicker`; wire **Substitute a performer** into the actions bar. T051 passes

---

## Phase 8: User Story 6 — The Treasurer sees differences and every check (Priority: P2)

**Goal**: one list of all checks by number with voids and replacements; booked vs paid and notes; cash under
cash paid out; payments made at other events.

**Independent Test**: an event with an overridden check with a note, a voided check and its replacement, a
cash payment, and a booking paid at a later event.

### Tests for User Story 6 (write first, confirm they fail)

- [X] T054 [P] [US6] Extend `tests/integration/treasurer.paymentLines.test.ts` for `assembleTreasurerReport`: `checks` contains live and voided checks sorted 1499, 1500, 1500A, 1501 (R3a); a voided check carries `voided`, `voidReason`, `replacedBy`; each line has `performer`, `booked`, `paid`, and `eventDate` only for another event's booking; `note` is the override reason; `cashPayments` lists live cash payments (not in `checks`); `otherCashPaidOut` = door record amount and reason; `paidElsewhere` lists this event's bookings settled at another event with that event's date; the legacy `performerPayments`/`voidedPerformerPayments` fields are unchanged
- [X] T055 [P] [US6] Extend `tests/component/treasurer.page.test.tsx`: the Performer Payments section renders `checks` in order with "Voided — wrong amount · replaced by #1501" on a voided one; a line whose paid differs from booked shows "booked $120.00 · paid $100.00" and the note; a matching line shows neither; a cash payments list sits under a "Cash paid out" heading with the other cash paid out and its reason; "Paid at another event" lists `paidElsewhere`; lines from another event show that event's date

### Implementation for User Story 6

- [X] T056 [US6] Add `compareCheckNumbers(a, b)` (digits as number, then letter; tested in `tests/integration/payments.order.test.ts`) to `src/server/domain/payments/order.ts`; extend `assembleTreasurerReport` and `TreasurerReport` in `src/server/domain/treasurer/reportService.ts` with `checks`, `cashPayments`, `otherCashPaidOut`, `paidElsewhere` per the contract. T054 passes
- [X] T057 [US6] Update `src/app/(admin)/treasurer/page.tsx` to render the new sections in place of the live-only table. T055 passes

---

## Phase 9: User Story 7 — Pay a booking from an earlier event (Priority: P2)

**Goal**: from tonight's page, pay a performer's unpaid booking from the last 90 days; both events show
where it was paid.

**Independent Test**: leave a booking unpaid three weeks ago; pay it in cash tonight.

### Tests for User Story 7 (write first, confirm they fail)

- [X] T058 [P] [US7] Write `tests/integration/payments.earlier.test.ts`: `GET /api/performers/{id}/unpaid-bookings?forEvent=` lists the performer's bookings at events dated 1–90 days before (not the same day, not day 91, not later), with a booked amount, not donated, not declined, no live line, newest first, only in series where the actor holds `performer_payment.write` (a base actor → 403; an FS scoped to TNC does not see an ECD booking); paying one with `eventId` = tonight creates the payment at tonight and settles it; the earlier event's `performer-payments` response has `paidElsewhere[bookingId]` with tonight's date and its summary counts it paid; tonight's summary has `earlierPaidHere`; tonight's payment view lines carry the earlier event's date
- [X] T059 [P] [US7] Extend `tests/component/payments.dialogs.test.tsx` → `describe("earlier booking")` and `tests/component/payments.page.test.tsx`: **Pay an earlier booking** opens a dialog with `PerformerPicker` (no create option), then lists `/api/performers/{id}/unpaid-bookings?forEvent=e1` with date, role and amount; choosing one shows the same check/cash/amount/notes controls and POSTs with `eventId: "e1"` and that booking's line; the second-payment choice applies; the page lists tonight's payments whose lines are other events' bookings in a separate "Earlier bookings paid tonight" list with each date; a row whose booking is in `paidElsewhere` reads "Paid at 2026-09-18"

### Implementation for User Story 7

- [X] T060 [US7] Create `src/server/domain/payments/unpaidBookings.ts` (`listUnpaidEarlierBookings(db, performerId, forEventId, actor)`) and `src/app/api/performers/[id]/unpaid-bookings/route.ts` (`performer_payment.write`; scope filter via the actor's grants as `assertEventScope` does); add `paidElsewhere` to `listPerformerPayments`. T058 passes
- [X] T061 [US7] Create `src/app/(admin)/payments/EarlierBookingDialog.tsx`; add the "Earlier bookings paid tonight" list and "Paid at {date}" row state to the page and `PerformerRow.tsx`; wire **Pay an earlier booking** into the actions bar. T059 passes

---

## Phase 10: User Story 8 — Unmatched online payments leave the payments page (Priority: P3)

**Goal**: the parked-payments section is gone from `/payments`; its routes stay.

**Independent Test**: `/payments` has no unmatched-payments section and makes no parked-payments request.

- [X] T062 [P] [US8] Add to `tests/component/payments.page.test.tsx`: no heading or text "Parked online payments" and no request to `/api/membership-captures/parked`; confirm an existing integration test still covers `GET /api/membership-captures/parked` (add a one-line assertion if none)
- [X] T063 [US8] Remove the parked section, its state and its fetches from `src/app/(admin)/payments/page.tsx` (if T025 has not already). T062 passes

---

## Phase 11: Polish & Cross-Cutting

- [X] T064 Retire or rewrite the old page's component tests so every case they covered is either covered by the new tests or no longer applies: `tests/component/payments.addPerformer.test.tsx`, `payments.allocation.test.tsx`, `payments.donateAtSettlement.test.tsx`, `payments.freeRows.test.tsx`, `payments.inlineEdit.test.tsx`, `payments.multiCheckGuard.test.tsx`, `payments.perPerformer.test.tsx`, `payments.substitute.test.tsx`; list what was retired and why in a **Deviations** section at the end of this file
- [X] T065 Update `specs/phase-8-requirements/mary-fs-payments.md`: mark MARY-R1–R4, R6, R7, R9–R14, R17–R19 and X-P1 delivered by 081 (R14 on both `/payments` and `/gate`; R1 and R2 remain open for `/gate`); record R3a's check-number form under MARY-R13. Then `pnpm exec markdownlint-cli2 --fix` on it and `pnpm lint:md`
- [X] T066 Automated gates with no dev server running: `pnpm db:migrate`, `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`, `pnpm lint:md`, and `pnpm exec eslint` + `pnpm exec prettier --check` on the changed files only; after the build, `rm -rf .next/dev`. Record the result (date, test and file counts) in a **Verification** section of [plan.md](./plan.md)
- [X] T067 Phone layout check in the browser preview on Rich's dev server (ask Rich to start it and sign in): `/payments` and `/gate` at 390 × 844, 375 × 667 and 360 × 640 — the event confirmation and summary above the list, no horizontal scrolling, tap targets ≥ 44px, every dialog within the viewport and scrollable inside; fix what fails; record in plan.md **Verification**
- [X] T068 Manual pass: Rich walks [quickstart.md](./quickstart.md) §1–§5 and runs the cleanup; record the outcome and any findings in plan.md **Verification**

---

## Dependencies & Execution Order

- **Setup (T001–T007)**: T001 first (data check); T002 → T003; T004–T005 parallel after T003; T006 after
  T005; T007 after T006.
- **Foundational (T008–T010)**: after Setup; T008 and T009 parallel; T010 after T004.
- **US1 (T011–T026)**: after Foundational. Tests T011–T017 in parallel; then T018, T019 → T020 → T021;
  T022 in parallel with T018–T021; T023 → T024 → T025; T026 after T021 and T022.
- **US2 (T027–T034)**: after US1 (uses the create path and `PerformerRow`). Tests parallel; T031 → T032;
  T033 after T031; T034 after T033.
- **US3 (T035–T041)**: after US2 (edit and replacement reuse its checks). T039 → T040 → T041.
- **US4 (T042–T049)** and **US5 (T050–T053)**: after US1; US5's dialog needs US4's `PerformerPicker`
  (T049 before T053). Server tasks T046–T048 and T052 are independent of each other.
- **US6 (T054–T057)**: after US3 (voids, replacements) — server side can start after US2.
- **US7 (T058–T061)**: after US2 (second-payment rule) and US1's summary.
- **US8 (T062–T063)**: any time after T025.
- **Polish (T064–T068)**: last; T067 after T066; T068 after T067.

Most UI tasks touch `page.tsx` or `PerformerRow.tsx`, so UI work within and across stories runs in sequence.

### Parallel opportunities

```text
Setup:        T004 | T005
Foundational: T008 | T009
US1 tests:    T011 | T012 | T013 | T014 | T015 | T016 | T017
US1 impl:     T022 alongside T018–T021
US2 tests:    T027 | T028 | T029 | T030
US3 tests:    T035 | T036 | T037 | T038
US4:          T042 | T043 | T044 | T045, then T046 | T047 | T048
US5 / US6:    T050 | T052 (server)  alongside  T054 | T056 (server)
US7 tests:    T058 | T059
```

## Implementation Strategy

- **MVP = Phases 1–3 (US1)**: the phone page, cash, the summary and the gate's deposit.
- **Then US2 and US3** to finish the P1 core; **stop and verify** (phone check and quickstart §1–§3) before
  the P2 stories, as agreed in clarification.
- **Then US4–US7**, then **US8**, then Polish.
- One atomic commit for the feature, one PR (constitution).

---

## Deviations

Recorded during `/speckit-implement`:

- **T003 — enum name.** The database enum is `performer_payment_method` (TypeScript `PerformerPaymentMethod`),
  not `payment_method`: that name is already the gate's cash/card enum (migration 0004).
  [data-model.md](./data-model.md) is corrected.
- **T006, T009 — test location.** The pure validation and ordering tests are in `tests/unit/`
  (`payments.validation.test.ts`, `payments.order.test.ts`), beside the other pure tests, not in
  `tests/integration/`. `compareCheckNumbers` (T056) is tested there too.
- **T007 — existing tests.** Besides adding `method`, `payments.multiCheckEdit.test.ts` now starts from a
  numbered check (a number-less check no longer exists), `treasurer.paymentLines.test.ts` uses well-formed
  numbers, and `paymentVoid.test.ts` no longer sends `replacesPaymentId` (the server sets it, R8).
  `event.delete.test.ts` and `eventDelete.crossEventPayment.test.ts` record checks rather than cash, since cash
  now opens a door record and cannot be voided. `bookings.types.test.ts` and `tests/unit/performer.rules.test.ts`
  now assert free-unless-set (R11); `tests/unit/door.calc.test.ts` covers the performer-cash deposit term.
- **T021 — void clears `live` early.** The summary counts only live lines, so setting a voided check's lines
  `live = false` (planned for T039) was brought forward into T021.
- **T025 — the capabilities flag.** `performerPaymentWrite` is added to `/api/me/capabilities`, tested in
  `tests/integration/me.capabilities.test.ts` (analysis C1).
- **T025/T033 — dialog shell.** A small `Dialog.tsx` (labelled modal panel, Escape to close) is shared by every
  payments dialog; `ConfirmDialog.tsx` holds the two choices built on it. `types.ts` holds the page's types.
- **T031 — edit before void.** `patchPerformerPayment` refuses a voided check with `ALREADY_VOIDED` from T031
  on (was a generic validation error).
- **T034 — payee list.** The several-performers dialog offers the event's booked performers as payees (not
  every performer), which covers paying a band leader for the band.
- **T039 — delete audit.** The deletion is recorded with `recordAudit` (a durable `audit_events` row in the
  same transaction), as the audit module asks of new code, rather than the log-only `writeAudit`.
- **T063 — done with T025.** The rebuilt page never had the unmatched-payments section.
- **T064 — retired early.** The old page's eight component tests were retired at the P1 checkpoint, once the
  new page replaced them. What covers each case now:
  - `payments.perPerformer` — blank amount pays the booked amount, a typed amount is sent, an untouched row
    records nothing: `payments.page`. Its check-less-payment-with-comment case no longer applies (cash).
  - `payments.freeRows` — a free row and an outstanding row: `payments.page`; a booking settled at another
    event: `payments.dialogs` → "paid at another event".
  - `payments.donateAtSettlement` — `payments.page` ("still records a donated fee").
  - `payments.inlineEdit` — `payments.dialogs` → "edit"; void: `payments.choices`.
  - `payments.allocation` — `payments.dialogs` → "several performers"; void: `payments.choices`.
  - `payments.multiCheckGuard` — the number-less multi-check comment rule no longer applies (a check always
    has a number); editing a multi-booking check's number: `payments.dialogs` → "edit".
  - `payments.addPerformer` — `payments.dialogs` → "add a performer".
  - `payments.substitute` — `payments.dialogs` → "substitute".
- **T061 — shared entry.** The check/cash/amount/note controls became `PaymentEntry.tsx`, used by
  `PerformerRow` and `EarlierBookingDialog`; the refusal types moved to `types.ts`. The performer picker takes
  `forPaying` (no "already booked" block and no creating) for the earlier-booking dialog.
- **T062 — parked route test.** `tests/integration/paypalCapture.test.ts` now also reads
  `GET /api/membership-captures/parked`, which had no route-level test.
- **T068 findings.** The event heading order (series, label, date, 12-hour time) changed in the shared
  `EventConfirm`, so `/checkin` shows it too (`checkin.page.test.tsx` updated). The Void/Delete explanation is
  shown once above the list instead of on every row (no hover on phones). Void lines moved under the payment
  line. The delete warning is limited to reports generated after the event's day and reworded. See plan.md
  Verification.
- **P1 checkpoint findings.** A check paying several bookings shows "· check total $T" on each of its rows
  (Rich's manual pass). The quickstart's §2 step 3 and §3 step 1 were corrected. Letters in check numbers
  cannot be typed on a phone's number keypad — accepted as YAGNI (spec clarification).
