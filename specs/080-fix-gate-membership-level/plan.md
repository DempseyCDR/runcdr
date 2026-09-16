# Implementation Plan: Gate membership-level fix

**Branch**: `080-fix-gate-membership-level` | **Date**: 2026-09-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/080-fix-gate-membership-level/spec.md`

## Summary

The gate page learns the membership level. The server has been ready since feature 068: the gate-sales PUT
requires `membershipLevel` on every membership line, stores it, and opens or renews the account at it, and
the door-record reload already returns the stored level. Only the page was never updated.

So this is a page fix plus one small shared constant:

- each membership line gets a level choice, with nothing preselected;
- the save sends it, and refuses to send a membership line without one, naming the sale;
- reopening an evening puts the stored level back on the line;
- a refused save shows the server's reason and says what was and was not saved.

No migration, no route, no service change.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node 24, pnpm

**Primary Dependencies**: Next.js 16 (App Router), React 19, Zod

**Storage**: PostgreSQL 16 — unchanged. `gate_sales.membership_level` exists since migration 0043

**Testing**: Vitest — jsdom component tests for the page; one real-Postgres integration test extended so
the reload payload's level is covered

**Target Platform**: Node server; the gate page in a browser

**Project Type**: Web service with admin and door UIs (single Next.js app)

**Performance Goals**: none new — the save makes the same two requests

**Constraints**: the save order stays sales, then money (spec Assumptions). `putGateSales` is replace-all,
so every saved membership line must carry its level on every save. Gate money is `gate.write`, event-scoped

**Scale/Scope**: 1 page changed, 1 new shared constant module (`src/app/membershipLevels.ts`) also used by
`MembershipAccount.tsx`, 2 test files extended, 1 new component test file

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Assessed against constitution **v1.4.0**.

| Principle | Assessment |
|---|---|
| **I. Test-First (NON-NEGOTIABLE)** | PASS. The level choice, the send, the guard, the reload and the three save messages each get a failing jsdom test first. The server half of FR-005 — the reload payload carries the level — is asserted against a real database. FR-003/FR-004 are already covered by `gate.membershipLevel.test.ts` (068). |
| **II. Simplicity / YAGNI** | PASS. No server change. The level list is shared rather than copied a second time. The save order is kept (research R4); the named-sale dialog and gate rebuild stay in the later feature. |
| **III. Type Safety** | PASS. The shared level list is checked against the database enum's type at compile time (research R2). The line's level is typed as the enum or empty, never a free string. |
| **IV. Observability** | PASS. Unchanged: a refused PUT is already logged server-side with its request ID, and a door enrollment already writes `membership.door_enrollment`. |

**Development Workflow**: single-contributor mode. Branch and PR mandatory; the author merges; the full gate
suite is the only reviewer.

**Result: no violations.** Complexity Tracking is empty and omitted.

**Post-design re-check**: still PASS. Phase 1 added no route, capability or table.

## Project Structure

### Documentation (this feature)

```text
specs/080-fix-gate-membership-level/
├── spec.md                  # /speckit-specify
├── plan.md                  # this file
├── research.md              # Phase 0: 6 decisions
├── data-model.md            # Phase 1: no schema change; the page's line shape
├── quickstart.md            # Phase 1: automated gates + a manual pass
├── contracts/
│   └── gate-save.md         # Phase 1: the existing routes as the page uses them, and the UI contract
├── checklists/
│   └── requirements.md      # /speckit-specify
└── tasks.md                 # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
src/app/
├── membershipLevels.ts                       # NEW: MEMBERSHIP_LEVELS, type-checked against the enum
├── (door)/gate/page.tsx                      # level choice, send, guard, reload, save messages
└── (admin)/contacts/_components/MembershipAccount.tsx  # uses MEMBERSHIP_LEVELS instead of its own copy

tests/integration/
└── doorRecord.reload.test.ts                 # extended: the reload returns the stored level
tests/component/
├── gate.membershipLevel.test.tsx             # NEW: choice, send, guard, reload keeps level, messages
└── gate.reload.test.tsx                      # updated: the saved membership line carries a level
```

**Structure Decision**: the gate page stays one file; the later `/gate` feature rebuilds it into
components. The level list moves to `src/app/`, beside `localToday.ts`, because both the door and admin
route groups use it.

## Design notes carried into tasks

Settled by research, not to be re-decided during implementation:

- **No server change.** The Zod refinements, storage, enrollment and reload are already right. The
  enrollment's `?? "individual"` fallback is unreachable through the route and is left alone (research R6).
- **The level is a `<select>` on each membership line**, first option empty ("Level…"), labelled with the
  payer's name. Donation and future-event lines render no level control.
- **The guard runs before any request.** It checks only the lines the save would send (amount > 0), marks
  each offending line `aria-invalid` through a per-line flag (so removing a line never moves a mark), and
  names the payer: "Choose a level for Jane Doe's membership. Nothing was saved." With several: "Choose a
  level for each membership: {names}. Nothing was saved."
- **Messages** (research R3):
  - sales refused → "Nothing was saved: {reason}";
  - sales saved, money refused → "Sales saved, but the money figures were not: {reason}", with any
    membership recorded named too;
  - a 403 keeps today's wording;
  - a request that never reaches the server is reported the same way, with "Could not reach the server" as
    the reason.
- **`{reason}` is the server's `error.message`**, falling back to the HTTP status when the body has none.
- **Reload** copies `membershipLevel` from each stored sale onto its line; a line that somehow has none
  shows the empty choice and the guard catches it.

## Deliberately not in this feature

- The named-sale dialog shared with `/checkin`, and saving named sales one at a time (MARY-R8, MEG-R11).
- Reordering the save, the mobile-first rebuild, live results, warnings after save and the counting dialog
  (MARY-R15, MARY-R16).
- Inferring a level from the amount (068 rejected it) or preselecting one.
- Anything on `/payments`.

## Verification

- **Automated gates (T014), 2026-09-16**, with no dev server running: `pnpm db:migrate` (nothing new),
  `pnpm tsc --noEmit`, the full suite (1466 tests / 325 files), eslint and prettier on the changed files,
  `pnpm build` and `pnpm lint:md` — all clean.
- **Test-first check**: the 10 new behaviour tests in `gate.membershipLevel.test.tsx` failed before the page
  change. The reload assertions (T009) were written after the reload change (T010), so the change was
  reverted, the three reload tests seen to fail, and the change restored. Removing a level from
  `MEMBERSHIP_LEVELS` fails the type check.
- **Browser check**: not done by Claude — the browser pane was refused `localhost:3000`. The manual pass
  covers the page instead.
- **Manual pass (T015), 2026-09-16**: Rich walked quickstart §1–§6 on his dev server — the guard, recording a
  Family membership, no level on a donation, reload, a second save keeping the level, and the money-refused
  message — and confirmed they pass, then ran the cleanup.
