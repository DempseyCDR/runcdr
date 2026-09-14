# Phase 1 Data Model: Merge access decisions

## Schema changes (migration 0049)

### `held_merge_reason` — two new values

| Value | Raised when | Answered by |
|---|---|---|
| `two_logins` | both contacts can sign in | role-assigning authority |
| `two_accounts` | both contacts pay for a membership | the mailing-list manager (`dedup.write`) |
| `role_conflict` | the survivor would gain role-assigning authority, or two exclusive offices | role-assigning authority |
| **`volunteer_status`** | the merged contact is a volunteer and the survivor is not | role-assigning authority |
| **`super_user`** | the merged contact is a super-user and the survivor is not | **no one in the app** — the command line |

### `held_merges` — one new column

| Column | Type | Notes |
|---|---|---|
| `answers` | `jsonb` NOT NULL DEFAULT `'{}'` | Every answer given so far for this pair, by whoever gave it. Retried together (research R2). |

`answers` shape — each key present only once answered:

```text
{
  survivingIdentityId?:   uuid      // two_logins, together with the address below
  survivingLoginEmailId?: uuid      // two_logins
  survivingAccountId?:    uuid      // two_accounts
  keepGrantIds?:          uuid[]    // role_conflict; [] is a valid answer
  carryVolunteer?:        true      // volunteer_status
}
```

**Who can see a hold** — any reason — is anyone holding `dedup.write` **or** `role.assign` (research R11);
the table above says only who can *answer* it.

`reason` keeps its meaning but gains an invariant: **it is always the decision still outstanding** for the
pair. `held_merges_pair_open` (one open hold per pair) is unchanged.

## Hold lifecycle

```text
                      merge attempted, detectHold → reason R
                                   │
                                   ▼
                        ┌─── OPEN (reason R, answers A) ◀──────────────┐
                        │          │                                   │
  Don't merge ──────────┤          │ answer given by R's authority     │ held again for R′:
  (resolved, audited)   │          ▼                                   │ same row, reason := R′,
                        │   retry merge with A ∪ answer ───────────────┘ answers := A ∪ answer
                        │          │
  obstacle gone         │          │ completes
  (detectHold → none) ──┤          ▼
  resolved automatically│    RESOLVED (merge_audit written)
                        │
  detectHold → other R′ ┘  reason := R′ (automatically, on read)
```

A stale stored answer (research R3) is removed from `answers` and the hold returns to that answer's reason.

## Merge reversal manifest — new entries

Carrying volunteer status (research R6) writes three `overwrite` entries on the **survivor**, all
`accessChanging`:

| table | key | column | previousValue |
|---|---|---|---|
| `contacts` | `{ id: survivor }` | `is_volunteer` | `false` |
| `contacts` | `{ id: survivor }` | `volunteer_approved_at` | the survivor's prior value |
| `contacts` | `{ id: survivor }` | `volunteer_approved_by` | the survivor's prior value |

Feature 074's undo restores them like any overwrite; without role-assigning authority they are skipped and
reported, as every sign-in-changing entry already is.

## Held-merge detail (computed on read, never stored)

| Field | Present for |
|---|---|
| `id`, `reason`, canonical and merged contact names | all |
| `answerableBy` — `dedup.write` · `role.assign` · `command_line` | all |
| `canAnswer` — for the signed-in actor | all |
| `answered` — which earlier decisions are already recorded, and by reason | all |
| `accounts[]` — id, payer, level, expiry, last payment, members | `two_accounts` |
| `signIns[]` — per contact: login address id and text; whether a Google account is bound, its id, last sign-in | `two_logins` |
| `grants[]` — id, role, scope label, whether it would move, why it conflicts | `role_conflict` |
| `volunteer` — merged contact's approval date and approver name | `volunteer_status` |
| `instruction` — super-user can only be granted at the command line | `super_user` |

## Audit events

| Kind | When | Notes |
|---|---|---|
| `dedup.merge_held` | a merge is held | existing; now also written when an open hold's reason changes |
| `dedup.merge_resolved` | a held merge completes | existing; details gain the answers applied |
| `dedup.merge_abandoned` | Don't merge | existing |
| `volunteer.designated` | volunteer status carried by a merge | existing kind; details name the merge |
