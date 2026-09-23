# Tasks: Everyone can reach their own work

**Feature**: 086-access-signposting | **Branch**: `086-access-signposting`

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/access.md](./contracts/access.md),
[quickstart.md](./quickstart.md)

**Tests**: included — Test-First is a constitution principle, and three of the five stories change
who may do what. Each test below fails today for the reason named beside it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 from [spec.md](./spec.md)

---

## Phase 1: Setup

**Purpose**: no migration, no dependency, nothing to install. One thing only — know what the
capability map says today, so SC-005 can be proved rather than asserted.

- [X] T001 Record the current role → capability map as a fixture in `tests/integration/authz.capabilityMap.test.ts`, asserting it entry by entry so any unintended change fails loudly (SC-005, FR-009)
- [X] T002 Run `pnpm vitest run tests/integration/authz.capabilityMap.test.ts` and confirm it passes against today's code — the baseline must be green before anything moves

**Checkpoint**: the map is pinned. Every later phase that touches it must change this fixture
deliberately.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the one vocabulary change both US2 and the guards depend on. Nothing else blocks.

- [X] T003 Add `"treasurer_report.read"` to the `Capability` union in `src/server/auth/capabilities.ts`, with a comment naming feature 086 and why a read capability exists beside the write one
- [X] T004 Grant `treasurer_report.read` (global) to `financial_secretary`, `treasurer`, `president`, `vice_president` and `super_user` in `src/server/auth/capabilities.ts`, and update the T001 fixture to match — the only sanctioned edit to it
- [X] T005 Run `pnpm tsc --noEmit` and `pnpm vitest run tests/integration/authz.capabilityMap.test.ts`

**Checkpoint**: the capability exists and is held by five roles (the Booker joined them at the
walk-through). Nothing reads it yet.

---

## Phase 3: User Story 1 — The Booker can create the contact a performer needs (P1)

**Goal**: the flow 084 built for the Booker stops refusing them.

**Independent test**: as a Booker, open an unlinked performer, choose to create the contact, and
confirm it exists and the performer is linked — with no refusal.

- [X] T006 [US1] Add failing cases to `tests/integration/authz.boundaries.test.ts` (or a sibling `contacts.bookerAuthz.test.ts`): a Booker may `POST /api/contacts` and `PATCH /api/contacts/{id}`, and is REFUSED `DELETE /api/contacts/{id}` — the first two fail today with 403 (FR-001, FR-002)
- [X] T007 [US1] Add `"contact.write": "global"` to the `booker` role in `src/server/auth/capabilities.ts`, with a comment naming 084's unlinked-performer question as the reason and the Financial Secretary as the precedent
- [X] T008 [US1] Update the capability-map fixture in `tests/integration/authz.capabilityMap.test.ts` for the Booker's new entry — deliberately, as the second and last sanctioned edit
- [X] T009 [US1] Run `pnpm vitest run tests/integration/authz` — T006 green, and the delete refusal still holds

**Checkpoint**: the Booker can create and correct a contact, and still cannot delete one. US1 ships.

---

## Phase 4: User Story 2 — The gate report reaches the people whose work it is (P2)

**Goal**: the Financial Secretary is offered the report; the Door Attendant is refused it.

**Independent test**: as a Financial Secretary, find the report in the menu and read it; as a Door
Attendant, find it absent and be refused when requesting it directly.

- [X] T010 [P] [US2] Add a failing case to `tests/integration/authz.nav.test.ts`: a Financial Secretary IS offered `/treasurer`. Leave the existing Door-Attendant case UNTOUCHED — it asserts the rule this feature keeps (research R2)
- [X] T011 [P] [US2] Add failing cases to `tests/integration/authz.refusal.test.ts` (or a sibling): a Door Attendant is REFUSED `GET /api/events/{id}/treasurer-report`; a Financial Secretary is answered; a Financial Secretary is answered for a series she does not normally report (FR-006c — the fill-in)
- [X] T012 [US2] Change `/treasurer`'s nav entry in `src/server/auth/nav.ts` from `treasurer_report.write` to `treasurer_report.read`
- [X] T013 [US2] Change `GET` in `src/app/api/events/[id]/treasurer-report/route.ts` from `requires: "base"` to `requires: "treasurer_report.read"`, with a comment that the report is NOT scope-asserted because the two Financial Secretaries cover for each other
- [X] T014 [US2] Run `pnpm vitest run tests/integration/treasurer tests/integration/authz` — the six treasurer files must still pass untouched, because the harness signs in as a Super-user (research R7). If any fails, STOP: the harness assumption is wrong and the plan needs revisiting, not the route loosening

**Checkpoint**: the report is reachable by those whose work it is and refused to everyone else. US2
ships.

---

## Phase 5: User Story 3 — The evening list starts where the volunteer works (P3)

**Goal**: the gate report, gate money and payments open on the series the volunteer works in — as a
default that never refuses.

**Independent test**: as a volunteer whose roles name one series, open all three pages and find the
list already narrowed; widen it in one step and open another series' evening without refusal.

