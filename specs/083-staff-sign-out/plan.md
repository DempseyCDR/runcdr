# Implementation Plan: A sign-out control for staff

**Branch**: `083-staff-sign-out` | **Date**: 2026-09-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/083-staff-sign-out/spec.md`

## Summary

Backlog **B53**: the server can end a session but nothing in the app asks it to. Feature 015 built
`POST /api/auth/signout` — it deletes the session row, clears the cookie, logs `auth.signout` and
redirects to `/` — and it is unreachable.

This feature adds the missing control to the **volunteer menu**: the signed-in volunteer's name, and a
**Sign out** button that submits a plain form to that route. The volunteer menu already renders on every
page from the root layout *when someone is signed in* and nowhere else, so one control covers every page a
volunteer works on, needs no new authorization, and disappears for anonymous visitors on its own.

**No server change.** Phase 0 confirmed the route, the audit entry and the display name all exist already.
The work is one server prop, one client control, and the tests that hold them.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19, Next.js 16 App Router

**Primary Dependencies**: none new

**Storage**: PostgreSQL 16 via Drizzle — read only here (`staff_sessions` is deleted by the existing route)

**Testing**: Vitest — component tests in jsdom, integration tests against real Postgres

**Target Platform**: the club's volunteers on a phone at the door, and on a laptop

**Project Type**: web application (one Next.js app; `src/app` + `src/server`)

**Performance Goals**: none beyond the existing page render — the control adds no request

**Constraints**: touch target ≥ 2.75rem (the project's phone minimum); the control must work without
JavaScript, as the surrounding navigation does; the site menu's "no authorization decision" rule
(features 034/046) stays intact

**Scale/Scope**: two files changed, three test files — tens of volunteers, one session each

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this feature satisfies it |
|---|---|
| **I. Test-First** | Every change is driven by a failing test first: the presenter's control and name (component), the server loader passing the name (component), and the route ending a session so the next request is refused (integration). The Back-button and unsaved-work behaviours are browser facts, so they are quickstart steps rather than pretend tests. |
| **II. Simplicity / YAGNI** | No new route, no new table, no new component file, no helper: a form and a name inside the nav that already renders. Signing every device out, and ending someone else's session, are explicitly out of scope. |
| **III. Type Safety** | The name is a `string` prop on the existing presenter; no casts, no `any`. The server component already holds `Actor`, whose `staff.displayName` is typed. |
| **IV. Observability** | `destroySession` already writes the structured `auth.signout` entry, at the same log-only level as `auth.signin` (research R3). Nothing new to instrument; no `console.log` added. |

**Result: PASS.** Re-checked after Phase 1 — still PASS; the design adds no abstraction and no dependency,
and the Complexity Tracking table stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/083-staff-sign-out/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── sign-out.md      # Phase 1 output — the route and the menu contract
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # /speckit-tasks — NOT created here
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── Nav.tsx                      # CHANGED: passes the signed-in name to the presenter
│   ├── VolunteerNav.tsx             # CHANGED: renders "Signed in as …" and the Sign out form
│   ├── layout.tsx                   # unchanged — already renders <Nav/> on every page
│   ├── PublicNav.tsx                # unchanged — FR-010 leaves the site menu alone
│   └── api/auth/signout/route.ts    # unchanged — feature 015 (POST, 303 → "/")
└── server/auth/
    ├── currentStaff.ts              # unchanged — getActor() is already the null-safe loader
    └── session.ts                   # unchanged — destroySession deletes + audits

tests/
├── component/
│   ├── volunteerNav.test.tsx        # CHANGED: the control, the name, the form's method and action
│   ├── nav.stack.test.tsx           # CHANGED: the new required prop
│   └── nav.render.test.tsx          # CHANGED if it renders the presenter
└── integration/
    └── auth.signout.test.ts         # NEW: the session ends; the next request is refused
```

**Structure Decision**: the existing app structure is unchanged. The volunteer menu is a server loader
(`Nav.tsx`, authorization stays on the server) feeding a client presenter (`VolunteerNav.tsx`, which needs
`usePathname` for active state). The control belongs in the presenter; the name it shows comes from the
loader as a prop, so the presenter still makes no authorization decision.

## Phase 0 — Research

See [research.md](./research.md). Six questions, all resolved; the load-bearing findings:

- **R1** The volunteer menu renders on **every** page when signed in — including public ones — so FR-001
  is met without touching the site menu, and the spec's assumed cost ("walk back to a staff page") does
  not exist. The spec is corrected.
- **R3** `destroySession` already logs `auth.signout`, matching sign-in's level. **FR-009 needs no work** —
  which retires the risk flagged when the spec was written.
- **R5** A plain `<form method="post">` to the route is what makes FR-006 hold and keeps the control
  working without JavaScript. No `fetch`, no client state.

## Phase 1 — Design

- [data-model.md](./data-model.md) — no schema change; what the session and the menu carry.
- [contracts/sign-out.md](./contracts/sign-out.md) — the unchanged route contract and the new menu
  contract (what renders, for whom, and what it submits).
- [quickstart.md](./quickstart.md) — the automated gates, then the manual pass: the hand-over on a phone,
  the Back button, the unsaved-gate warning, and the anonymous case.

## Complexity Tracking

> No constitution violations. Table intentionally empty.
