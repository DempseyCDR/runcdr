# Tasks: The volunteer frame

**Input**: Design documents from `specs/090-volunteer-frame/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: required — Principle I (Test-First) is non-negotiable. Each story's tests are written and
seen to fail for the right reason before its implementation.

**Organization**: by user story. The grouped menu (`menuFor`) is Foundational: the bar (US1, US2)
and the home page (US3) all render it.

**⚠️ The dev server must be stopped** for every task that runs the test suite or the build.

**Markdown**: the hook fixes each `.md` written with Write or Edit; `pnpm lint:md` and the
100-column check run once, before the commit (T040).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

- [X] T001 With the dev server stopped, run `pnpm vitest run tests/integration/authz.nav.test.ts tests/integration/auth.navCompleteness.test.ts tests/component/volunteerNav.test.tsx tests/component/nav.render.test.tsx tests/component/nav.stack.test.tsx` — the green baseline the menu tests move from

---

## Phase 2: Foundational (blocks US1–US3)

**Purpose**: one grouped menu, decided on the server, that the bar and the home page share.

- [X] T002 [P] Write the failing `tests/unit/menuFor.test.ts` per [data-model.md](./data-model.md): six or fewer destinations → `{ kind: "flat" }`; more → `{ kind: "grouped" }` in the fixed order Tonight, Booking, Reports, People, Settings, Website; empty groups dropped; a group of one kept (the presenter draws it as a link); the destinations are exactly `navItemsFor(actor)`; the gate report's label is "Gate report" (build actors from capability sets, as `authz.nav` does)
- [X] T003 [P] In `tests/integration/authz.nav.test.ts`, change "Treasurer report" to "Gate report", and add a grouped-menu case per role — a Door Attendant flat (3), the Financial Secretary and a Super-user grouped — asserting the same destinations as before (SC-003); see them fail
- [X] T004 In `src/server/auth/nav.ts`, give each `NAV` entry a `group` from a closed union type, rename "Treasurer report" to "Gate report", and add `menuFor(actor)` returning the discriminated flat/grouped result; T002, T003 green

**Checkpoint**: the menu's arrangement exists and is tested; nothing renders it yet.

---

## Phase 3: User Story 1 — A grouped, coloured volunteer menu (Priority: P1) 🎯 MVP

**Goal**: volunteer pages show one band-coloured volunteer bar, grouped, keyboard-operable; public
pages keep both bars.

**Independent test**: quickstart §2 — three roles on a computer; groups open and close by mouse and
keyboard.

### Tests for User Story 1 (write first, see them fail)

- [X] T005 [P] [US1] Write the failing guard `tests/unit/bars.test.ts` (reads the source): `src/app/layout.tsx` renders neither `PublicNav` nor `Nav`; `src/app/(public)/layout.tsx` renders both, above its wrapper; `src/app/(admin)/layout.tsx`, `src/app/(door)/layout.tsx` and `src/app/dev/layout.tsx` render `Nav` and not `PublicNav` (FR-001)
- [X] T006 [P] [US1] Rewrite `tests/component/volunteerNav.test.tsx` per [contracts/menu.md](./contracts/menu.md): the "Main" landmark; "Volunteer" (to `/volunteer`) and "Club site" (to `/`) links; a flat menu as links; a grouped menu with Tonight's links flat and each other group of two or more as a button with `aria-expanded`/`aria-controls`, a group of one as a link; M1 (click, Enter, Space open it; one group open at a time), M2 (Down, Up, Home, End move within), M3 (Escape closes, focus back to the button), M4 (choosing a link or clicking outside closes); M7 (a `<noscript>` rule shows every group's panel open, so each destination is reachable without JavaScript); `aria-current` on the current page; keep feature 083's Sign out cases (POST form, "Signed in as {name}")
- [X] T007 [P] [US1] Update `tests/component/nav.render.test.tsx` so `Nav` hands the presenter `menuFor(actor)` and the name; keep `tests/component/nav.stack.test.tsx`'s two-landmark case, which describes a public page, updating its `VolunteerNav` props to the new menu shape; see them fail

### Implementation for User Story 1

- [X] T008 [US1] `src/app/Nav.tsx`: pass `menuFor(actor)` and `actor.staff.displayName` to `VolunteerNav`
- [X] T009 [US1] Rewrite `src/app/VolunteerNav.tsx` for 48rem and up (R3, R5): the "Volunteer" link, Tonight's links, the group disclosures with their panels and keyboard handling (one open at a time; close on outside click, route change, Escape, choosing a link; without JavaScript every panel is shown open via `<noscript>`), "Signed in as {name}", the Sign out form, "Club site"; and create `src/app/VolunteerNav.module.css` (the band colour with `--link-on-dark` text, every control at least `--tap-min`, no hover opening) — B55; T006, T007 green
- [X] T010 [US1] Move the bars (R1): `src/app/layout.tsx` renders neither; `src/app/(public)/layout.tsx` renders `<PublicNav />` and `<Nav />` before its `.public` wrapper; `src/app/(admin)/layout.tsx` and `src/app/(door)/layout.tsx` render `<Nav />` above `children`; create `src/app/dev/layout.tsx` rendering `<Nav />`; T005 green
- [X] T011 [P] [US1] Retire the per-page identity (R6): remove `identity` from `src/app/(admin)/_components/AdminPage.tsx` and its `.identity` rules from `AdminPage.module.css`, drop the prop in `src/app/(admin)/bookings/page.tsx` and `src/app/(admin)/contacts/page.tsx`, and remove the identity cases from `tests/component/adminPage.test.tsx`
- [X] T012 [P] [US1] Before T009, add `VolunteerNav.module.css` to the file list in `tests/unit/volunteerStyle.test.ts` and see its "exists" case fail
- [X] T013 [US1] Run `pnpm vitest run tests/unit tests/component tests/integration/authz.nav.test.ts` (dev server stopped) — green; then quickstart §2 in the browser (three roles; keyboard; a public page shows both bars)

**Checkpoint**: one coloured, grouped bar on every volunteer page, on a computer.

---

## Phase 4: User Story 2 — The menu on a phone (Priority: P1)

**Goal**: below 48rem the bar is the name and Menu, on one line; the Menu lists everything open,
Tonight first, then Sign out and Club site.

**Independent test**: quickstart §3 at 320 and 390 wide.

### Tests for User Story 2 (write first, see them fail)

- [X] T014 [US2] Extend `tests/component/volunteerNav.test.tsx`: a "Menu" button with `aria-expanded`/`aria-controls`; its panel lists Tonight first, then every other group open under a heading, then Sign out and Club site (FR-010, FR-012); the name is shown on its own (FR-011); M5 (Menu opens and closes the panel), M6 (Escape closes it, focus back to Menu), choosing a link closes it; a `<noscript>` rule reveals the panel (M7)

### Implementation for User Story 2

- [X] T015 [US2] Add the phone bar to `src/app/VolunteerNav.tsx` and `VolunteerNav.module.css` (R4): below `@media (min-width: 48rem)` show the name and Menu and hide the computer row; the Menu panel flows full-width beneath the bar (feature 046's pattern) with the groups open; T014 green
- [X] T016 [US2] With the dev server running, quickstart §3: 320 × 640 and 390 × 844 as the Financial Secretary and a Door Attendant — one line, the Menu's contents and closing, every control at least 44 × 44 (feature 089's measuring script), 200% text wraps without clipping

**Checkpoint**: the frame works on a phone.

---

## Phase 5: User Story 3 — Landing on a volunteer home page (Priority: P2)

**Goal**: `/volunteer` shows the volunteer's own menu as a page; sign-in with no page requested
lands there.

**Independent test**: quickstart §4 (landing, and returning to a requested page).

### Tests for User Story 3 (write first, see them fail)

- [X] T017 [P] [US3] Write the failing `tests/component/volunteerHome.test.tsx`: given a grouped menu, the home page shows each group as a section under its heading, Tonight first, each destination a link; given a flat menu, one list
- [X] T018 [P] [US3] (Done as a unit seam — `landingAfterSignIn` in `src/server/auth/redirect.ts`, tested in `tests/unit/auth.redirect.test.ts` — since a successful callback cannot run without faking Google's token exchange.) In `tests/integration/auth.callback.test.ts`, add: a successful callback with no `next` redirects to `/volunteer`; with `next=/payments`, to `/payments` (FR-015); see the first fail
- [X] T019 [P] [US3] In `tests/integration/auth.navCompleteness.test.ts`, allow `/volunteer` as a staff page reached from the bar's "Volunteer" link rather than from `NAV`; see it fail until the page exists

### Implementation for User Story 3

- [X] T020 [US3] Create `src/app/(admin)/volunteer/page.tsx` (a server component: `getActor`, `menuFor`, `AdminPage` titled "Volunteer home") with a presenter `src/app/(admin)/volunteer/VolunteerHome.tsx` and `volunteer.module.css` (tap targets at least `--tap-min`); T017, T019 green
- [X] T021 [US3] In `src/app/api/auth/google/callback/route.ts`, land on `safeNextPath(next, "/volunteer")` (R7); T018 green
- [X] T022 [US3] (Its guard entry: `(admin)/volunteer/volunteer.module.css` joins `tests/unit/volunteerStyle.test.ts` before T020, and fails first.) Run `pnpm vitest run tests/unit tests/component tests/integration/auth.callback.test.ts tests/integration/auth.navCompleteness.test.ts` (dev server stopped) — green

**Checkpoint**: sign-in lands on the volunteer's own work.

---

## Phase 6: User Story 4 — A sign-in page that looks like the club's (Priority: P2)

**Goal**: the sign-in page per [contracts/pages.md](./contracts/pages.md).

**Independent test**: quickstart §4 (the sign-in page at 320, 390 and on a computer).

### Tests for User Story 4 (write first, see them fail)

- [X] T023 [US4] Write the failing `tests/component/login.page.test.tsx` (render `await LoginPage({ searchParams })`, with `PublicNav` mocked): the public bar is rendered; the heading "Volunteer sign-in"; "For club volunteers. Dancers don't need to sign in."; "Volunteer areas require a CDR volunteer account."; "On a shared phone, sign out when you're done."; a "Can't sign in?" link to `/contact-us`; a "Sign in with Google" link to `/api/auth/google` (with `?next=` when one is given) containing the G mark; the logotype image; with `error`, the unchanged generic alert and no reason named

### Implementation for User Story 4

- [X] T024 [US4] Rewrite `src/app/login/page.tsx` and create `src/app/login/login.module.css` (R8): `PublicNav` on top; the logotype block and the sign-in `<main>` side by side, stacking below 40rem (logotype first, `max-width: 100%`); the wording; Google's standard light button with the four-colour G as an inline SVG; text at least 16px and controls at least `--tap-min`; T023 green
- [X] T025 [US4] (Its guard entry: `login/login.module.css` joins `tests/unit/volunteerStyle.test.ts` before T024, and fails first.) With the dev server running, check the page signed out at 320, 390 and on a computer (quickstart §4) — no sideways scroll

**Checkpoint**: the first volunteer page anyone sees is the club's.

---

## Phase 7: User Story 5 — The organizer report: own series, and a clean printout (Priority: P3)

**Goal**: the menu opens the viewer's series; the report has a series selector; Print prints the
report alone, through the shared `PrintBar`.

**Independent test**: quickstart §5.

### Tests for User Story 5 (write first, see them fail)

- [X] T026 [P] [US5] Write the failing `tests/unit/mySeries.test.ts` (the rule lifted unchanged from `/api/me/capabilities`: every series any grant names; none for a club-wide grant or no grants) and `tests/unit/organizerLanding.test.ts` (`organizerLandingKey`: exactly one series → its key; otherwise `tnc`)
- [X] T027 [P] [US5] Write the failing `tests/component/printBar.test.tsx`: Print in a pinned "Actions" bar calls `window.print`; on the iPhone Safari user agent the note shows instead; on iPhone Chrome, Print
- [X] T028 [P] [US5] Write the failing `tests/component/organizer.page.test.tsx`: a "Series" select lists every series and choosing one navigates to `/organizer/{key}`; the report is wrapped in `[data-printable-report]`, whose heading names the series and year as text; the year and series controls and Print (from `PrintBar`) are outside it
- [X] T029 [P] [US5] In `tests/integration/authz.nav.test.ts` and `tests/integration/auth.navCompleteness.test.ts`, expect the organizer report's entry at `/organizer` (a real static staff page); see them fail

### Implementation for User Story 5

- [X] T030 [US5] Create `src/server/auth/mySeries.ts` with `mySeries(actor)` and use it in `src/app/api/me/capabilities/route.ts` (unchanged answer); add `organizerLandingKey` beside it; T026 green
- [X] T031 [US5] Create `src/app/(admin)/organizer/page.tsx` redirecting to `/organizer/{organizerLandingKey(mySeries(actor), series)}` with `redirect` from `next/navigation` (a page, not a route handler), and point the organizer report's `NAV` entry in `src/server/auth/nav.ts` at `/organizer`; T029 green
- [X] T032 [US5] Create `src/app/_components/PrintBar.tsx` and `PrintBar.module.css` (R10): move `isIPhoneSafari`, `useCanPrint` and the note out of `src/app/(admin)/treasurer/page.tsx`, and the `@page` and hide-then-reveal `[data-printable-report]` rules out of `treasurer.module.css` (the gate report keeps its table and grid rules); the gate report uses `<PrintBar />`; T027 green, and `tests/component/treasurer.gateReport.test.tsx` still green
- [X] T033 [US5] In `src/app/(admin)/organizer/[seriesKey]/page.tsx`, add the labelled series select (from `/api/series`, navigating with the router), wrap the report in `data-printable-report` with its heading as plain text ("{series} — Organizer Report {year}") and the year and series controls outside it (today the year box sits inside the `<h1>`), add `<PrintBar />`, and create `organizer.module.css` with its print rules (a 9pt table at 100% width on landscape letter); T028 green
- [X] T033a [US5] (Added 2026-09-30, FR-024, from Rich's check of quickstart §5; test first in `tests/component/eventSelector.test.tsx`.) In `src/app/EventSelector.tsx`, choosing a series selects that series' default evening (the first default's rule, now `defaultOf`) on every page that uses it, and `onSelect` says why (`SelectedBy`: default, series, picked); `src/app/_components/EventConfirm.tsx` closes **Change** only on a pick (test first in `tests/component/eventConfirm.test.tsx`). Also from Rich: the volunteer home's groups in exactly two columns at every width, each card tall enough for a two-line label on a phone (FR-014, `(admin)/volunteer/volunteer.module.css`). Also found by that check and fixed: the scoped hide rule in `PrintBar.module.css` outranked the reveal and printed a blank page — its scope now sits in `:where()`, guarded by `tests/unit/printRules.test.ts`
- [X] T034 [US5] (Their guard entries: `_components/PrintBar.module.css` and `(admin)/organizer/[seriesKey]/organizer.module.css` join `tests/unit/volunteerStyle.test.ts` before T032 and T033, and fail first.) Run `pnpm vitest run tests/unit tests/component tests/integration/authz.nav.test.ts tests/integration/auth.navCompleteness.test.ts` (dev server stopped) — green; then quickstart §5 in the browser (own-series landing, selector, print preview from desktop Chrome and desktop Safari)

**Checkpoint**: every story done.

---

## Phase 8: Polish & cross-cutting

- [X] T035 [P] Record in `specs/phase-8-requirements/mobile-volunteer-conventions.md` that the volunteer frame shipped as feature 090; mark **B55** done in `specs/BACKLOG.md`
- [X] T036 Run the full gates with the dev server stopped: `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`, then `rm -rf .next/dev`
- [X] T037 [P] Run `pnpm exec eslint` and `pnpm exec prettier --check` on the changed code and CSS files only
- [X] T038 Rich, through the tunnel: quickstart §6 on the iPhone (Safari) and a Galaxy (Chrome, Samsung Internet)
- [X] T039 Run `pnpm lint:md` and the 100-column check over the `.md` files this feature changes (CLAUDE.md's rule — once, before the commit)
- [X] T040 Tick this task and T041 **before** committing, then make one atomic commit for the feature (it carries the `CLAUDE.md` Markdown-convention change) — never amend and force-push a pushed branch merely to mark a step complete
- [X] T041 Push the branch and open the pull request against `main`; its description states that the tests pass, lint and formatting are clean, and the plan's Constitution Check is signed off

---

## Dependencies & execution order

- **Setup (T001)** first.
- **Foundational (T002–T004)** blocks US1, US2 and US3: all three render `menuFor`.
- **US1 (T005–T013)** before **US2 (T014–T016)**: both edit `VolunteerNav.tsx`, its stylesheet and
  its test.
- **US3 (T017–T022)**, **US4 (T023–T025)** and **US5 (T026–T034)** are independent of each other
  after Foundational. Two exceptions:
  - US5's T031 edits `nav.ts`, so it follows T004.
  - T029 and T003 both edit `authz.nav.test.ts`, so they run in that order.
- **The style guard** (`volunteerStyle.test.ts`) gains each new stylesheet **before** the stylesheet
  is written, so its "exists" case fails first (T012, T022, T025, T034); do those one at a time.
- **Polish (T035–T041)** last; T038 needs the dev server running, and T036 needs it stopped.

## Parallel opportunities

- Foundational: T002 beside T003.
- US1: T005, T006, T007 together (tests); then T011 and T012 beside T008–T010.
- US3: T017, T018, T019 together.
- US5: T026, T027, T028, T029 together.
- Across stories after Foundational: US3, US4 and US5 can proceed side by side (different files),
  apart from the shared guard file.

## Implementation strategy

**MVP is US1 + US2** (both P1): the coloured, grouped bar on a computer and on a phone. That is the
change every volunteer sees on every page. US3 and US4 then fix how a volunteer arrives (the landing
and the sign-in page); US5 is the organizer report's two corrections. The feature lands as one
commit.

| Phase | Tasks | Story |
|---|---|---|
| 1 — Setup | T001 (1) | — |
| 2 — Foundational | T002–T004 (3) | — |
| 3 — US1 | T005–T013 (9) | US1 |
| 4 — US2 | T014–T016 (3) | US2 |
| 5 — US3 | T017–T022 (6) | US3 |
| 6 — US4 | T023–T025 (3) | US4 |
| 7 — US5 | T026–T034 (9) | US5 |
| 8 — Polish | T035–T041 (7) | — |
