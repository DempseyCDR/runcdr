# Phase 1 Data Model: Undo merge

## Schema changes

### `merge_audit` — one new column

| Column | Type | Notes |
|---|---|---|
| `reversal_manifest` | `jsonb` NULL | Everything needed to reverse this merge. `NULL` means recorded before this feature and therefore permanently un-reversible (FR-007). No backfill. |

The table stays append-only. Nothing in the undo path writes to it.

### `merge_reversals` — new table

One row per undo. Its existence is the "already undone" fact (FR-010).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `merge_audit_id` | `uuid` NOT NULL **UNIQUE** → `merge_audit(id)` | The uniqueness is load-bearing: it settles the concurrent-undo race without a lock (research R7). |
| `actor` | `text` NOT NULL | Who reversed it. |
| `restored_counts` | `jsonb` NOT NULL DEFAULT `{}` | Per table, how many entries were applied. |
| `skipped` | `jsonb` NOT NULL DEFAULT `[]` | Every entry not applied, with its reason (FR-018, FR-021, SC-006). |
| `created_at` | `timestamptz` NOT NULL DEFAULT now() | |

Append-only, like every other audit table in the project.

### `contact_references` classification — each `move` entry gains its key

Not a schema change; a change to the typed constant in
`src/server/domain/dedup/contactReferences.ts`. Every `move` entry declares the columns that identify one
of its rows:

```ts
pk: AnyPgColumn[];   // required on every `move`; asserted by the existing parity guard
```

Ten of the eleven moved references are `[table.id]`. The exception is the reason this field exists:

| Reference | Primary key |
|---|---|
| `membership_members.contact_id` | `[membershipMembers.accountId, membershipMembers.contactId]` |
| all ten others | `[<table>.id]` |

## The reversal manifest

Stored whole in `merge_audit.reversal_manifest`, parsed with Zod on read so a manifest written under an
older shape cannot be silently misread.

```text
{ version: 1, entries: ManifestEntry[] }
```

`ManifestEntry` is a discriminated union on `kind`. Every entry names the `table` it concerns, and every
entry that identifies an existing row carries `key` — the primary-key tuple **as it stands after the
merge**, which is the only identification that survives `membership_members` having its `contact_id`
rewritten as part of its own key (research R2).

| `kind` | Carries | Reverses by |
|---|---|---|
| `move` | `table`, `column`, `key`, `fromContactId` | Setting `column` back to `fromContactId` where the key matches. |
| `create` | `table`, `key` | Deleting the row with that key. |
| `destroy` | `table`, `row` (the complete prior row, including its key) | Re-inserting the row as it was. |
| `overwrite` | `table`, `key`, `column`, `previousValue` | Setting `column` back to `previousValue`. |

Any entry may additionally carry `accessChanging: true`, which marks it as altering who can sign in and
subjects it to the `role.assign` gate (FR-024, research R8). It is set on `staff_identities` entries of
every kind, and on the `contact_emails.is_login` overwrite that labels them.

### What each merge operation contributes

| Merge operation | Entry produced |
|---|---|
| The generic relink loop, per moved row | `move` |
| `role_grants` relink, per moved grant | `move` |
| `staff_identities` move (uncontested) | `move`, `accessChanging` |
| `staff_identities` delete (contested) | `destroy`, `accessChanging` |
| `contact_emails.is_login` cleared on the address not chosen | `overwrite`, `accessChanging` |
| Household members copied onto the surviving account | `create`, one per inserted row |
| Discarded `membership_accounts` row deleted | `destroy` |
| Household members lost to that delete **by cascade** | `destroy`, one per row (research R4) |
| Duplicate `membership_members` dropped on collision | `destroy` |
| Duplicate `attendance` dropped on collision | `destroy` |

The cascade row is the one with no corresponding statement in the merge: the rows vanish because
`membership_members.account_id` is `ON DELETE CASCADE`, so they must be read and snapshotted *before* the
account is deleted.

## The undo outcome

Returned by the service and stored in `merge_reversals`.

```text
{ restored: Record<table, number>, skipped: SkippedEntry[] }
```

`SkippedEntry` carries the entry's `kind`, `table`, its `key` where it had one, and a machine-readable
`reason`:

