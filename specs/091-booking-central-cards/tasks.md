# Tasks: Booking Central on a phone

**Input**: Design documents from `specs/091-booking-central-cards/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: required — Principle I (Test-First) is non-negotiable. Each story's tests are written and
seen to fail for the right reason before its implementation.

**Organization**: by user story. The extraction of a dance's parts (research R4) is Foundational:
the row, the card (US1) and the opened dance (US1) all render from it.

**⚠️ The dev server must be stopped** for every task that runs the integration tests or the build.

**Markdown**: the hook fixes each `.md` written with Write or Edit; `pnpm lint:md` and the
100-column check run once, before the commit (T027).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task serves (US1, US2, US3)

---

## Phase 1: Setup

- [X] T001 *(Done as: `answerReport` and `setWidth` in the fixture — the page treats a missing `matchMedia` as wide, so tests with their own stubs need nothing; the `scrollIntoView` stand-in went into `tests/setup.dom.ts`, which every component test loads, since two hub tests stub `fetch` themselves.)* In `tests/component/fixtures/bookingCentral.ts`, make the stubbed `/api/bookings/report` answer by `direction` and `split` as contracts/report-api.md describes (`newer`: dates on or after `split`, nearest first; `older`: dates before `split`, newest first; each continued by an opaque cursor), keeping today's answer when neither is sent; add a `matchMedia` stub whose `(min-width: 48rem)` answer a test can set, defaulting to **wide** so every existing Booking Central test still sees the table; and stub `Element.prototype.scrollIntoView` (jsdom lacks it), recording its calls, so every Booking Central test survives the opening scroll T017 adds. Run `pnpm vitest run tests/component/bookingCentral` — green, unchanged

---

## Phase 2: Foundational

- [X] T002 Extract a dance's parts from `src/app/(admin)/bookings/HubRow.tsx` into `src/app/(admin)/bookings/danceParts.tsx` (research R4): one function from `(row, actions?)` to the title, the venue, the caller cell's contents, the music cell's contents, the sound cell's contents (or none where the series wants no sound tech) and the notes, keeping `State`, `Gap`, `Add` and `Name` with it. `HubRow` renders the parts exactly as it does today. A pure refactor: `pnpm vitest run tests/component/bookingCentral` — green with no test changed

**Checkpoint**: the parts exist; every story can render from them.

---

## Phase 3: User Story 1 — The dances as cards on a phone (Priority: P1) 🎯 MVP

**Goal**: below 48rem each dance is a card; a tap opens the dance with everything its row offers.

**Independent test**: at 320 and 390 px as the Booker — cards, no sideways scroll, a card opens a
dance that offers what its row does (quickstart §4).

### Tests for User Story 1 (write first; they must fail)

- [X] T003 [P] [US1] Create `tests/component/bookingCentral.cards.test.tsx` (contracts/page.md C1–C3, T1): with the fixture's `matchMedia` set narrow, the page shows a list named "Dances" with one card per dance, newest first, and no table; a card shows the date, series, label (the series when there is none), caller and band or musicians, each name with its state letter **as text**, the gap marks as marks, and "Cancelled" in words; each card has exactly one button, named by its date, series and label; clicking a card's letter sends no PATCH. Set wide, and the table is shown as today
- [X] T004 [P] [US1] Create `tests/component/bookingCentral.danceView.test.tsx` (D1–D6): narrow; activating a card opens a dialog headed by the dance, with sections Venue, Caller, Music, Sound (absent for a series with no sound tech) and Notes; a state letter advances (PATCH, and the card shows the new letter); a gap mark opens the booking editor **on top** of the dance; "Edit dance" opens the event form ("View dance" for a reader); Close, and Escape, each close it and return focus to the card's button (the phone's Back is the shared dialog's, proved by feature 089's tests); a volunteer who may not book sees names, letters and gap marks as text and no **+**
- [X] T005 [P] [US1] Add `(admin)/bookings/hub.module.css` to the converted stylesheets in `tests/unit/volunteerStyle.test.ts` and run it — record what fails (it was written before feature 089's rules)

### Implementation for User Story 1

- [X] T006 [US1] In `src/app/(admin)/bookings/page.tsx`, read `(min-width: 48rem)` with `useSyncExternalStore` (server snapshot: wide) and render **either** the table **or** the cards from the same `rows` (research R6); hold the opened dance as an event id and find its row in `rows`, so a refresh updates it
- [X] T007 [P] [US1] Create `src/app/(admin)/bookings/HubCard.tsx` (research R5): an `<li>` built from `danceParts(row)` **without** actions, its heading one `<button>` naming the dance, stretched over the card; T003 green
- [X] T008 [US1] Create `src/app/(admin)/bookings/DanceView.tsx`: the shared `Dialog` headed by the dance, holding `danceParts(row, actions)` under the section headings and an "Edit dance" / "View dance" button calling `actions.openEvent`; wire it from the card's button in `page.tsx`, the booking, band, venue and event editors opening on top as from the table; T004 green
- [X] T009 [US1] Style the cards and the opened dance in `src/app/(admin)/bookings/hub.module.css`, phone first: no sideways scroll from 320 px, every control at `--tap-min`, nothing only on hover, the stretched button's focus ring visible; fix what T005 found; T005 green
- [X] T010 [US1] Run `pnpm vitest run tests/unit tests/component` — green; then quickstart §4's cards and opened dance in the browser at 320 × 640 and 390 × 844 (not yet the Performers button, which is US3)

**Checkpoint**: Booking Central is usable on a phone.

---

## Phase 4: User Story 2 — Opening on the next dance, and scrolling both ways (Priority: P1)

**Goal**: the read pages both ways from today; the page opens with the first dance dated today or
later last in view, loads later dances above without a jump and older ones below.

**Independent test**: at a phone width and a computer width, the next dance is last in view on
opening; scrolling up and down each keep loading; no date control (quickstart §3).

### Tests for User Story 2 (write first; they must fail)

- [X] T011 [P] [US2] In `tests/integration/bookings.report.test.ts`, add the guarantees A1–A6 of contracts/report-api.md: page `newer` and `older` from a split to their ends with `limit: 2` and show each lists its side exactly once in its order, and that together they list every dance once — seed several dances on one day, two sharing a date **and** a start time, and an untimed one; the first `newer` row is the first dance dated on or after the split, else the first `older` row is the most recent; `series` narrows both ways; and, through the route, `horizon` is ignored while a bad `split`, `direction`, `limit` or cursor answers 422 (the project's `VALIDATION_ERROR`). Move **every** existing use of `horizon` in the file onto `split`/`direction` — the test "narrows to a series and stops at the horizon" (line 54) and the three reads at lines 199, 222 and 235 — since T015 removes `horizon` from the filter type
- [X] T012 [P] [US2] Confirm `tests/integration/bookingsReport.booker.test.ts` passes no `horizon` (it reads with no split or direction) and leave it unchanged: after T016 it must stay green, proving a read with neither parameter still answers every dance, newest first — `older` is the default
- [X] T013 [P] [US2] Create `tests/component/bookingCentral.scroll.test.tsx` (P2–P7): on opening the page asks for `direction=newer&split=<today>` and `direction=older&split=<today>` (today from `localToday`); it scrolls the default dance into view with `block: "end"` (stub `scrollIntoView`), at both widths; the top loads the next `newer` page only after that; "Show later dances" and "Show earlier dances" each load their way and give way to "No later dances" / "No earlier dances"; with no dances, one line and no loading; after a save, both spans are re-read; and when the width crosses 48rem (flip the fixture's `matchMedia` and fire its change), the page switches between cards and table and scrolls the dance that was last in view back into view (`block: "end"`), not the default dance. In `tests/component/bookingCentral.table.test.tsx`, delete the two horizon tests (the four-months default, FR-001a; pushing the horizon, T019) — retired by FR-010 — and assert there is no "Showing dances from" control

### Implementation for User Story 2

- [X] T014 [US2] Create `src/server/validation/bookings.ts` with the report's query schema (research R8): `series`, `split` (`YYYY-MM-DD`), `direction` (`older` | `newer`, default `older`), `cursor`, `limit` (1–200)
- [X] T015 [US2] In `src/server/domain/bookings/reportService.ts`, add `split` and `direction` and retire `horizon` (research R1): `newer` reads `event_date >= split` in the exact reverse order (`asc`, `start_time asc nulls first`, `id asc`), continued by a `beforeCursor` written beside `afterCursor`; `older` reads `event_date < split`; a cursor that does not decode throws a typed error; T011's service cases green
- [X] T016 [US2] In `src/app/api/bookings/report/route.ts`, validate the query with T014's schema and pass `split` and `direction`; answer 422 for a bad query or cursor, and confirm the 422 is logged with its status by `withAuth`'s request logging (Principle IV — no new logger); T011 and T012 green
- [X] T017 [US2] In `src/app/(admin)/bookings/page.tsx`, replace the one-way load (research R2, R3, R9): hold `split` (today, fixed at opening), `newer` and `older` rows with their cursors, and `positioned`; fetch the two first pages in parallel — the `newer` page with a limit of 10 (spec FR-007's "about ten"), the `older` page with 40, and 20 for each later `newer` load; scroll the default dance into view (`block: "end"`) once both have rendered; a top sentinel and "Show later dances" load `newer` pages — only once positioned — keeping what is in view where it is (note the top dance in view and where it stands before adding, and scroll by how far it moved in a layout effect — research R3); the foot keeps loading `older`; show the end lines; refresh re-reads both spans; when the width crosses 48rem, note the dance last in view before the switch and scroll it into view (`block: "end"`) after it (research R6, contracts X1); remove the "Showing dances from" control. Each dance in the table becomes its own `<tbody>`; the list sets `overflow-anchor: none` in `hub.module.css`; T013 green
- [X] T018 [US2] Run `pnpm vitest run tests/unit tests/component` and, with the dev server stopped, the two report integration files — green; then quickstart §2, §3 and §5 in the browser

**Checkpoint**: the hub opens where the Booker's work is, at every width.

---

## Phase 5: User Story 3 — One title, and the performers in reach (Priority: P2)

**Goal**: one title line at every width; on a phone a Performers button holds the search and the
needs-a-contact list.

**Independent test**: phone width — the title and Performers above the cards, and the button opens
both; computer width — the search and the prompt in view (quickstart §4).

### Tests for User Story 3 (write first; they must fail)

- [X] T019 [P] [US3] Create `tests/component/bookingCentral.performers.test.tsx` (P1, C4, C5, T2): at both widths the page's heading is "Booking Central — {series name}" for a viewer with one series and "Booking Central — All series" otherwise, with no second series heading; narrow, only the heading and a **Performers** button precede the cards, and the button opens a dialog headed "Performers" holding the search and, when there are any, the performers who need a contact — opening a performer from it opens the performer's dialog on top; wide, the search and the "N performers need a contact" prompt are above the table. In `tests/component/bookingCentral.table.test.tsx`, move "names the series at the head of the table" onto the one-line title

### Implementation for User Story 3

- [X] T020 [US3] Extract the needs-a-contact list from its dialog in `src/app/(admin)/bookings/page.tsx` into `src/app/(admin)/bookings/NeedingContactList.tsx` (research R7); the computer's dialog uses it; `tests/component/bookingCentral.needContact.test.tsx` stays green
- [X] T021 [US3] In `src/app/(admin)/bookings/page.tsx`, title `AdminPage` "Booking Central — {series name or All series}" and remove the series `<h2>`; narrow, render the **Performers** button and its `Dialog` (the `HubSearch` and `NeedingContactList`) in place of the inline search and prompt; wide, unchanged; T019 green
- [X] T022 [US3] Run `pnpm vitest run tests/unit tests/component` — green; then the Performers part of quickstart §4 in the browser

**Checkpoint**: every story done.

---

## Phase 6: Polish & cross-cutting

- [X] T023 [P] Record in `specs/phase-8-requirements/mobile-volunteer-conventions.md` that Booking Central's cards shipped as feature 091 (the first page conversion), with the default dance corrected to the first dated today or later
- [X] T024 Run the full gates with the dev server stopped: `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`, then `rm -rf .next/dev`
- [X] T025 [P] Run `pnpm exec eslint` and `pnpm exec prettier --check` on the changed code and CSS files only
- [X] T026 Rich, through the tunnel: quickstart §6 on the iPhone (Safari, Chrome) and a Galaxy (Chrome, Samsung Internet)
- [X] T026a From Rich's first phone check (spec Session 2026-10-01): stop the default dance 6rem short of the window's bottom (`scroll-margin-block-end` in `hub.module.css`, FR-007); pin the volunteer bar on Booking Central only (`data-volunteer-bar` on `src/app/VolunteerNav.tsx`, the rule in `hub.module.css`, the phone's open Menu scrolling within itself — the phone's only, since on a computer a scrolling bar clipped Settings' dropping list, found after the table was retired, FR-016); name each performer on a card by first initial and last name (`danceParts(row, actions, "initials")`, test first in `tests/component/bookingCentral.cards.test.tsx`, FR-002b), with "feat." for "featuring" on a card and each term (Caller, Music, Sound) top-aligned with the first line of its names (`.cardSlots` in `hub.module.css`); the opened dance names performers the same way (`DanceView.tsx`, test first in `bookingCentral.danceView.test.tsx`); the performer search box drawn the same in every browser, with room above it for its focus ring (Chrome on the iPhone ran it into the heading — `.search` in `hub.module.css`), the page's title and its controls pinned in one header under the bar at every width, with a smaller title (`AdminPage`'s new `head` and `pinned`, `--volunteer-bar-height` kept by the page; test first in `bookingCentral.performers.test.tsx`, FR-017); the card the basis at every width — the table and `HubRow.tsx` retired, the card live from 48rem with the time, venue and notes and Caller, Music and Sound side by side in a six-column subgrid shared by every card — terms their own width, names columns their widest piece then 1 : 2 : 1, each + kept with its last name (`withAdd` in `danceParts.tsx`, test first in `bookingCentral.cards.test.tsx`) (`HubCard.tsx`, `.wideCards` in `hub.module.css`; 087's table tests moved onto the cards through `dancesList` / `danceCard` / `slotOf` in the fixture; FR-006); every series the viewer's roles name, not only exactly one — a Booker of contra and the community dance sees those two, not ECD (the read's `series` takes several, `inArray` in `reportService.ts`; tests first in `bookings.report.test.ts` and `bookingCentral.performers.test.tsx`, FR-011); a new performer from a band's member search, made with the existing form and added to the band (`BandRoster.tsx`; `PerformerForm` now reports the performer it created; test first in `tests/component/bandRoster.test.tsx`, FR-019); the venue by its full name on the wide card and in the opened dance (the read's `venueShortName` replaced by `venueName`, test first in `tests/integration/bookingsReport.booker.test.ts`); under 450px tall the header's search and prompt behind Performers at the end of the title's line (`AdminPage`'s `headBeside`, FR-018); no buttons at the list's ends — scrolling or the arrow keys load more, each end saying "Loading…" and, at the last, that there are no more (FR-009 amended; tests reach an end through `stubScrolling` in the fixture); and the booking editor's own performer search the same way, which takes the cursor on opening and sat flush against its heading (new `_modals/BookingModal.module.css`); backlog **B68** (a declined booking still reaches the organizer report and the door) and **B69** (a no-show on the payments page) in `specs/BACKLOG.md`
- [X] T026b Re-run T024 and T025 after T026a — the gates were run before it
- [X] T027 Run `pnpm lint:md` and the 100-column check over the `.md` files this feature changes (CLAUDE.md's rule — once, before the commit)
- [X] T028 Tick this task and T029 **before** committing, then make one atomic commit for the feature — never amend and force-push a pushed branch merely to mark a step complete
- [X] T029 Push the branch and open the pull request against `main`; its description states that the tests pass, lint and formatting are clean, and the plan's Constitution Check is signed off

---

## Dependencies & execution order

- **Setup (T001)** → **Foundational (T002)** → the stories.
- **The stories run in order — US1, then US2, then US3**: all three change
  `src/app/(admin)/bookings/page.tsx`, and US1 and US2 both change `hub.module.css`. Each still
  delivers on its own: US1 needs only the parts; US2 only the read and the page's loading; US3 only
  the page's head.
- **Within a story**: its tests (marked [P], different files) first and failing; then the
  implementation in the order listed (later tasks build on earlier ones in the same file).
- **Polish (T023–T029)** last. T026 needs the dev server running; T024 needs it stopped.

### Parallel opportunities

- US1: T003, T004 and T005 together; T007 alongside T006.
- US2: T011, T012 and T013 together.
- Polish: T023 and T025 together.

## Implementation strategy

1. **MVP = Setup + Foundational + US1**: the page is usable on a phone — cards and the opened dance
   — even before it opens on the next dance.
2. **US2** makes it open where the work is and drops the date control, at every width.
3. **US3** tidies the space above the dances.
4. Polish, Rich's phones, one commit, one pull request.

## Summary

| Phase | Tasks | Story |
|---|---|---|
| 1 — Setup | T001 (1) | — |
| 2 — Foundational | T002 (1) | — |
| 3 — US1 | T003–T010 (8) | US1 |
| 4 — US2 | T011–T018 (8) | US2 |
| 5 — US3 | T019–T022 (4) | US3 |
| 6 — Polish | T023–T029 (7) | — |
