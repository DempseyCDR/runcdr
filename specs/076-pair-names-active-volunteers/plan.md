# Implementation Plan: Pair names and active volunteers

**Branch**: `076-pair-names-active-volunteers` | **Date**: 2026-09-13

**Input**: two items from the Mel Maintenance close-out list
(`specs/phase-8-requirements/mel-maintenance-remaining.md`), both small display fixes with their rules
already agreed. No `spec.md`: there are no open requirements to specify, and the list records the finding
and the agreed rule for each.

## Summary

1. **Names in a proposed duplicate pair** (found walking feature 069's quickstart manual pass). Pairing
   runs on first + last, but the pair showed only each contact's display name, so a custom display name
   ("Peggy CDR") could hide the very name the pair was proposed on ("Peggy Dempsey"). Rule, as agreed:
   the display name is the header; first + last is shown beneath it **only** when the display name is
   custom; no "(custom)" marker; the same rule in the queue row and the comparison modal.
2. **Close-out §2b.** `listVolunteers` had no active-contact filter, so the access page listed contacts
   that had been merged away (showing no roles) or archived.

Plus the close-out list itself: today's confirmations (069 manual pass done, M-R16 telemetry confirmed on
mobile) and the order for what remains.

## Technical approach

- `suggestionService`: select `first_name`, `last_name`, `display_name_override` per side, carried on
  `MergeSuggestionContact`. Names are not PII, so `projectSuggestion` keeps them — asserted.
- One shared `PairContactName` component renders the header and the conditional name line, used by both
  `DuplicatePair` and `MergeCompare`, so the two surfaces cannot drift apart. "Custom" means
  `display_name_override` is set — the same test the record editor uses for Custom vs Automatic.
- `listVolunteers`: add `merged_into_id IS NULL AND archived_at IS NULL`, the predicate feature 071 added
  at session read and feature 072 at sign-in enrolment.

No migration, no new route, no new capability.

## Constitution Check (v1.4.0)

| Principle | Assessment |
|---|---|
| **I. Test-First** | PASS — failing tests first for each: the pair carries all three names (integration); the name line appears for a custom display name and not for an automatic one, in both the row and the modal (component); merged and archived volunteers are left off the list (integration); projection keeps the names. |
| **II. Simplicity / YAGNI** | PASS — one small shared component, justified by the explicit requirement that the two surfaces follow one rule. No new abstraction beyond it. |
| **III. Type Safety** | PASS — the new fields extend the existing typed projection; the component takes a `Pick<>` of it. |
| **IV. Observability** | PASS — no new write path; nothing to audit. |

**Development Workflow**: single-contributor mode. Branch and PR mandatory; the author merges; the full gate
suite is the only reviewer.

## Deviations

- **One copy fix beyond the two items.** The comparison modal still said a merge "cannot be undone from
  here", while feature 074 added "Either can be undone afterwards" to the queue row one click earlier.
  Corrected to name where the undo lives, with an assertion, since this feature requires the row and the
  modal to agree.

## Verification

- Gate suite: 317 files, 1323 tests passing; tsc, eslint, prettier, markdownlint and the production build
  clean.
- **Browser**: the name display in the duplicates row and the comparison confirmed by Rich on
  2026-09-13, signed in as staff.