| `reason` | Meaning |
|---|---|
| `gone` | The row no longer exists — deleted after the merge. Nothing to return. |
| `occupied` | Re-inserting or returning it would collide with a row that exists now, e.g. the person was checked in to that event again after the merge. |
| `not_authorized` | The entry is `accessChanging` and the actor lacks `role.assign` (FR-025). |

## The reversibility verdict

Computed, never stored (research R9). One function, shared by the history read path and the undo write
path, returning a discriminated union:

| Verdict | Condition | Requirement |
|---|---|---|
| `reversible` | none of the below | |
| `no_manifest` | `reversal_manifest IS NULL` — merge predates this feature | FR-007 |
| `survivor_merged` | the surviving contact has since been merged into another | FR-008 |
| `contact_archived` | either contact has been archived since | FR-009 |
| `already_undone` | a `merge_reversals` row exists for this merge | FR-010 |

**Superseded in part by feature 077 (2026-09-13):** the conclusion below still holds — a merge record never outlives its contacts, so there is no "contact is gone" verdict — but the reason changed. `merge_audit`'s contact keys are now `ON DELETE CASCADE`, so deleting a contact deletes its merge records rather than being refused. See the Mel Maintenance close-out list §2c and migration 0048.

These four refusals are **exhaustive**. A fifth, `contact_missing`, was carried in an earlier draft and
removed: `merge_audit.canonical_id` and `merged_id` are `REFERENCES contacts(id)` with no `ON DELETE`
([0003_dedup.sql:5-6](../../src/server/db/migrations/0003_dedup.sql)), so the database permanently refuses
to delete either contact a merge names. The branch was unreachable, and a test for it could not be
written. Do not reintroduce it without first removing that foreign key.

## Merge history projection

What the contact record shows (FR-026 to FR-028). Read-only; assembled from `merge_audit`,
`merge_reversals` and the verdict.

Scope is the **whole chain**, not only direct merges: a recursive walk back along `contacts.merged_into_id`
collects every contact that has become the one being viewed, and the listing takes every merge whose
`canonical_id` is any of them. Listing only direct merges hid an inner merge completely — it names a
retired contact as its survivor, and a retired contact cannot be opened — and left the `survivor_merged`
verdict unreachable. The walk uses `UNION`, not `UNION ALL`, so a cycle terminates instead of hanging the
page.

| Field | Source |
|---|---|
| merged-in contact name and id | `merge_audit.merged_id` → `contacts` |
| the contact it merged INTO, and whether that is the one being viewed | `merge_audit.canonical_id` → `contacts`; `direct` is true when it equals the viewed contact |
| when, by whom | `merge_audit.created_at`, `.actor` |
| age | derived from `created_at` (FR-027) |
| activity since | see below (FR-027) |
| verdict and reason | the function above (FR-028) |
| reversal, if any | `merge_reversals` — who, when, what was skipped (FR-021) |

### `activitySince`, defined

A **risk indicator**, not an audit: how much has landed on either contact since the merge, so the
operator can judge whether reversing it is still sensible (FR-027). It is the count of rows on **either**
contact, across exactly these three tables, whose `created_at` is later than `merge_audit.created_at`:

| Table | Why |
|---|---|
| `contact_emails` | A new way to reach them. |
| `attendance` | They came to a dance. |
| `membership_accounts` | They took out or renewed a membership. |

The set is deliberately closed, and deliberately smaller than the eleven moved references. Every table in
it carries a plain `created_at` on the contact itself, so the count is one uniform query.

Excluded, and why: `membership_members` timestamps as `attached_at`; **`gate_sales` has no timestamp of
its own at all** and would need a join through `door_records` — and `attendance` already registers that
the person turned up, which is the same signal; the audit tables record what was done *to* a contact
rather than activity *by* one. A number that is directionally right and is one uniform query serves the
judgement this field exists for. An exhaustive one would not serve it better, and would drift the moment
a table was added.

## Entity relationships

```text
contacts ──< merge_audit >── contacts        (canonical_id, merged_id — both `leave`, never re-pointed)
                  │
                  └──1:0..1── merge_reversals   (unique on merge_audit_id)
```

`merge_audit`'s two contact references keep the `leave` disposition feature 072 gave them: a merge record
names the contacts as they were, and an undo does not rewrite it.
