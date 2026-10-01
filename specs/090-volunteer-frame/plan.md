# Implementation Plan: The volunteer frame

**Branch**: `090-volunteer-frame` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/090-volunteer-frame/spec.md`

## Summary

Give volunteers a frame of their own.

- **Menu:** the volunteer bar is rebuilt as one coloured bar with a stylesheet (B55). A pure
  `menuFor(actor)` groups the same destinations `navItemsFor` offers today: Tonight, Booking,
  Reports, People, Settings, Website; six or fewer stay flat. On a computer each group is a
  disclosure that opens on click and works fully by keyboard. Below 48rem the bar is the name and a
  Menu button; the Menu lists every group open, Tonight first, then Sign out.
- **Bars:** the public bar moves out of the root layout, into the public layout and the sign-in
  page, so volunteer pages show only the volunteer bar.
- **Landing:** sign-in with no page asked for lands on a new **volunteer home page** (`/volunteer`),
  the menu laid out as a page.
- **Sign-in page:** restyled with the public bar, the logotype beside the sign-in, "Volunteer"
  wording, the four additions, and Google's standard button.
- **Organizer report:** the menu reaches it through `/organizer`, which redirects to the volunteer's
  own series; the report gains a series selector and prints alone on landscape letter from a shared
  pinned `PrintBar`, the same one the gate report uses.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 24

**Primary Dependencies**: Next.js 16 (App Router), React 19, CSS Modules. **No new dependency** —
Google's "G" mark is an inline SVG.

**Storage**: none — no migration; nothing stored.

**Testing**: Vitest.

- **Unit:** the menu grouping (`menuFor`), the viewer's own series, and the organizer landing
  rule, all pure functions.
- **Integration (real Postgres):** each role's menu, and the sign-in callback's landing page.
- **Component (jsdom):** the volunteer bar (disclosures, keyboard, the Menu), the home page, the
  sign-in page, the organizer report's selector and Print.
- **Guards:** which layout renders which bar, and the style guard extended to the new stylesheets.
- **In the browser:** widths and phones through the tunnel.

**Target Platform**: the volunteer pages and the sign-in page, on phones (portrait), tablets and
computers.

**Project Type**: web application (single Next.js project, `src/app` + `src/server`)

**Performance Goals**: none new — the menu is computed from the actor already loaded per request.

**Constraints**:

- Who sees what does not change (spec FR-007, SC-003).
- The public site is unchanged, apart from where its bar is rendered.
- Feature 089's tap minimum, widths and guard apply.
- The dev server must be stopped while the suite runs.

**Scale/Scope**: 20 destinations in 6 groups; about 6 layouts or pages touched, 3 new pages or
routes (`/volunteer`, `/organizer`, the sign-in page's new look), and 2 shared components
(`PrintBar`, the rebuilt `VolunteerNav`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| **I. Test-First** | Pass. The grouping rule, the own-series rule and the organizer landing are pure functions, each tested before it exists. The menu's keyboard behaviour, the home page, the sign-in page's elements, the landing after sign-in and the one-bar rule each get a failing test first. The existing menu tests (`authz.nav`, `auth.navCompleteness`, `nav.render`, `nav.stack`) move with the change and are seen to fail first. |
| **II. Simplicity / YAGNI** | Pass, with three small additions in Complexity Tracking. No new dependency; the Route index stays unstyled; no print styling beyond the two reports. |
| **III. Type Safety** | Pass. Menu groups are a closed union type; `menuFor` returns a discriminated result (flat or grouped). No casts. |
| **IV. Observability** | Pass. Two new routes: `/volunteer` (a page) and `/organizer` (a redirect). Both sit behind the existing staff layout, which logs as every page does. The callback's landing change adds no new path. |

**Post-design re-check**: unchanged. The contracts ([menu](./contracts/menu.md),
[pages](./contracts/pages.md)) add no dependency or server write.

## Project Structure

### Documentation (this feature)

```text
specs/090-volunteer-frame/
├── plan.md              # This file
├── research.md          # R1–R10
├── data-model.md        # no stored data — the menu's shape and grouping rules
├── quickstart.md        # roles × widths × keyboard; sign-in; the organizer report and its print
├── contracts/
│   ├── menu.md          # menuFor, the volunteer bar at each width, keyboard behaviour
│   └── pages.md         # /volunteer, /organizer, the sign-in page, PrintBar
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks — not created by /speckit-plan
```

### Source Code (repository root)

```text
src/server/auth/nav.ts                 # + group per destination, "Gate report", /organizer; menuFor
src/server/auth/mySeries.ts            # NEW — the viewer's own series (from /api/me/capabilities)
src/app/api/me/capabilities/route.ts   # uses mySeries
src/app/layout.tsx                     # drops PublicNav and Nav
src/app/(public)/layout.tsx            # renders PublicNav + Nav above the public wrapper
src/app/(admin)/layout.tsx, (door)/layout.tsx, dev/layout.tsx (NEW)   # render Nav
src/app/Nav.tsx                        # passes menuFor(actor) to the presenter
src/app/VolunteerNav.tsx               # REWRITTEN — coloured bar, groups, phone Menu (R3–R5)
src/app/VolunteerNav.module.css        # NEW (B55)
src/app/(admin)/volunteer/page.tsx     # NEW — the volunteer home page (+ .module.css)
src/app/(admin)/_components/AdminPage.tsx, .module.css   # `identity` retired (R6)
src/app/(admin)/bookings/page.tsx, contacts/page.tsx     # drop the identity prop
src/app/api/auth/google/callback/route.ts   # lands on /volunteer when no page was asked for
src/app/login/page.tsx (+ login.module.css NEW)   # the new sign-in page (R8)
src/app/(admin)/organizer/page.tsx     # NEW — redirects to the viewer's series (R9)
src/app/(admin)/organizer/[seriesKey]/page.tsx (+ organizer.module.css NEW)  # selector, print
src/app/_components/PrintBar.tsx (+ .module.css)   # NEW — shared Print / iPhone-Safari note (R10)
src/app/(admin)/treasurer/page.tsx, treasurer.module.css   # use PrintBar; shared print rules move

tests/unit/menuFor.test.ts, mySeries.test.ts, organizerLanding.test.ts, bars.test.ts   # NEW
tests/unit/volunteerStyle.test.ts      # + the new stylesheets
tests/integration/authz.nav.test.ts, auth.navCompleteness.test.ts, auth.callback.test.ts
tests/component/volunteerNav.test.tsx, nav.render.test.tsx, nav.stack.test.tsx
tests/component/volunteerHome.test.tsx, login.page.test.tsx, organizer.page.test.tsx   # NEW
```

**Structure Decision**: the existing single Next.js project. The grouping lives beside the
destination list in `src/server/auth/nav.ts`, where authorization already decides who sees what.
`PrintBar` joins the other shared pieces in `src/app/_components/`, because both reports use it.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| `menuFor(actor)` alongside `navItemsFor` | The grouping rules (six or fewer stay flat, empty groups vanish, a one-item group is a link) are logic the bar and the home page must share exactly, and should be tested without rendering | Doing it in the component would mean two copies, one for the bar and one for the home page |
| `mySeries(actor)` extracted | The own-series rule now has two users: `/api/me/capabilities` and the organizer landing | Copying it would let the gate report and the organizer report drift apart on the same rule (feature 086) |
| `PrintBar` (shared Print plus the iPhone-Safari note) | Both reports need the pinned Print, the note on iPhone Safari (B67) and the print-only-the-report rules | Duplicating it from the gate report would keep two copies of the iPhone Safari check and the hide-everything print rules |
