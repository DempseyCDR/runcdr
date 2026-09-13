# Phase 0 Research: Undo merge

Ten decisions. Two of them (R2, R4) were forced by facts found in the schema that the requirements
session did not have, and both widen the recording surface.

## R1 — The manifest lives on `merge_audit` as one `jsonb` column

**Decision**: add `reversal_manifest jsonb` to `merge_audit`, nullable. `NULL` means "recorded before this
feature" and is exactly the FR-007 un-reversible signal — no backfill, no flag column, no migration over
existing rows.

**Rationale**: the manifest is only ever written whole and read whole. Nothing queries "which merge moved
row X"; the undo loads one merge and replays it. A child table (`merge_audit_entries`, one row per moved
row) would buy per-row queryability nobody needs, at the cost of a second table, a join, and an ordering
concern — Principle II rejects it. Volume is trivial: the largest merge in the live data moves a few dozen
rows, so the manifest is a few kilobytes.

**Alternatives considered**: a child table (rejected, above); a separate `merge_manifests` table keyed to
`merge_audit` (rejected — a one-to-one table is a column); reconstructing from `audit_events` (rejected —
it records actions, not row identities, and D1 already settled that reconstruction is impossible).

## R2 — Rows are identified by their primary-key tuple, and the PK belongs in the classification

**Decision**: each manifest entry records the row's **primary-key tuple as it stands after the merge**, and
`contactReferences.ts` gains the primary-key columns for every `move` entry. Undo matches on that tuple and
sets the contact column back.

**Rationale**: the obvious design — "record the `id` of each moved row" — **does not work**.
`membership_members` has a composite primary key `(account_id, contact_id)` and **no `id` column** at all
([memberships.ts:44](../../src/server/db/schema/memberships.ts:44)). Worse, `contact_id` is half the key
*and* the column the merge rewrites, so the row's identity changes as it moves. Recording the PK tuple as
it stands **after** the move is the one representation that is uniform across both shapes: `{id}` for the
ten tables that have one, `{account_id, contact_id}` for the one that does not.

Putting the PK columns in `contactReferences.ts` rather than in the merge service is the same argument
feature 072 already won and wrote down there: the classification is the single place that states what a
merge does with each reference, it is compile-checked against Drizzle columns, and a parity guard tests it
against the live database. A table added later cannot be moved without declaring how its rows are named.

**Alternatives considered**: `ctid` (rejected — Postgres physical row addresses are invalidated by any
update, including the merge's own); adding a surrogate `id` to `membership_members` (rejected — a
migration on a live table to serve a feature that can use its real key); per-table bespoke undo code
(rejected — this is exactly the drift feature 072 eliminated).

## R3 — The undo is recorded in a new table, not by mutating `merge_audit`

**Decision**: a new `merge_reversals` table — `merge_audit_id` (unique), `actor`, `created_at`,
`restored_counts jsonb`, `skipped jsonb`. Its existence *is* the "already undone" fact (FR-010).

**Rationale**: FR-006 requires that undoing a merge not alter the record of that merge, so an
`undone_at` column on `merge_audit` is out. A separate append-only row satisfies FR-006 and FR-021 with
one structure, and gives FR-010 and the concurrency edge case for free — see R7.

**Alternatives considered**: `merge_audit.undone_at` (rejected — violates FR-006); inferring "undone" from
the contact's `merged_into_id` being null (rejected — ambiguous, and it loses who undid it and what was
skipped, which FR-021 requires).

## R4 — The account delete destroys household members by cascade, and nobody knew

**Decision**: snapshot the `membership_members` rows that disappear when the discarded membership account
is deleted. This is a **fifth** destruction, additional to the four D2 enumerated.