- [X] T015 [US3] Add a failing case to `tests/integration/me.capabilities.test.ts`: the self-check reports the series a viewer holds a role for, reports nothing to narrow by for a club-wide holder, and reports both for a volunteer with two series (research R9)
- [X] T016 [US3] Extend `GET /api/me/capabilities` in `src/app/api/me/capabilities/route.ts` to answer with the viewer's series, derived from `ctx.actor.grants` — club-wide (both scope ids null) means "do not narrow". Keep the endpoint's existing comment true: it decides what to OFFER, never what is allowed
- [X] T017 [P] [US3] Add failing component cases in `tests/component/eventSelector.test.tsx`: with one series the filter starts on it; with two or a club-wide grant it starts at "any series"; changing the filter lists another series' evenings (FR-010, FR-011, FR-012)
- [X] T018 [P] [US3] Add a failing component case in `tests/component/eventSelector.test.tsx` for the ordering trap: the automatically chosen evening comes from the NARROWED list, not the full one (FR-010a, research R8a) — this is the case most likely to pass by luck, so assert the chosen event's series explicitly
- [X] T019 [P] [US3] Add a failing component case in `tests/component/eventSelector.test.tsx`: when the viewer's series cannot be fetched, the selector still lists every evening and still chooses one — the default must degrade to today's behaviour, never to no behaviour (U1)
- [X] T020 [US3] Add the opt-in default to `src/app/EventSelector.tsx`: fetch the viewer's series, set the initial `seriesId` when exactly one is named, and **hold the event default until the series are known** so `didDefault` cannot latch onto an unnarrowed list. If that fetch fails or answers nothing, proceed **unnarrowed** and let the event default run — a third request must not be able to leave the selector with no evening chosen
- [X] T021 [US3] Add failing page-level cases in `tests/component/treasurer.page.test.tsx`, `tests/component/gate.page.test.tsx` and `tests/component/payments.page.test.tsx`: for a volunteer whose roles name one series, each page's evening list starts narrowed to it. Without this, the default can ship switched on for NO page and every other test still passes (analysis C1)
- [X] T022 [P] [US3] Turn the default on for the gate report in `src/app/(admin)/treasurer/page.tsx`
- [X] T023 [P] [US3] Turn the default on for gate money in `src/app/(door)/gate/page.tsx`
- [X] T024 [P] [US3] Turn the default on for payments in `src/app/(admin)/payments/page.tsx`
- [X] T025 [US3] Add a component case asserting `src/app/(door)/checkin/page.tsx` is UNCHANGED — its selector still starts at "any series" (FR-013). A shared component makes this the easiest thing to break by accident
- [X] T026 [US3] Run `pnpm vitest run tests/component` — all green

**Checkpoint**: three pages open where the volunteer works; check-in is untouched; nothing refuses.
US3 ships.

---

## Phase 6: User Story 4 — A link to a contact opens that contact (P4)

**Goal**: the link does what it says, and costs no unsaved work.

**Independent test**: open a performer with a contact, type an unsaved change, follow the link, and
find the contact open beside the still-intact form.

- [X] T027 [P] [US4] Add failing component cases in `tests/component/contacts.page.test.tsx`: mounting with a contact named in the address opens that record; with an ARCHIVED contact it opens and shows it is archived; with an unknown one the directory says so and still works (FR-003, FR-004)
- [X] T028 [US4] Read the contact from the address on mount in `src/app/(admin)/contacts/page.tsx` and call the existing `openRecord(id)` — no `useSearchParams`, no Suspense boundary (research R1)
- [X] T029 [US4] Report a contact that cannot be opened in `src/app/(admin)/contacts/page.tsx` — a plain message, with the directory still usable
- [X] T030 [P] [US4] Make the contact link open in a new tab in `src/app/(admin)/manage/performers/PerformerForm.tsx` (`target`/`rel`), so the form keeps its unsaved edits (FR-004a, research R6)
- [X] T031 [US4] Add a component case asserting the performer form still holds an unsaved edit after the link is followed, and run `pnpm vitest run tests/component`

**Checkpoint**: the link opens the contact and costs nothing. US4 ships.

---

## Phase 7: User Story 5 — The access screen tells the truth about series (P5)

**Goal**: an officer can see which series a volunteer's roles cover, and add another without
guessing a key. This is also how the club gives each Financial Secretary the grant US3's default
depends on.

**Independent test**: give one volunteer the same role for two series; both are shown, each naming
its series, and the first is undisturbed.

