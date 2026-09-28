# Tasks: The community dance series key becomes `cdob`

**Input**: Design documents from `specs/088-cdob-rename/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/series-key.md](./contracts/series-key.md),
[quickstart.md](./quickstart.md)

**Tests**: required — Principle I (Test-First) is non-negotiable. Each story's tests are written and
seen to fail for the right reason before its implementation.

**Organization**: by user story. US1 and US2 are both P1; US2's rules depend on US1's data change,
because the rules match on the key the data carries.

**⚠️ The dev server must be stopped** for every task that migrates or runs integration tests.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1, US2, US3 from spec.md

---

## Phase 1: Setup

**Purpose**: record what must not change, before anything changes.

- [X] T001 With the dev server stopped, capture the baseline in `specs/088-cdob-rename/baseline.md`: each series' key and dance count (quickstart §Before query), and Thursday Night Contra's organizer report figures for the current and the last full year — the numbers SC-002 and SC-003 are checked against

---

## Phase 2: Foundational (blocks every story)

**Purpose**: the one typed list of series keys (research R1, backlog B48) that every later task
takes the key from.

- [X] T002 [P] Write the failing unit test `tests/unit/seriesKeys.test.ts`: the list holds exactly `tnc`, `ecd`, `cdob`, `general`, and names the community dance `cdob`
- [X] T003 Create `src/server/domain/series/seriesKeys.ts` — `SERIES_KEYS` (constants only, so client components may import it) and the `SeriesKey` type; T002 goes green

**Checkpoint**: the key list exists; nothing uses it yet.

---

## Phase 3: User Story 1 — The community dance is known as `cdob` (Priority: P1) 🎯 MVP

**Goal**: the series' key is `cdob` in the data, the seed and the code; `community_dance` identifies
nothing.

**Independent test**: look the series up by `cdob` and find "Community Dance"; by
`community_dance`, nothing; `/organizer/cdob` answers, `/organizer/community_dance` is not found.

### Tests for User Story 1 (write first, see them fail)

- [X] T004 [P] [US1] Write the guard `tests/unit/noOldSeriesKey.test.ts`: scan every file under `src/` except `src/server/db/migrations/` and fail on the text `community_dance` (research R5 — catches string comparisons that would compile but never match); see it fail listing today's files
- [X] T005 [P] [US1] Write `tests/integration/series.cdobKey.test.ts`: (a) after migrating, the series with key `cdob` is named "Community Dance" and wants no sound tech; no series has key `community_dance`; the data holds exactly the keys `tnc`, `ecd`, `cdob`, `general` — four series, never a fifth (research R3, FR-009); (b) rehearse the real path: give the migrated `cdob` row back its old key `community_dance` with dances attached, apply `0060`'s statement, and assert the same id, the key `cdob`, and every dance still attached (FR-005) — the key is unique, so the rehearsal must reuse this row rather than add a second one; (c) `GET /api/organizer/cdob/report` answers 200 and `GET /api/organizer/community_dance/report` answers 404 (FR-007); see it fail

### Implementation for User Story 1

- [X] T006 [US1] Add `src/server/db/migrations/0060_cdob_series_key.sql`: `UPDATE series SET key = 'cdob' WHERE key = 'community_dance'`, with a header comment giving the meaning ("Community Dance / Open Band"), why only one row changes (research R2), and that it is idempotent
- [X] T007 [US1] Change `src/server/db/seed.ts` to create the community dance with `SERIES_KEYS` — key `cdob`, name "Community Dance", no sound tech
- [X] T008 [US1] Change `tests/integration/helpers/db.ts` to insert the four series from `SERIES_KEYS` — required, not tidying: with the old key the `ON CONFLICT` insert would add a fifth series (research R3)
- [X] T009 [US1] With the dev server stopped, run `pnpm db:migrate` and `pnpm vitest run tests/unit/seriesKeys.test.ts tests/integration/series.cdobKey.test.ts` — green; the guard (T004) stays red until US2 and US3 are done

**Checkpoint**: the data and the seed say `cdob`.

---

## Phase 4: User Story 2 — Everything true of the community dance stays true (Priority: P1)

**Goal**: every rule that singles out the community dance applies to `cdob`, and only to it.

**Independent test**: open band accepted at a community dance and refused elsewhere; the TNC
organizer report counts the community dance with the baseline's figures; no sound-tech slot.

### Tests for User Story 2 (move to the new key first, see them fail)

Between T008 and these tasks, every test file that still names `community_dance` fails for the
wrong reason — its fixture cannot find the series. That is expected; the meaningful red is the one
seen after each file is moved to `cdob`, when the rule under test is what fails.

- [X] T010 [P] [US2] Move the rule tests to `SERIES_KEYS.cdob` in `tests/integration/checkin.openBand.test.ts`, `attendance.breakdown.test.ts`, `attendance.corrections.test.ts`, `door.record-create.test.ts` and `tests/component/checkin.page.test.tsx`; see the open-band cases fail (the code still compares against the old key)
- [X] T011 [P] [US2] Move `tests/integration/organizer.report.test.ts`, `treasurer.report.test.ts` and `treasurer.same-evening.test.ts` to `SERIES_KEYS.cdob`; see the TNC-pairing cases fail
- [X] T012 [P] [US2] Move `tests/integration/bookings.sound-tech.test.ts`, `bookingsReport.booker.test.ts`, `events.list.test.ts`, `events.roles.test.ts`, `payments.addSettlementPerformer.test.ts` and `seriesParameters.isolation.test.ts` to `SERIES_KEYS.cdob`

### Implementation for User Story 2

- [X] T013 [US2] Take the open-band rule's key from `SERIES_KEYS.cdob` at all three sites in `src/server/domain/attendance/attendanceService.ts`
- [X] T014 [US2] Take the community dance from `SERIES_KEYS.cdob` in `src/app/(door)/checkin/page.tsx`
- [X] T015 [US2] Make Thursday Night Contra's report include `SERIES_KEYS.cdob` in `includedKeys` in `src/server/domain/organizer/reportService.ts`
- [X] T016 [P] [US2] Update the comments that name the series in `src/server/db/schema/attendance.ts`, `src/server/db/schema/door.ts` and `src/server/domain/bookings/reportService.ts`
- [X] T017 [US2] Run `pnpm vitest run tests/integration tests/component/checkin.page.test.tsx` with the dev server stopped — green

**Checkpoint**: every community-dance rule answers to `cdob`.

---

## Phase 5: User Story 3 — The public site looks exactly as it did (Priority: P2)

**Goal**: community dances keep their colour, photo, landing section and "CD" code.

**Independent test**: a community dance's event page, What's On, the landing page and the printable
calendar are unchanged; the maps cover every series or the type check fails.

### Tests for User Story 3 (move to the new key first, see them fail)

- [X] T018 [P] [US3] Move `tests/unit/seriesColor.test.ts`, `seriesHero.test.ts` and `styleLanding.test.ts` to `SERIES_KEYS.cdob`, asserting the same results as before — colour "special", the same landing section — and the photo at its renamed path `/series/cdob.jpg`; see them fail
- [X] T019 [P] [US3] Move `tests/integration/publicSchedule.test.ts` and `printableCalendar.test.ts` to `SERIES_KEYS.cdob`, asserting the calendar code is still "CD"; see them fail

### Implementation for User Story 3

- [X] T020 [P] [US3] Make `src/app/(public)/_components/seriesColor.ts` a `Record<SeriesKey, EventType>` keyed from `SERIES_KEYS` (research R1 — a missing series becomes a type error)
- [X] T021 [P] [US3] Rename the photo with `git mv public/series/community_dance.jpg public/series/cdob.jpg`, and make `src/app/(public)/_components/seriesHero.ts` a `Record<SeriesKey, string>` pointing the community dance at `/series/cdob.jpg` (research R4)
- [X] T022 [P] [US3] Key the community dance section of `src/app/(public)/dances/landingContent.ts` by `SERIES_KEYS.cdob`, and update its `seriesKey` comment
- [X] T023 [P] [US3] Key `SERIES_SHORT` in `src/server/domain/public/printableCalendar.ts` by `SERIES_KEYS`; the community dance keeps "CD"
- [X] T024 [US3] Run `pnpm vitest run tests/unit tests/integration/publicSchedule.test.ts tests/integration/printableCalendar.test.ts` — green, and the guard (T004) is now green

**Checkpoint**: nothing in `src/` outside the migrations names `community_dance`.

---

## Phase 6: Polish & cross-cutting

- [X] T025 [P] Give the new key and its meaning, "Community Dance / Open Band", in `docs/use-cases.md` and `specs/DATA_MODEL.md` (FR-008); leave historical specs as written (research R4)
- [X] T026 [P] Mark **B48** done with this feature number in `specs/BACKLOG.md`
- [X] T027 Run the full gates with the dev server stopped: `pnpm db:migrate`, `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`, then `rm -rf .next/dev`
- [X] T028 [P] Run `pnpm exec eslint` and `pnpm exec prettier --check` on the changed code files only, and `pnpm lint:md`
- [X] T029 Walk the quickstart's **After** section in the running app and compare with `specs/088-cdob-rename/baseline.md`: same dance count, same TNC organizer figures, open band, no sound tech, the public pages unchanged
- [X] T030 Tick this task and T031 **before** committing, then make one atomic commit for the feature — never amend and force-push a pushed branch merely to mark a step complete
- [X] T031 Push the branch and open the pull request against `main`

---

## Dependencies & execution order

- **Setup (T001)** first — the baseline must be taken before the migration runs.
- **Foundational (T002–T003)** blocks everything: every later task takes the key from the list.
- **US1 (T004–T009)** before US2: the rules match on the key the data carries, so US2's tests only
  fail for the right reason once the data says `cdob`.
- **US2 (T010–T017)** and **US3 (T018–T024)** can proceed in parallel after US1 — different files.
- **The guard (T004)** is written in US1 and turns green only when US2 and US3 are both done.
- **Polish (T025–T031)** last; T029 needs the dev server running, T027 needs it stopped.

## Parallel opportunities

- T002 alone in Phase 2; T004 and T005 together in US1.
- US2: T010, T011, T012 together (tests), then T016 beside T013–T015.
- US3: T018 and T019 together (tests), then T020–T023 together (four separate files).
- Polish: T025, T026, T028 together.

## Implementation strategy

**MVP is US1 + US2** — both P1, and neither is safe alone: US1 renames the key, and US2 is what
keeps the rename from switching a rule off. US3 then proves the public site did not move. The whole
feature is small enough to land as one commit.

| Phase | Tasks | Story |
|---|---|---|
| 1 — Setup | T001 (1) | — |
| 2 — Foundational | T002–T003 (2) | — |
| 3 — US1 | T004–T009 (6) | US1 |
| 4 — US2 | T010–T017 (8) | US2 |
| 5 — US3 | T018–T024 (7) | US3 |
| 6 — Polish | T025–T031 (7) | — |