**Rationale**: `membership_members.account_id` is declared `onDelete: "cascade"`
([memberships.ts:38](../../src/server/db/schema/memberships.ts:38)). When the merge resolves a
`two_accounts` hold it copies the losing account's members onto the surviving account `ON CONFLICT DO
NOTHING`, then deletes the losing account ([mergeService.ts:354](../../src/server/domain/dedup/mergeService.ts:354)).
Every original row on that account is then cascade-deleted — silently, and *including* the ones the
`ON CONFLICT` skipped because that person was already on the surviving account. So the merge destroys rows
that no statement in the merge names. Without snapshotting them, an undo would restore the discarded
account with an empty household, and the members' original `attached_at` would be gone.

**Alternatives considered**: relying on the copy onto the surviving account to be reversible (rejected —
the `ON CONFLICT DO NOTHING` cases were never copied, so there is nothing to reverse them from);
`ON DELETE RESTRICT` on the cascade (rejected — changes live deletion behaviour well outside this feature).

## R5 — Order inside the undo transaction is load-bearing

**Decision**: fixed order — (1) move re-linked rows back, (2) delete rows the merge created, (3) re-insert
destroyed rows, (4) restore overwritten field values, (5) recompute both contacts' status, (6) clear
`merged_into_id`.

**Rationale**: two partial unique indexes make the naive order fail.
`contact_emails_one_login_per_contact` ([0020_staff_auth.sql:44](../../src/server/db/migrations/0020_staff_auth.sql))
permits one sign-in address per contact, so restoring the cleared `is_login` flag **before** the addresses
move back would briefly put two login addresses on the survivor and abort the transaction. Likewise
`staff_identities.contact_id` is unique ([auth.ts:16](../../src/server/db/schema/auth.ts:16)), so a deleted
identity must not be re-inserted until the moved one has left the survivor. Moving first and restoring
flags last makes both safe without deferring any constraint.

**Alternatives considered**: `SET CONSTRAINTS DEFERRED` (rejected — these are unique *indexes*, which are
not deferrable in Postgres); dropping and recreating the index around the undo (rejected, obviously).

## R6 — Skip semantics are per-entry and reported, and never silent

**Decision**: each manifest entry is attempted independently. An entry whose row no longer exists, or whose
re-insertion would violate a constraint, is skipped and added to a `skipped` list with a machine-readable
reason (`gone`, `occupied`, `not_authorized`). The transaction still commits (FR-018, FR-019 — all-or-
nothing applies to the *undo*, not to the individual entries it could not perform).

**Rationale**: D3. A merge from last week will nearly always have at least one entry that has since moved
on, and refusing the whole reversal for it would make undo unavailable precisely in the cases it exists
for. The reason codes matter because FR-020 and SC-006 require the operator be told *what* was not
restored — a bare count would not let Mel decide whether to fix it by hand.

**Alternatives considered**: abort on any skip (rejected, above); skip silently (rejected — violates
SC-006, and a silent partial restore is the failure mode that would destroy trust in the feature).

## R7 — Concurrency is handled by the unique constraint, not by locking

**Decision**: `merge_reversals.merge_audit_id` is `UNIQUE`. Two simultaneous undos race to insert; one
commits, the other fails the constraint and is reported as already undone.

**Rationale**: the check-then-act on FR-010 is a classic race, and the database already has the right
primitive. An advisory lock or `SELECT … FOR UPDATE` on the merge row would work too but adds a mechanism
where a constraint suffices. Single-admin club scale makes the race vanishingly rare regardless; the
constraint costs nothing and removes it entirely.

## R8 — The sign-in gate is applied per-entry, inside the same undo

**Decision**: manifest entries touching `staff_identities`, and the `contact_emails.is_login` overwrite
that labels them, carry a flag marking them access-changing. When the actor lacks `role.assign`, those
entries are skipped with reason `not_authorized` and the rest of the undo proceeds (FR-025).

**Rationale**: D6 gates the grant; D3 forbids letting one blocked entry sink the whole reversal. Applying
the gate at the entry level satisfies both with no new outcome shape. Note the gate is wider than D6 as
originally stated: **moving a binding back** changes who can sign in just as much as **re-creating a
deleted one**, so both are gated, not only the re-creation.

**Why this is a guard and not a repair path — CORRECTED 2026-09-12, it is weaker than first stated.**
The original reasoning was that `resolveSignIn` auto-enrols, so a person whose binding was left behind
re-enrols against the restored contact on next sign-in. **That holds only for a DIFFERENT Google
account.** `signIn.ts` checks the known `google_sub` FIRST and the binding wins: if that sub still points
at the survivor, sign-in is refused there and never reaches enrolment. So the same person, on the same
Google account, is NOT repaired automatically.

Skipping remains the right response to missing authority — refusing the whole reversal would be worse,
and everything non-sign-in still comes back — but the report must be read as real unfinished work, not a
formality. An undo that skipped a sign-in entry needs a `role.assign` holder to finish it. The test for
this asserts only the accurate, weaker claim (it enrols a *new* sub); the prose here was what
overstated it.

## R9 — The reversibility verdict is computed, never stored

**Decision**: a single function returns one of `reversible` or a specific refusal — `no_manifest`,
`survivor_merged`, `contact_archived`, `already_undone` — and both the history view and
the undo route call it. The route re-checks inside its transaction.

**Rationale**: a stored flag would go stale the moment the survivor is merged again or a contact is
archived, and FR-028 requires the *reason*, not just a boolean. One function shared by the read path and
the write path is what stops the two from disagreeing — the exact failure mode feature 072 hit when the
held-merge auto-close and the merge detection asked subtly different questions and produced a hold that
reopened forever.

**Superseded in part by feature 077 (2026-09-13):** the conclusion below still holds — a merge record never outlives its contacts, so there is no "contact is gone" verdict — but the reason changed. `merge_audit`'s contact keys are now `ON DELETE CASCADE`, so deleting a contact deletes its merge records rather than being refused. See the Mel Maintenance close-out list §2c and migration 0048.

**Corrected at `/speckit-analyze`**: this decision originally listed a sixth verdict, `contact_missing`,
for a merge whose retired contact no longer exists. It is unreachable. `merge_audit.canonical_id` and
`merged_id` are `REFERENCES contacts(id)` with no `ON DELETE`
([0003_dedup.sql:5-6](../../src/server/db/migrations/0003_dedup.sql)), so the database permanently refuses
to delete either contact a merge record names. The tell was in the task list: T012 asked for a test
produced by "the condition that should produce it", and no such condition can be arranged. Removed under
Principle II rather than carried as a defensive branch nobody can exercise.

A separate, **pre-existing** gap was found while confirming this, and is not in scope here:
`CONTACT_DELETE_BLOCKERS` ([contactService.ts:506](../../src/server/domain/contacts/contactService.ts))
does not include merge participation, so a retired shell — stripped of everything by the merge — presents
as bare, is offered for deletion, and then fails on the foreign key with a raw Postgres error instead of
Mel's designed refusal. That is the failure class feature 069 exists to eliminate, and it wants its own
fix.

## R10 — Three questions settled while writing the spec, recorded here

| Question | Settled | Why |
|---|---|---|
| Rows the merge **creates** — covered? | Yes, newly: FR-004/FR-016 | The account fold *inserts* household members onto the surviving account. D2 covered destroyed rows only; without this the survivor keeps members it never had. |
| Does an undo mark the pair "not duplicates"? | No | Undoing because the merge ran the wrong way round is an expected primary use; a rejection would block the immediate re-merge. The existing reject control remains available. |
| Is the sign-in gate load-bearing? | No — see R8 | Auto-enrolment repairs a skipped entry, so the gate protects a deliberate grant without stranding anyone. |

All three were presented to Rich at the end of `/speckit-specify` and carried forward unchallenged.
