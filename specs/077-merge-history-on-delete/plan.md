# Implementation Plan: Merge history on delete

**Branch**: `077-merge-history-on-delete` | **Date**: 2026-09-13

**Input**: [spec.md](./spec.md), from Mel Maintenance close-out list §2c
(`specs/phase-8-requirements/mel-maintenance-remaining.md`), whose finding was confirmed against the test
database and whose direction was decided on 2026-09-13. Manual validation: [quickstart.md](./quickstart.md).

The spec and quickstart were written after this plan and the implementation, at Rich's request, when it was
noticed that 077 had only a plan. They describe the behaviour the tests already assert.

## Summary

A contact that had ever been in a merge could never be deleted. `merge_audit` referenced both contacts
with no delete rule since feature 003, the delete check did not know that, and so:

- **A.** a merged-away contact passed the check as bare and failed with a raw foreign-key error;
- **B.** after an undo, **both** contacts were live and bare, and both failed the same way — the reachable
  case, made so by feature 074;
- **C.** the unrestricted delete removed the membership account, then failed, leaving it gone.

Undo is a short-term recovery; the merge record pinned both contacts forever.

## Decisions (2026-09-13)

1. A contact's merge records are deleted with it, and each merge's reversal with its merge:
   `merge_audit.canonical_id` / `merged_id` and `merge_reversals.merge_audit_id` → `ON DELETE CASCADE`,
   matching `held_merges` and `dedup_rejections`.
2. Deleting a survivor deletes the contacts merged into it: `contacts.merged_into_id` →
   `ON DELETE CASCADE`, **never** `SET NULL` (a null `merged_into_id` marks a contact active). The delete
   must say when a survivor has absorbed others, since a mistaken merge may hold a different person.
3. The delete runs in one transaction.
4. **Anyone who has ever acted as staff is never deleted.** The five actor references keep refusing; the
   refusal is made clean.

## Technical approach

- **Migration 0048** re-creates the four foreign keys with `ON DELETE CASCADE`. The Drizzle schema is
  aligned, with the no-`SET NULL` warning on `contacts.mergedIntoId`.
- **`CONTACT_DELETE_BLOCKERS`** gains `merged_contacts` (safe path only) and `staff_history` — the five
  actor references, flagged `always` so the unrestricted path cannot bypass them.
- **Interpretation of decision 2:** "the delete must say so" is met by refusing the SAFE delete of a
  survivor with merged-in contacts, naming them and advising undo first; the unrestricted delete takes the
  chain. This reuses the existing safe/unrestricted split rather than adding a confirmation flow.
- **Found while implementing:** `staff_history` is checked across the contact **and its whole merged-in
  chain** (recursive CTE). Deleting a survivor cascades into its merged-in contacts, one of which may have
  acted as staff — so checking only the target would let the cascade reach a staff actor and fail raw.
- **`deleteContact`** runs in one transaction, and the refusal wording gives advice by reason: staff →
  archive; merged-in contacts → undo first or archive; otherwise unchanged.
- **Parity guard:** reads `pg_constraint` for every reference into `contacts` that refuses a delete and
  fails if the delete check does not know it — and names the one the unrestricted path clears instead
  (`membership_accounts.payer_contact_id`), so a new blocking reference forces a decision.
- Comments and 074 docs that said the database permanently refuses such deletes are corrected; 074's
  shipped docs get a dated "superseded in part" note rather than a rewrite.

## Constitution Check (v1.4.0)

| Principle | Assessment |
|---|---|
| **I. Test-First** | PASS — every behaviour lands as a failing test first: cases A/B, the safe refusal and unrestricted chain delete of a survivor, both staff refusals including via the chain, the parity guard, and atomicity. Atomicity is tested against the real database with no mocks: an actor that is not a contact makes the audit write fail after the account delete, and the test asserts nothing was left half-done. |
| **II. Simplicity / YAGNI** | PASS — no new table, route, capability or UI flow. The survivor warning reuses the existing refusal path. One `always` flag on the existing blocker list. |
| **III. Type Safety** | PASS — the blocker list stays a typed `as const` over Drizzle columns. |
| **IV. Observability** | PASS — deletions still write `contact.deleted`, now atomically with the delete itself. |

**Development Workflow**: single-contributor mode. Branch and PR mandatory; the author merges; the full gate
suite is the only reviewer.

## Verification

- Gate suite: 318 files, 1332 tests passing; tsc, eslint, prettier, markdownlint and the production build
  clean.
- **Manual pass**: every walkable section of [quickstart.md](./quickstart.md) (§1–§5) confirmed by Rich on
  2026-09-13 against the dev database, signed in as the mailing-list manager and as a super-user. §6 (a
  delete failing part-way) is covered by the automated suite only.
