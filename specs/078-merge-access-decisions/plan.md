# Implementation Plan: Merge access decisions

**Branch**: `078-merge-access-decisions` | **Date**: 2026-09-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/078-merge-access-decisions/spec.md`

## Summary

The last items on the Mel Maintenance close-out list: a screen to answer a held merge, and two new reasons a
merge must hold. A volunteer merged into a non-volunteer is held for an officer, who may carry volunteer
status across. A super-user merged into anyone but a super-user is held with no in-app answer at all.

Research turned up one fact that shapes the whole design. The merge re-checks **every** obstacle on each
attempt, so a retry needs every earlier answer, and those answers come from different people at different
times. So answers accumulate **on the hold** (research R2). That is also the fix for the pair that gets
stuck showing a question already answered: today the hold keeps its first reason forever.

The second pillar is one detection function (research R1). It is shared by the merge, the chooser's read and
the auto-close, which is how feature 072's drift between the last two is kept from recurring for the new
reasons.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), Node 24, pnpm

**Primary Dependencies**: Next.js 16 (App Router), React 19, Drizzle ORM, Zod

**Storage**: PostgreSQL 16. Hand-written SQL migrations, applied lexically. Next migration **0049**

**Testing**: Vitest — real-Postgres integration tests and jsdom component tests

**Target Platform**: Node server; development on localhost

**Project Type**: Web service with an admin UI (single Next.js app)

**Performance Goals**: Not a factor. A handful of held merges exist at any time; detection runs a few small
queries per pair

**Constraints**: A held merge writes nothing but its own hold row (feature 069). The volunteer carry
happens inside the merge transaction and is recorded in the reversal manifest (feature 074). A super-user
hold must be unanswerable for everyone in the app

**Scale/Scope**: 2 new hold reasons, 1 new column, 1 new route, 1 new UI component; the audit of access
rules (FR-016) is closed in research R7 with no further rule found

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Assessed against constitution **v1.4.0**.

| Principle | Assessment |
|---|---|
| **I. Test-First (NON-NEGOTIABLE)** | PASS. Every requirement is testable against a real database: each reason held and answerable only by its authority; answers accumulating across two actors; stale answers dropped; super-user refused for everyone and auto-closed by a command-line grant; the volunteer carry reversed by undo. The chooser gets component tests per reason. |
| **II. Simplicity / YAGNI** | PASS. One column (`answers`) instead of a table per decision, justified by a real need: answers from different people must survive between attempts. The detection function is an extraction of existing code, not a new layer, and it deletes the SQL `two_accounts` sweep it replaces. No new capability, page or table. |
| **III. Type Safety** | PASS. Stored answers parsed with Zod on read; the held reason stays a Postgres enum mirrored by a Drizzle union; `answerableBy` is a closed union. |
| **IV. Observability** | PASS. Every hold, reason change, answer, abandonment and volunteer carry is audited, the carry under the existing `volunteer.designated` kind so the access history stays whole. |

**Development Workflow**: single-contributor mode. Branch and PR mandatory; the author merges; the full gate
suite is the only reviewer.

**Result: no violations.** Complexity Tracking is empty and omitted.

**Post-design re-check**: still PASS. Phase 1 added no table, capability or page. The contract reuses the
existing resolve route and error shape; `GET /api/dedup/held/{id}` is the only new route.

## Project Structure

### Documentation (this feature)

```text
specs/078-merge-access-decisions/
├── spec.md                        # /speckit-specify, with Clarifications
├── plan.md                        # this file
├── research.md                    # Phase 0: 10 decisions, incl. the access-rule audit (R7)
├── data-model.md                  # Phase 1
├── quickstart.md                  # Phase 1: manual pass on throwaway contacts
├── contracts/
│   └── held-merge-chooser.md      # Phase 1
├── checklists/
│   └── requirements.md            # /speckit-specify
└── tasks.md                       # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
src/server/db/
├── migrations/0049_merge_access_holds.sql   # NEW: two reason values + held_merges.answers
└── schema/dedup.ts                          # enum values, answers column