- [X] T032 [P] [US5] Add a failing case to `tests/integration/authz.grants.test.ts`: a volunteer holding one role at TWO series is reported by `listVolunteers` with both, each naming its series key and name — multi-series as a RULE, not scenery in a clear-and-cascade test (research R4)
- [X] T033 [US5] Extend `listVolunteers` in `src/server/domain/access/grantService.ts` so each grant carries `seriesKey` and `seriesName`, joined from `series`; null for club-wide and group-scoped
- [X] T034 [P] [US5] Add failing component cases in `tests/component/access.page.test.tsx`: a series-scoped role names its series; a club-wide role reads as covering every series; the two are not confused (FR-007)
- [X] T035 [US5] Replace `scopeLabel` in `src/app/(admin)/access/page.tsx` so it names the series rather than returning the bare words "series-scoped" (research R3 — the cause nobody suspected)
- [X] T036 [US5] Add a failing component case in `tests/component/access.page.test.tsx`: the grant form offers the club's real series to choose from, plus an explicit club-wide choice, and no free-text key (FR-008a — implementation without a test, analysis C2)
- [X] T037 [US5] Replace the free-text series-key box in `src/app/(admin)/access/page.tsx` with a picker fed by `GET /api/series`, keeping "club-wide" as an explicit choice (FR-008a)
- [X] T038 [US5] Run `pnpm vitest run tests/integration/authz.grants.test.ts tests/component/access.page.test.tsx`

**Checkpoint**: the screen shows what a volunteer holds and makes a second series an obvious act.
US5 ships.

---

## Phase 8: Polish & Close-out

- [X] T039 Run the full gates with the dev server stopped: `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`
- [X] T040 [P] Run `pnpm exec eslint` and `pnpm exec prettier --check` on the changed code files only, and `pnpm exec markdownlint-cli2 --fix` plus `pnpm lint:md` on the changed markdown
- [X] T041 Confirm the club's grants still give each Financial Secretary exactly one series (Rich scoped them on 2026-09-23: Peggy Dempsey → ecd, PeggyTBD → tnc, both with a matching Booker grant). US3's default is only visible when they do (research R9)
- [X] T042 Walk [quickstart.md](./quickstart.md)'s manual pass: the Booker creating a contact; the report offered to the FS and refused to a Door Attendant; the three pages opening on her series and check-in unchanged; the contact link and its unsaved edit; the access screen naming series
- [X] T043 Tick this task and T044 **before** committing, then make one atomic commit for the feature — never amend and force-push a pushed branch merely to mark a step complete
- [X] T044 Push the branch and open the pull request against `main`

---

## Dependencies

```text
Phase 1 (pin the map) → Phase 2 (the capability exists)
                          ├→ Phase 3  US1  Booker + contact.write
                          ├→ Phase 4  US2  the report's reach
                          ├→ Phase 5  US3  the series default ─┐
                          ├→ Phase 6  US4  the contact link    │
                          └→ Phase 7  US5  the access screen ──┘→ Phase 8
```

- **Phase 1 blocks everything.** The capability map must be pinned before a feature that changes it
  twice; otherwise SC-005 is an assertion rather than a proof.
- **Phase 2 blocks US2 only** in principle, but it is cheap and shared, so it runs first.
- **US1, US2, US3, US4 and US5 are independent of each other** and may be done in any order or in
  parallel. Only two touch the same file (`capabilities.ts`, in Phases 2 and 3), and they are
  sequential.
- **US5 enables T041**, which is what makes US3 visible in the club's own data — a sequencing point
  that is about data, not code.
- Within US3, T015–T016 (the server's answer) precede T020 (the component that consumes it), which
  in turn precedes T022–T024 (the three pages that switch it on).

## Parallel opportunities

- **US2**: T010 and T011 are separate test files.
- **US3**: T017–T019 (component tests) alongside T015 (integration); T022–T024 are three one-line
  page changes in three files.
- **US4**: T027 and T030 touch different files.
- **US5**: T032 and T034 are separate test files.
- **Across stories**: US1, US4 and US5 share no files and could be done by three people at once.

## Implementation strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1).** That alone removes the only hard stop: a Booker offered
a choice the app refuses to carry out.

**Then US2**, because a report readable by every volunteer is the defect with the widest blast
radius, and **US3** next, because it is the club's actual daily friction.

**The two ways to ship this looking right and being wrong**:

1. **Phase 4 without T014.** The six treasurer test files pass today because the harness is a
   Super-user. If tightening the route breaks them, the tempting repair — loosening the route —
   silently undoes the feature.
2. **Phase 5 without T018 or T021.** The event default latches behind a ref as soon as events load.
   Set the series filter a moment too late and the volunteer lands on another series' evening, with
   the filter showing hers. The test must assert the chosen evening's series, not merely that a
   filter was set.

## Task count

| Phase | Tasks | Story |
|---|---|---|
| 1 — Setup | T001–T002 (2) | — |
| 2 — Foundational | T003–T005 (3) | — |
| 3 — Booker's contact | T006–T009 (4) | US1 |
| 4 — The report's reach | T010–T014 (5) | US2 |
| 5 — The series default | T015–T026 (12) | US3 |
| 6 — The contact link | T027–T031 (5) | US4 |
| 7 — The access screen | T032–T038 (7) | US5 |
| 8 — Polish | T039–T044 (6) | — |
| **Total** | **44** | |
