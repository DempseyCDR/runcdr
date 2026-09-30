# Tasks: Mobile building blocks for volunteer pages

**Input**: Design documents from `specs/089-mobile-building-blocks/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: required — Principle I (Test-First) is non-negotiable. Each story's tests are written and
seen to fail for the right reason before its implementation. Sizes and layout cannot be measured in
jsdom; they are held by the guard tests and measured in the browser (quickstart §2–§3).

**Organization**: by user story. US1 and US2 are both P1. The dialog shell (US2) renders the action
bar, so the bar's component is built first, in Foundational; US3 then pins it on the two pages and
handles the keyboard.

**⚠️ The dev server must be stopped** for every task that runs the test suite or the build.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

**Purpose**: record what is undersized today, so SC-001 is checked against a known list.

- [X] T001 With the dev server running, run the quickstart §2 measuring script at 390 × 844 on check-in, the gate, payments and the gate report, and in one dialog of each of the four shells; record every control under 48 × 48 (page, control, size) in `specs/089-mobile-building-blocks/baseline.md`

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the tap token every story sizes with, and the action bar the dialog shell renders.

- [X] T002 Add `--tap-min: 48px` to `src/app/globals.css` (vocabulary only; research R6), and point feature 060's `.touchTarget` in `src/app/(admin)/_components/AdminPage.module.css` and the row minimum in `src/app/(admin)/_components/TriageList.module.css` at `var(--tap-min)` instead of `var(--space-7)` — same 48px, so their existing tests stay green
- [X] T003 [P] Write the failing `tests/component/actionBar.test.tsx` per [contracts/action-bar.md](./contracts/action-bar.md) A1: children render in the order given inside one `role="group"` named "Actions", the last child is the last control, and `pinned` marks the bar as pinned (a `data-pinned` attribute — jsdom cannot see position); see it fail (no component)
- [X] T004 Create `src/app/_components/ActionBar.tsx` and `ActionBar.module.css`: `role="group"` named "Actions" with `data-pinned` when pinned ([contracts/action-bar.md](./contracts/action-bar.md) structure); one line (`flex-wrap: nowrap`), 8px gaps; the whole bar flush right with Close first, beside the others (A1; changed from Close at the left edge after Rich's phone test, 2026-09-30); every button at least `var(--tap-min)` both ways with its label wrapping inside it (`white-space: normal`), text at least 1rem; the `pinned` variant sticky at the bottom with padding of at least `env(safe-area-inset-bottom)` (research R5); T003 goes green

**Checkpoint**: the token and the bar exist; nothing uses the bar yet.

---

## Phase 3: User Story 1 — Every control is easy to hit (Priority: P1) 🎯 MVP

**Goal**: every control on check-in, the gate, payments and the gate report is at least 48 × 48,
8px apart, with small marks tappable across 48 × 48; the public site stays at 44.

**Independent test**: the quickstart §2 script returns an empty list on the four pages; the public
nav still measures 44px.

### Tests for User Story 1 (write first, see them fail)

- [X] T005 [US1] Write the guard `tests/unit/volunteerStyle.test.ts`, rule 1 only ([contracts/style-tokens.md](./contracts/style-tokens.md)): in `checkin.module.css`, `gate.module.css`, `payments.module.css`, `treasurer.module.css`, `SaleOrCheckDialog.module.css` and `ActionBar.module.css`, every `min-height`/`min-width`/`min-block-size`/`min-inline-size` is `0`, `var(--tap-min)` or a `calc()` on it; see it fail listing today's `2.75rem`, `2.5rem` and `2.25rem`

### Implementation for User Story 1

- [X] T006 [P] [US1] In `src/app/(door)/checkin/checkin.module.css`, replace every tap minimum with `var(--tap-min)` — including the 36px control (line 40, `2.25rem`) and the 40px one (line 182, `2.5rem`) — and give any small mark (the "already checked in" tick, a status letter) a 48 × 48 hit area by padding or a transparent `::before` (FR-003); controls spaced with `gap: var(--space-2)` (FR-002)
- [X] T007 [P] [US1] Same in `src/app/(door)/gate/gate.module.css` (four minimums, including the counting dialog's keypad keys)
- [X] T008 [P] [US1] Same in `src/app/(admin)/payments/payments.module.css` (six minimums)
- [X] T009 [P] [US1] Same in `src/app/(admin)/treasurer/treasurer.module.css` (the event selector; the Print button's rule is left alone — T029 removes it)
- [X] T010 [P] [US1] Same in `src/app/_components/SaleOrCheckDialog.module.css` (five minimums)
- [X] T011 [US1] Run `pnpm vitest run tests/unit/volunteerStyle.test.ts tests/component` (dev server stopped) — the guard green, every page test still green; then, with the dev server running, re-run the quickstart §2 script on the four pages (empty list) and check the public nav's controls still measure 44px (FR-005); note the results in `baseline.md` beside T001's

**Checkpoint**: the four pages meet 48px; dialogs follow in US2.

---

## Phase 4: User Story 2 — One dialog that behaves the same everywhere (Priority: P1)

**Goal**: one shell for all 29 dialogs — full screen below 40rem, heading as its name, focus in the
search box or first field, Tab trapped, focus returned, Escape and Back close, a tap outside closes
only a dialog with no actions of its own, and unsaved work asks before it is discarded.

**Independent test**: quickstart §4 on the five named dialogs; `oneDialog.test.ts` green.

### Tests for User Story 2 (write first, see them fail)

- [X] T012 [P] [US2] Write the failing `tests/component/dialog.focus.test.tsx` per [contracts/dialog.md](./contracts/dialog.md): the heading is the accessible name (`aria-labelledby`, R4) (D-structure); focus goes to the search box, else the first field (D1); Tab and Shift-Tab wrap inside the dialog over 30 presses each (D2, SC-003); on close focus returns to the opener (D9); a dialog opened over another holds focus and hands it back to the one beneath (D10); the bar holds Close first, then `actions` in order, and Close alone when `actions` is absent (FR-019)
- [X] T013 [P] [US2] Write the failing `tests/component/dialog.close.test.tsx`: Escape and Close call `onClose` when unchanged (D3, D6); a `popstate` closes only the top dialog, and opening pushes one history entry (D4, R2); a backdrop click closes a dialog without `actions` and does nothing to one with them (D5); typing in a field then closing — by Close, Escape and Back — shows "Discard your changes?" with Keep editing focused; Keep editing keeps the typing (and re-pushes the entry after Back); Discard calls `onClose` (D6a, D7); typing only in a search box closes without asking; `useDialogSaved()` makes it close without asking (D8); the document does not scroll while one is open, and does again after the last closes (D11); two dialogs closing in one render go back once, and a changed address stops history management (R2)
- [X] T014 [P] [US2] Write the guard `tests/unit/oneDialog.test.ts`: no file under `src/app` other than `src/app/_components/Dialog.tsx` contains `role="dialog"` (SC-002); see it fail listing the seven files that do today (contacts' page holds two)

### Implementation for User Story 2 — the shell

- [X] T015 [US2] Create `src/app/_components/dialogStack.ts` per [data-model.md](./data-model.md): the ordered stack with `entries`, `pushed`, `address`, `ignorePops`; push a same-address history entry marked `{ runcdrDialog: id }` on open, read back through an `isDialogState(s: unknown)` type guard (no cast); hand `popstate` to the top entry; reconcile removals once per render with a single `history.go(-n)` and ignore the `popstate` it causes; stop managing history if the address changed; lock document scroll while non-empty (R2, R9)
- [X] T016 [US2] Rewrite `src/app/_components/Dialog.tsx` per [contracts/dialog.md](./contracts/dialog.md): props `heading`, `onClose`, `actions?`, `children` (`label` retired); `aria-labelledby` its `h2`; register with the stack; first focus (D1), Tab trap (D2), focus return (D9); changed on the first `input`/`change` not from `input[type="search"]`; every close request goes through the discard question, shown in place of the bar; export `useDialogSaved()` (a context the body can call); render `<ActionBar>` with Close first then `actions`; backdrop click is a close request only without `actions`
- [X] T017 [US2] Rewrite `src/app/_components/Dialog.module.css` (R10): below `40rem` fixed at `inset: 0`, `100dvh`, a column of heading, scrolling body (`overflow-y: auto; overscroll-behavior: contain`) and bar, no radius; from `@media (min-width: 40rem)` centred over the backdrop, up to `40rem` wide, no taller than the screen less a margin, bar still at the foot; text at least 1rem; add the file to T005's guard list — T012, T013 green

### Implementation for User Story 2 — moving each shell onto it

Each migration moves its existing component tests first (new accessible name, Close in the bar, the
discard question where a test types and then closes) and sees them fail against the old shell; then
converts; then checks its controls meet `--tap-min` (FR-001 applies to every dialog) and its body
text and fields are at least 16px (FR-022 applies to every dialog). A dialog that stays open after a
successful save calls `useDialogSaved()` there. A viewer who may only read gets no actions they
cannot use; with none left, `actions` is omitted, so the bar holds Close alone (FR-019).

- [X] T018 [US2] Shell 1, the Booker's editors: `src/app/(admin)/_modals/BookingModal.tsx` and `EventModal.tsx` — `heading` only, buttons into `actions` with Save last (Delete, Cancel this dance, … before it), own Close removed, `useDialogSaved()` where a save keeps the dialog open (a booking saved back to a band's lineup); fields and body text at least 16px (FR-022); tests `tests/component/bookingModal*.test.tsx`, `eventModal*.test.tsx`, `bookingCentral.booking.test.tsx`, `bookingCentral.event.test.tsx`
- [X] T019 [P] [US2] Shell 1, payments: `src/app/(admin)/payments/{AddPerformer,Confirm,Delete,EarlierBooking,EditPayment,SeveralPerformers,Substitute,Void}Dialog.tsx` and the two dialogs in `page.tsx` — each `.buttons` row into `actions`, main action last, Cancel/Close replaced by the bar's Close; tests `tests/component/payments.dialogs.test.tsx`, `payments.page.test.tsx`, `payments.performerEditor.test.tsx`, `payments.choices.test.tsx`
- [X] T020 [P] [US2] Shell 1, the gate and the sale: `src/app/(door)/gate/CountDialog.tsx` and `src/app/_components/SaleOrCheckDialog.tsx` — actions into the bar, main action last; tests `tests/component/gate.countDialog.test.tsx`, `saleOrCheckDialog.test.tsx`, `checkin.saleOrCheck.test.tsx`, `gate.sales.test.tsx`, `gate.checks.test.tsx`
- [X] T021 [US2] Shell 2, Booking Central: replace `Panel` in `src/app/(admin)/bookings/page.tsx` with `Dialog` at all seven uses (venue, lineup, needing a contact, performer card, band card, caller-for, music-for); each panel body's own first heading becomes the shell's `heading` and is removed from the body (R4); the panel's buttons into `actions`; delete `Panel` and the `.backdrop`/`.panel` rules in `hub.module.css`; the band-lineup → booking nesting keeps focus and Back per D10; body controls in `hub.module.css`, `PerformerCard`, `BandRoster` and `Lineup` meet `--tap-min`, and their text and fields are at least 1rem (FR-022); tests `tests/component/bookingCentral.*.test.tsx`, `bandRoster.test.tsx`, `bandLineup.test.tsx`, `lineup.test.tsx`, `performerCard.test.tsx` (after T018 — both touch the Booking Central tests)
- [X] T022 [P] [US2] Shell 3, check-in: `src/app/(door)/checkin/CorrectionModal.tsx`, `CheckedInDialog.tsx`, `AddContactDialog.tsx` onto `Dialog` — the correction opens over the checked-in list (nested; the old `!editing` Escape guard goes, the stack does it); `useDialogSaved()` after a correction's patch that leaves it open; their backdrop/panel rules removed from `checkin.module.css`; tests `tests/component/checkin.correctionModal.test.tsx`, `checkin.checkedInDialog.test.tsx`, `checkin.addContact.test.tsx`, `checkin.page.test.tsx`
- [X] T023 [P] [US2] Shell 4, contacts: the record editor and Add contact in `src/app/(admin)/contacts/page.tsx`, `_components/HeldMergeChooser.tsx` and `_components/MergeCompare.tsx` onto `Dialog`; the record editor's actions (Archive, …) into `actions` with Save last; `.backdrop`/`.modalPanel` rules removed from `contacts.module.css`; body controls meet `--tap-min`, and body text and fields are at least 1rem (FR-022); tests `tests/component/contacts.page.test.tsx`, `contacts.heldMergeChooser.test.tsx`, `contacts.mergeCompare.test.tsx`, `recordView.test.tsx`, `contacts.duplicatePair.test.tsx`, `contacts.pairActions.test.tsx`
- [X] T024 [US2] Run `pnpm vitest run tests/component tests/unit` (dev server stopped) — T014's guard green, every dialog test green; then, with the dev server running, quickstart §4 on the five named dialogs, and the quickstart §2 script at 390 × 844 in **every one of the 29 dialogs** listed there (empty list each; no field under 16px), recording each result in `baseline.md` (SC-001)

**Checkpoint**: one dialog everywhere; every dialog's bar has Close first and its main action last.

---

## Phase 5: User Story 3 — Actions in one place, Save always bottom right (Priority: P2)

**Goal**: the gate's Save and the gate report's Print sit in pinned action bars clear of the home
indicator; the bar never hides a field being typed in; the printout has no bar.

**Independent test**: quickstart §5; the gate report's print preview shows no bar.

### Tests for User Story 3 (write first, see them fail)

- [X] T025 [P] [US3] In `tests/component/gate.page.test.tsx`, assert the Save is the last control of a pinned "Actions" group; see it fail
- [X] T026 [P] [US3] In `tests/component/treasurer.gateReport.test.tsx`, assert Print is in a pinned "Actions" group, that the group is **not** inside `[data-printable-report]` (so the report's existing print rules leave it off the printout, research R12), and that pressing it calls `window.print` (a spy); see it fail
- [X] T027 [P] [US3] Write the failing `tests/unit/volunteerViewport.test.ts`: the `viewport` exported by `src/app/(admin)/layout.tsx` and `src/app/(door)/layout.tsx` has `interactiveWidget: "resizes-content"` and `viewportFit: "cover"`, and `src/app/layout.tsx` exports none (the public site is untouched, R8)

### Implementation for User Story 3

- [X] T028 [P] [US3] In `src/app/(door)/gate/page.tsx`, replace the `.save` block with `<ActionBar pinned>` holding Save; in `gate.module.css` drop `.save` and set `scroll-padding-block-end` to the bar's height so a field scrolled into view clears it (FR-018); T025 green
- [X] T029 [P] [US3] In `src/app/(admin)/treasurer/page.tsx`, move the Print button into `<ActionBar pinned>` after the `data-printable-report` article (outside it); drop `.printButton` from `treasurer.module.css`; leave the `@media print` block unchanged; T026 green
- [X] T030 [P] [US3] Export `viewport = { interactiveWidget: "resizes-content", viewportFit: "cover" }` (typed `Viewport` from `next`) from `src/app/(admin)/layout.tsx` and `src/app/(door)/layout.tsx`; T027 green
- [X] T031 [US3] With the dev server running, quickstart §5: every dialog's bar order; Booking Central's event dialog at 320px stays on one line with labels wrapping; the gate's Save and the report's Print stay pinned while scrolling; the report's print preview has no bar

**Checkpoint**: every action bar in place.

---

## Phase 6: User Story 4 — Layouts change at the same widths everywhere (Priority: P3)

**Goal**: the converted pages change layout only at `40rem` and `48rem`, never scroll sideways at
the supported sizes, and hold no text under 16px.

**Independent test**: quickstart §3 at every listed size, including 200% text.

### Tests for User Story 4 (write first, see them fail)

- [X] T032 [US4] Add rules 2 and 3 to `tests/unit/volunteerStyle.test.ts` over the full file list in [contracts/style-tokens.md](./contracts/style-tokens.md): only `(min-width: 40rem)`, `(min-width: 48rem)` or `print` media queries; no `font-size` below `1rem`/`16px` and no `var(--fs-sm)`; see it fail on the four `max-width: 22.5rem` rules, the gate report's `52.75rem` and its `0.875rem`

### Implementation for User Story 4

- [X] T033 [P] [US4] Turn the `max-width: 22.5rem` rules mobile-first in `src/app/(door)/checkin/checkin.module.css` (`.actions`: two columns from `40rem`), `src/app/(door)/gate/gate.module.css` (`.fields`) and `src/app/_components/SaleOrCheckDialog.module.css` (`.fields`) — one column is the base, two begin at `@media (min-width: 40rem)`; raise any text under 1rem
- [X] T034 [P] [US4] Same in `src/app/(admin)/payments/payments.module.css` (`.entry`, `.actions`); raise any text under 1rem
- [X] T035 [P] [US4] In `src/app/(admin)/treasurer/treasurer.module.css`, move `max-width: 52.75rem` to mobile-first `@media (min-width: 48rem)` (two columns from there), and remove the 0.875rem shrink (FR-022, R11); the wide tables keep their own scroll inside their frame; `@media print` unchanged
- [X] T036 [US4] Run `pnpm vitest run tests/unit/volunteerStyle.test.ts tests/component` (dev server stopped) — green; then, with it running, quickstart §3 on the four pages and a long dialog at 320, 360, 390 and 430 wide and at 768 × 1024, 820 × 1180 and 1024 × 768, and again at 390 in desktop Chrome with the font size at 200% (quickstart §3): no sideways scroll, nothing clipped, dialogs full screen below 640 and centred from it (SC-005)

**Checkpoint**: every converted page follows the two widths.

---

## Phase 7: Polish & cross-cutting

- [X] T037 [P] Record in `specs/phase-8-requirements/mobile-volunteer-conventions.md` that the building blocks shipped as feature 089 (the token `--tap-min`, the `Dialog` and `ActionBar` components, the two widths) and that the frame and later conversions add their files to the style guard's list — first ask Rich whether the draft goes in this feature's commit (the same question as T041); if not, skip this and carry the note to the volunteer frame feature
- [X] T038 Run the full gates with the dev server stopped: `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`, then `rm -rf .next/dev`
- [X] T039 [P] Run `pnpm exec eslint` and `pnpm exec prettier --check` on the changed code and CSS files only, and `pnpm lint:md`
- [X] T040 Rich, with the Galaxy testers: quickstart §6 on an iPhone (Safari) and a Galaxy (Samsung Internet) through the tunnel — every item on the checklist, including Print on both phones and Android's Back gesture (SC-006); and quickstart §7 — the four workflows complete in the same steps (SC-007)
- [X] T041 Tick this task and T042 **before** committing, then make one atomic commit for the feature — it includes `specs/BACKLOG.md` (B64–B66) and the conventions draft (Rich, 2026-09-30); never amend and force-push a pushed branch merely to mark a step complete
- [X] T042 Push the branch and open the pull request against `main`; its description states that the tests pass, lint and formatting are clean, and the plan's Constitution Check is signed off (constitution, Development Workflow)

---

## Dependencies & execution order

- **Setup (T001)** first — the baseline is taken before anything is resized.
- **Foundational (T002–T004)** blocks everything: every story sizes with the token, and the shell
  renders the bar.
- **US1 (T005–T011)** and **US2's tests and shell (T012–T017)** can proceed in parallel after
  Foundational — different files.
- **US2's migrations (T018–T023)** need the shell (T017). T021 follows T018 (shared Booking Central
  tests). T020 and T022 touch files US1 also edits (`SaleOrCheckDialog.module.css`,
  `checkin.module.css`), so run them after T010 and T006.
- **US3 (T025–T031)** needs the bar (T004); T028 and T029 touch files US1 edits, so after T007 and
  T009.
- **US4 (T032–T036)** after US1 — it edits the same CSS files; T032 extends T005's guard. T033
  also follows T020 and T022, which edit `SaleOrCheckDialog.module.css` and `checkin.module.css`.
- **Polish (T037–T042)** last; T040 and T031/T036's browser passes need the dev server running,
  T038 needs it stopped.

## Parallel opportunities

- Foundational: T003 beside T002.
- US1: T006–T010 together (five separate CSS files).
- US2: T012, T013, T014 together (tests); then T019, T020, T022, T023 together after the shell.
- US3: T025, T026, T027 together; then T028, T029, T030 together.
- US4: T033, T034, T035 together.
- Polish: T037 and T039 together.

## Implementation strategy

**MVP is US1 + US2** — both P1: the controls are easy to hit, and the dialogs are one dialog. US3
then pins the page-level actions and settles the keyboard; US4 makes the widths consistent, which
the later conversions (the frame, Booking Central's cards) build on. The feature lands as one
commit, but each phase ends green and could be demonstrated on its own.

| Phase | Tasks | Story |
|---|---|---|
| 1 — Setup | T001 (1) | — |
| 2 — Foundational | T002–T004 (3) | — |
| 3 — US1 | T005–T011 (7) | US1 |
| 4 — US2 | T012–T024 (13) | US2 |
| 5 — US3 | T025–T031 (7) | US3 |
| 6 — US4 | T032–T036 (5) | US4 |
| 7 — Polish | T037–T042 (6) | — |