src/server/domain/dedup/
├── mergeService.ts                          # detectHold extracted; super_user + volunteer_status checks;
│                                            # carryVolunteer applied and recorded in the manifest
└── heldMergeService.ts                      # answers accumulate; reason kept current; detail read;
                                             # authorityFor gains role.assign + command_line; auto-close
                                             # via detectHold (SQL two_accounts sweep removed)

src/server/validation/dedup.ts               # carryVolunteer in heldResolveSchema
src/server/lib/apiError.ts                   # HELD_MERGE_NOT_ANSWERABLE, HELD_MERGE_STALE

src/app/api/dedup/held/
├── route.ts                                 # list gains answerableBy + canAnswer
└── [id]/route.ts                            # NEW GET: the hold's current question

src/app/(admin)/contacts/
├── _components/HeldMergeChooser.tsx          # NEW: one chooser, a panel per reason
└── page.tsx                                  # Resolve opens the chooser; client authority copy removed

tests/integration/
├── dedup.heldMergeDecisions.test.ts         # NEW: new reasons, accumulation, stale answers, auto-close
└── dedup.heldMerge.test.ts                  # extended: detectHold agreement, authority per reason
tests/component/
└── contacts.heldMergeChooser.test.tsx       # NEW: a panel per reason, waiting vs answerable
```

**Structure Decision**: the existing dedup domain, where the merge, the holds and the undo already live. The
chooser is one component, following the pattern of `MergeCompare` and `MergeHistory`, opened from the
review queue that already lists holds.

## Design notes carried into tasks

These are settled by research, not to be re-decided during implementation:

- **`detectHold` is the only detector.** The merge, the detail read and the auto-close all call it. No SQL
  or client copy of any rule.
- **Detection order**: `super_user`, `two_accounts`, `volunteer_status`, `two_logins`, `role_conflict`
  (revised after the manual pass — research R4).
  The unanswerable goes first; the existing three keep their relative order.
- **Super-user is checked on the pair, not on moving grants.** A role-conflict answer that leaves super-user
  behind does not satisfy it (research R5).
- **No answer completes a volunteer hold without carrying.** Declining is Don't merge.
- **The carry writes three `accessChanging` overwrites** to the manifest, so undo reverses it under 074's
  existing authority rule.
- **The resolve body answers the current reason only.** The server supplies the rest from `answers`.
- **An answer settles its question only if valid for the pair now, judged inside `detectHold`**
  (research R3, corrected at analyze). `mergeContacts` also refuses a surviving account outside the pair —
  otherwise a stale answer could delete both of the pair's accounts.
- **Holds are visible to `dedup.write` or `role.assign`** through one `canSeeHolds` check on the four
  held-merge routes, which declare `requires: "base"` (research R11). A President could see no hold before.
- **The bootstrap CLI also makes its contact a volunteer.** So granting super-user there clears a volunteer
  hold on the same pair too. That is correct, and the quickstart notes it.

## Deliberately not in this feature

- A command-line way to *remove* super-user. The tool grants only, and the spec does not need removal.
- Keeping answers when an obstacle is removed some other way. Such a hold closes, as holds already do; a
  hold records a question, not a pending merge.
- Any change to what a merge moves, or to deleting contacts (feature 077).

## Verification

- **Automated gates (T039)**: migrate, typecheck, lint and prettier on changed files, the full suite
  (1392 tests / 321 files), `pnpm build` and `pnpm lint:md` — all clean.
- **Manual pass (T040), 2026-09-14**: Rich walked quickstart §1–§7 and confirmed every section passes.
  Three findings along the way, each fixed and re-walked:
  - A President could not reach a held merge from the duplicates queue, and the comparison's merge buttons
    failed silently for her — FR-017, tasks T041–T044.
  - On a pair needing two decisions, Mel's question waited on the officer's — detection reordered,
    research R4, task T045.
  - The quickstart's cleanup could not delete contacts that pay for a membership account — corrected to
    delete the accounts first.
