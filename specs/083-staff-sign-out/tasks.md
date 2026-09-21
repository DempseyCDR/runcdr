---

description: "Task list for feature 083 — a sign-out control for staff"
---

# Tasks: A sign-out control for staff

**Input**: Design documents from `/specs/083-staff-sign-out/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/sign-out.md](./contracts/sign-out.md),
[quickstart.md](./quickstart.md)

**Tests**: MANDATORY. Constitution Principle I (Test-First) is non-negotiable: each test task below is
written and seen to FAIL before the implementation task that follows it.

**Organization**: grouped by user story, in priority order. US1 alone is a shippable MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1, US2, US3 — from [spec.md](./spec.md)

## Path Conventions

One Next.js app: `src/app` (pages and components), `src/server` (domain and auth), `tests/component`
(jsdom), `tests/integration` (real Postgres), `tests/unit`.

---

## Phase 1: Setup

**Purpose**: confirm the ground the plan rests on, before writing anything.

- [X] T001 Confirm the working tree is on `083-staff-sign-out`, clean, and that `pnpm vitest run` is green
      before any change (the baseline this feature must not break)
- [X] T002 Re-read `src/app/api/auth/signout/route.ts` and `destroySession` in
      `src/server/auth/session.ts`, confirming research R3 and R5 on the code as it stands: POST-only,
      `303` to `/`, cookie cleared, `auth.signout` logged. **No server file is edited by this feature** —
      if either turns out to be untrue, stop and correct [research.md](./research.md) first

---

## Phase 2: Foundational

**Purpose**: none. There is no schema change, no migration, no new route, no shared helper: the control
lives entirely in the menu that already renders. Both stories touch the same two source files, so neither
blocks the other beyond file ordering.

**Checkpoint**: nothing to build here — start User Story 1.

---

## Phase 3: User Story 1 — Ending your own session (Priority: P1) 🎯 MVP

**Goal**: a signed-in volunteer can sign out from wherever they are working, and lands on the public home
page with the session ended.

**Independent Test**: sign in as any volunteer, use the control, and confirm a staff page now asks for
sign-in rather than opening.

### Tests for User Story 1 ⚠️ write first, see them fail

- [X] T003 [P] [US1] Extend `tests/component/volunteerNav.test.tsx`: the Main nav contains a **Sign out**
      submit button; its form has `method="post"` and `action="/api/auth/signout"`; that form is the nav's
      LAST element child, after every destination link (FR-001, and the mis-tap edge case) — assert the
      position concretely, e.g. `nav.lastElementChild` is the form holding the button; the button's touch
      target is at least `2.75rem` high (FR-007). Confirm the new cases fail against the current presenter
- [X] T004 [P] [US1] Create `tests/integration/auth.signout.test.ts` against the real route
      (`POST as SIGNOUT from "@/app/api/auth/signout/route"`): with a valid session cookie it answers
      `303` to `/` and clears the session cookie; the SAME cookie is then refused `401` by an
      authenticated route (`GET /api/me/capabilities`); a second sign-out with that cookie answers `303`
      with no error (FR-002's idempotence), as does a sign-out with no cookie at all (the "already ended"
      edge case); **another volunteer's session, made with `makeActor`, still succeeds afterwards**
      (FR-008, SC-005); and the route module **exports no `GET` handler**, which is what FR-006 rests on —
      a GET sign-out would be firable by a prefetch or an `<img>`. Build the requests directly rather than
      with `jsonReq`, which always attaches the standing session

### Implementation for User Story 1

- [X] T005 [US1] Add the control to `src/app/VolunteerNav.tsx`: a `<form action="/api/auth/signout"
      method="post">` holding a **Sign out** submit button, rendered after the destination links. Follow
      the file's existing inline-style approach (research's deferred question), with an explicit
      `minHeight: "2.75rem"` for the touch target. No `fetch`, no `onClick`, no client state — a real
      submission is what keeps FR-006 true and works without JavaScript
- [X] T006 [US1] Run `tests/component/volunteerNav.test.tsx` and `tests/integration/auth.signout.test.ts`;
      both green. Confirm no dev server is running before the integration file touches the database

**Checkpoint**: US1 is shippable on its own — the menu can end a session, though it does not yet say whose.

---

## Phase 4: User Story 2 — Handing the phone to the next volunteer (Priority: P2)

**Goal**: the menu names the volunteer whose session the device holds, beside the control.

**Independent Test**: sign in as one volunteer on a phone-sized screen, confirm the name; sign out, sign
in as another, confirm the name changed.

### Tests for User Story 2 ⚠️ write first, see them fail

- [X] T007 [P] [US2] Extend `tests/component/volunteerNav.test.tsx`: given `signedInAs="Meg Door"` the
      menu renders **Signed in as Meg Door** beside the Sign out control (FR-005)
- [X] T008 [P] [US2] Extend `tests/component/nav.render.test.tsx`: the loader passes the signed-in
      volunteer's display name to the presenter — widen the `VolunteerNav` stub to render its
      `signedInAs` prop, and give `getActor` a resolved value shaped like an actor
      (`{ staff: { displayName: "Meg Door" }, grants: [] }`) rather than today's `{}`, which would throw
      once `Nav` reads `staff.displayName`. Keep the existing "renders nothing for an anonymous visitor"
      case exactly as it is (FR-004)

### Implementation for User Story 2

- [X] T009 [US2] Add a **required** `signedInAs: string` prop to `src/app/VolunteerNav.tsx` and render
      "Signed in as {name}" beside the control. Required, not optional, so the compiler names every
      caller (research R6)
- [X] T010 [US2] Pass `actor.staff.displayName` from `src/app/Nav.tsx` into the presenter, leaving the
      anonymous `return null` untouched
- [X] T011 [US2] Update `tests/component/nav.stack.test.tsx` for the new required prop (it renders the
      presenter directly), and run the three nav component test files; all green

**Checkpoint**: the shared door phone now says whose session it holds.

---

## Phase 5: User Story 3 — Checking a page as another role (Priority: P3)

**Goal**: sign out and back in as a different volunteer to see a page as that role sees it.

**Independent Test**: sign in with different capabilities and confirm the same page offers different
controls.

- [X] T012 [US3] No code. Verify by walking [quickstart.md](./quickstart.md) §3.5 — sign out, sign in as
      an account holding different capabilities, and confirm the pages offer that account's controls. This
      is the occasion that raised B53; it is delivered by US1 and needs nothing of its own

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T013 [P] Run `pnpm exec eslint` and `pnpm exec prettier --check` on the changed files only
      (`src/app/Nav.tsx`, `src/app/VolunteerNav.tsx`, the three nav test files, the new integration test)
- [X] T014 [P] Add a backlog row to `specs/BACKLOG.md` for converting `VolunteerNav`'s inline styles to a
      CSS module (research's deferred question) — a tidy-up with its own risk, not part of B53
- [X] T015 Mark **B53** done in `specs/BACKLOG.md` per that file's own rule ("when a backlog item is
      picked up… remove the row, or mark it Done with the feature number"), naming feature 083
- [X] T016 Run `pnpm tsc --noEmit`, then the full `pnpm vitest run` with **no dev server running**, then
      `pnpm build` and `pnpm lint:md`
- [X] T017 Walk the control in the browser at 390 × 844: the menu shows the name and the Sign out button
      without zooming or sideways scrolling, and signing out lands on the public home page
- [X] T018 Hand the rest of [quickstart.md](./quickstart.md) to Rich — §1.4 (the Back button on a real
      device, the browser fact no test can settle), §2 (the hand-over with two accounts) and §3.1 (the
      unsaved-gate warning). Record what the Back button actually does in this file's **Deviations**
- [X] T019 Record any departure from the design documents in **Deviations** below, and correct the
      document it departs from
- [X] T020 Commit the feature as one commit on `083-staff-sign-out` and open the PR (ask first — the
      constitution requires a branch and PR; self-merge is permitted)

---

## Dependencies

```text
Setup (T001–T002)
        │
        ▼
