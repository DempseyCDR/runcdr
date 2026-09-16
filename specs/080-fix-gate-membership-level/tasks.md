---
description: "Task list for feature 080 — gate membership-level fix"
---

# Tasks: Gate membership-level fix

**Input**: Design documents from `/specs/080-fix-gate-membership-level/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/gate-save.md](./contracts/gate-save.md)

**Tests are NOT optional here.** Constitution Principle I (Test-First) is NON-NEGOTIABLE: every behaviour
lands as a failing test before its implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: may run in parallel (different files, no dependency on an incomplete task)
- **[US1]** etc.: the user story the task serves

## Path Conventions

Single Next.js app. The gate page is `src/app/(door)/gate/page.tsx`; component tests under
`tests/component/`, integration tests under `tests/integration/`. The gate component tests stub `fetch`
the way `tests/component/gate.reload.test.tsx` does, including the breakdown stub from
`tests/component/fixtures/attendanceBreakdown.ts`.

**No server change** (research R1). No migration.

---

## Phase 1: Setup

- [X] T001 Create `src/app/membershipLevels.ts`: `export const MEMBERSHIP_LEVELS = ["individual", "family", "supporter", "student"] as const`, `satisfies readonly MembershipLevel[]` using `import type { MembershipLevel } from "@/server/db/schema/enums"`, plus a compile-time assertion that every `MembershipLevel` is in the list (e.g. `type _Missing = Exclude<MembershipLevel, (typeof MEMBERSHIP_LEVELS)[number]>` asserted to be `never`), and `export const MEMBERSHIP_LEVEL_LABELS: Record<MembershipLevel, string>` (Individual, Family, Supporter, Student). Type-only import — no schema values reach the client bundle (research R2)
- [X] T002 [P] Replace the local `LEVELS` constant in `src/app/(admin)/contacts/_components/MembershipAccount.tsx` with `MEMBERSHIP_LEVELS` from `@/app/membershipLevels`; behaviour unchanged (its existing component tests still pass)

---

## Phase 2: Foundational

**Purpose**: bring the existing fixtures in line with the rule that a membership line always has a level, so
they stay valid once the page guards the save.

- [X] T003 [P] In `tests/integration/doorRecord.reload.test.ts`, give the membership line `membershipLevel: "family"` and assert the reloaded membership sale has `membershipLevel === "family"` (FR-005, server half). Expected to pass at once — the service already returns it (research R1)
- [X] T004 [P] In `tests/component/gate.reload.test.tsx`, add `membershipLevel: "family"` to the SAVED membership sale, and add `membershipLevel: "family"` to the `objectContaining` expectation for the PUT's membership line. The level assertion fails until T010 (the page sends the level from T008 and reloads it from T010)

**Checkpoint**: fixtures reflect the 068 rule.

---

## Phase 3: User Story 1 — Record a membership bought at the gate (Priority: P1) 🎯 MVP

**Goal**: a membership sale can be given a level and saved; the membership is recorded at that level.

**Independent Test**: add a membership line, choose a level, save; the PUT carries the level and the page
says the membership was recorded.

### Tests for User Story 1 (write first, confirm they fail)

- [X] T005 [US1] Create `tests/component/gate.membershipLevel.test.tsx` with a `fetch` stub (reload payload with no sales; search returning the candidate whose name matches the query — "Jane Doe" or "Ann Able"; PUT returning `{ enrolled: [{ contactId, displayName: "Jane Doe", expiryDate: "2027-08-31" }] }`; PATCH returning `{ deposit: 0 }`) that records calls. Tests, under `describe("US1 …")`:
  - adding a **membership** line for Jane Doe shows a combobox named "Level for Jane Doe" whose options are an empty "Level…" then Individual, Family, Supporter, Student, with the empty option selected (FR-001; contract)
  - adding a **donation** line and a **future_event** line shows no level combobox for them (FR-002)
  - choosing Family, entering amount 40 and saving sends a PUT whose membership line has `membershipLevel: "family"`, and — with a donation line for Jane Doe (amount 10) saved alongside it — the donation line has no `membershipLevel` key (FR-003)
  - after that save the page shows "Saved. Membership recorded: Jane Doe (through 2027-08-31)" (FR-004 as the page shows it; the renewal itself is covered by `tests/integration/gate.membershipLevel.test.ts`)

### Implementation for User Story 1

- [X] T006 [US1] In `src/app/(door)/gate/page.tsx`: add `membershipLevel: MembershipLevel | ""` and `levelMissing: boolean` to `NamedLine` (type-only import); `addNamedLine` sets them to `""` and `false`, and the reload in `openDoorRecord` sets `""` and `false` for now so the page compiles (T010 fills the level)
- [X] T007 [US1] In `src/app/(door)/gate/page.tsx`: on each named line whose category is `membership`, render a `<select>` whose `aria-label` is "Level for {contactName}", with an empty option "Level…" then `MEMBERSHIP_LEVELS` labelled from `MEMBERSHIP_LEVEL_LABELS`; its `onChange` → `setNamedField(i, { membershipLevel })`. Render nothing for other categories
- [X] T008 [US1] In `save()` in `src/app/(door)/gate/page.tsx`: include `membershipLevel` on a sent line only when `category === "membership"` (and the level is set). Run T005 — the US1 tests pass

**Checkpoint**: US1 is shippable on its own — a membership bought at the gate can be recorded.

---

## Phase 4: User Story 2 — A saved membership sale shows its level again (Priority: P1)

**Goal**: reopening an evening shows each membership sale's level, and saving again keeps it.

**Independent Test**: reload an evening with a Family membership sale; the level shows Family; change gross
cash and save; the PUT still carries Family.

### Tests for User Story 2 (write first, confirm they fail)

- [X] T009 [US2] In `tests/component/gate.reload.test.tsx` (fixture from T004), add assertions to the first test: after the event is chosen, the combobox "Level for Jane Doe" has value `family`; and the existing PUT expectation (with `membershipLevel: "family"`) holds. Add a second step or test: change gross cash, save again, and the second PUT's membership line still has `membershipLevel: "family"` (FR-005, SC-003)

### Implementation for User Story 2

- [X] T010 [US2] In `openDoorRecord` in `src/app/(door)/gate/page.tsx`: add `membershipLevel: MembershipLevel | null` to the reloaded sale's type and set each rebuilt line's `membershipLevel` to `s.category === "membership" ? (s.membershipLevel ?? "") : ""`. Run T009 — passes

**Checkpoint**: US1 + US2 — the whole evening round-trips with its levels.

---

## Phase 5: User Story 3 — Mary is told when a save does not go through (Priority: P2)

**Goal**: a missing level stops the save and names the sale; every refusal shows its reason and says what was
not saved.

**Independent Test**: save with a membership line lacking a level — no request, the line is marked, the
message names Jane Doe; then refusals from each step produce their messages.

### Tests for User Story 3 (write first, confirm they fail)

- [X] T011 [US3] In `tests/component/gate.membershipLevel.test.tsx`, under `describe("US3 …")`, let the stub take per-test overrides for the PUT and PATCH responses (status, body, or a thrown error). Tests, with messages exactly as in [contracts/gate-save.md](./contracts/gate-save.md):
  - **guard**: a membership line with amount 40 and no level → Save makes **no** PUT and **no** PATCH; the "Level for Jane Doe" combobox has `aria-invalid="true"`; the page shows "Choose a level for Jane Doe's membership. Nothing was saved."; choosing a level clears `aria-invalid`, and Save then sends the PUT (FR-006)
  - **mark follows the sale**: with two membership lines (Ann Able above Jane Doe), only Jane's lacking a level, Save marks Jane's; removing Ann's line leaves Jane's still marked and Ann's gone (analysis U1)
  - **guard scope**: a membership line with **no amount** and no level does not block the save, and is not sent (research R5)
  - **sales refused**: PUT → 422 `{ error: { code: "VALIDATION_ERROR", message: "membership lines require a membershipLevel" } }` → no PATCH; page shows "Nothing was saved: membership lines require a membershipLevel" (FR-007, FR-008)
  - **sales refused, no message**: PUT → 500 with a body that is not JSON → "Nothing was saved: the server refused it (500)"
  - **money refused**: PUT 200 with one enrolled, PATCH → 422 `{ error: { message: "Number must be greater than or equal to 0" } }` → page shows "Sales saved, but the money figures were not: Number must be greater than or equal to 0" and also "Membership recorded: Jane Doe (through 2027-08-31)"; no deposit is shown (FR-008)
  - **unreachable**: PUT `fetch` rejects → "Nothing was saved: Could not reach the server"; PUT 200 then PATCH rejects → "Sales saved, but the money figures were not: Could not reach the server"
  - **403 unchanged**: PUT → 403 → "Only the Financial Secretary may record gate money for this event." (spec edge case)
  - **success unchanged**: with no membership line, Save → "Saved" (SC-004)

### Implementation for User Story 3

- [X] T012 [US3] In `src/app/(door)/gate/page.tsx`: at the start of `save()`, before any request, find membership lines with `Number(amount) > 0` and `membershipLevel === ""`; if any, set `levelMissing: true` on those lines (a per-line flag, not a set of positions — removing a line must not move a mark), set the message "Choose a level for {name}'s membership. Nothing was saved." for one line, or "Choose a level for each membership: {names, comma-separated}. Nothing was saved." for several, and return. Choosing a level on a line sets its `levelMissing` to `false`. The select gets `aria-invalid={l.levelMissing || undefined}`
- [X] T013 [US3] In `src/app/(door)/gate/page.tsx`: add a small local helper `reasonOf(res: Response): Promise<string>` returning `body.error.message` or `` `the server refused it (${res.status})` ``, and wrap each `apiFetch` in try/catch mapping a thrown error to the reason "Could not reach the server". Replace "Gate sales failed" with `Nothing was saved: ${reason}` (403 branch unchanged). Replace the PATCH failure with `Sales saved, but the money figures were not: ${reason}`, appending `Membership recorded: ${who}` when `enrolled` is non-empty (the same `who` string the success path builds; factor it out). Run T011 — passes

**Checkpoint**: all three stories pass.

---

## Phase 6: Polish & Cross-Cutting

- [X] T014 Run the automated gates in [quickstart.md](./quickstart.md) with no dev server running: `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm lint:md`, and eslint + prettier on the changed files only. Record the result (date, test and file counts) under a new **Verification** section in [plan.md](./plan.md)
- [X] T015 Manual pass: Rich walks [quickstart.md](./quickstart.md) §1–§6 on his dev server and runs the cleanup; record the outcome in [plan.md](./plan.md) **Verification**
- [X] T016 [P] Update `specs/phase-8-requirements/mary-fs-payments.md`: mark MARY-R5 delivered by 080. Then `pnpm exec markdownlint-cli2 --fix` on it and `pnpm lint:md`

---

## Dependencies & Execution Order

- **Setup (T001–T002)** first; T002 depends on T001.
- **Foundational (T003–T004)** after T001; independent of each other.
- **US1 (T005–T008)** after T001. T005 before T006–T008; T006 → T007 → T008 (same file).
- **US2 (T009–T010)** after US1 (T010 fills the field T006 adds; T009 needs the select from T007).
- **US3 (T011–T013)** after US1 (the guard needs the level field and select). T011 before T012–T013;
  T012 → T013 (same file).
- **Polish (T014–T016)** last; T015 after T014.

All implementation tasks touch `src/app/(door)/gate/page.tsx`, so they run in sequence.

### Parallel opportunities

```text
After T001:  T002  |  T003  |  T004  |  T005
Polish:      T016 alongside T014
```

## Implementation Strategy

- **MVP = Phase 1–3 (US1)**: membership sales can be saved at all — the defect found in 079's manual pass.
- **Then US2**, which is required before shipping: without it, any later correction to a saved evening fails
  (the reloaded line has no level) — so US1 and US2 ship together.
- **Then US3**: clear messages and the guard.
- One atomic commit for the feature, one PR.