US1 (T003–T006)  ── shippable MVP: the control works
        │
        ▼
US2 (T007–T011)  ── adds the name; edits the same two files, so it follows US1
        │
        ▼
US3 (T012)       ── verification only, needs US1
        │
        ▼
Polish (T013–T020)
```

- **T003 and T004** are parallel: different files, neither depends on the other.
- **T007 and T008** are parallel with each other, but both come after T005 (the control they sit beside).
- **T009 breaks the build for every caller of the presenter** until T010 and T011 land — keep them
  together in one sitting.
- **T013 and T014** are parallel; T015–T020 are sequential.

## Parallel execution examples

```text
US1 tests:   T003 (component) ║ T004 (integration)
US2 tests:   T007 (presenter) ║ T008 (loader)
Polish:      T013 (lint)      ║ T014 (backlog row)
```

## Implementation strategy

**MVP = Phase 1 + Phase 3 (US1).** Four tasks after setup give a volunteer a working way out of a session,
which is the whole of B53. Phase 4 (US2) makes a shared door phone trustworthy and is a separate, small
increment on the same two files. Phase 5 is verification only.

Nothing here touches the database schema, the sign-in flow, or the site menu — if a task seems to need
any of those, stop: it is outside what this plan scoped.

## Deviations

- **T004 — the integration tests passed on their first run.** Test-First expects red before green, and
  these were green immediately: the route they cover is feature 015's and this feature changes no server
  file (plan.md, research R3/R5). They are regression guards on the promises the control rests on — that
  a GET handler is never added (FR-006), that another volunteer's session survives (FR-008, SC-005) —
  rather than tests of new behaviour. The new behaviour, the control itself, was red first (T003) and the
  name likewise (T007, T008).
- **T014 — the tidy-up is backlog B55**, not a free-floating note: "Give the volunteer menu a stylesheet".
- **The signed-in name is a `<span>` beside the control**, not inside the form: it is a label, not a
  submit target. It carries the same `2.75rem` minimum height so the bar's items line up on a phone.
- **T017 walked in the browser at 390 × 844** (Rich signed in as Peggy Dempsey, 2026-09-21): the menu
  showed "Signed in as Peggy Dempsey" with the Sign out button as the nav's last child, a 44px (2.75rem)
  target, `method="post"` to `/api/auth/signout`, and no sideways scroll. Pressing it landed on the public
  home page with the menu gone; `/gate` then showed **Staff sign-in**, and going Back twice stayed on
  `/login` — no gate page painted from the browser's cache, so **SC-002 holds here** and research R2 needs
  no follow-up in this browser.
- **The signed-in name lost its minimum height** after the walk showed it opening a tall empty row on a
  phone. It is `alignSelf: center` now, taking the button's line; the button keeps the 2.75rem target,
  which is what FR-007 asks for.
- **The walk is complete (Rich, 2026-09-21).** §2, the two-account hand-over, and §3.1, the unsaved-gate
  warning, both pass; so does T012 — signing out and back in as a different volunteer now works, once the
  account chooser was added.
- **FR-011 was added mid-implementation**, from the walk itself: signing out ended the club's session but
  not Google's, so signing in came straight back as the same volunteer and no account could be switched.
  `beginAuthorization` now sends `prompt=select_account` (research R7), covered by
  `tests/unit/auth.googleAuthorization.test.ts`, which builds the URL locally and contacts nothing. The
  spec's "sign-in itself is untouched" assumption is corrected, the contract records
  `GET /api/auth/google` as changed, and the quickstart gains step 1a. This is the one server file the
  feature touches — plan.md's "no server change" held for the sign-OUT half only.
