# Contract: Held-merge chooser

No new capability. Every held-merge route below is reachable by anyone holding `dedup.write` **or**
`role.assign` (FR-005a) — a President has only the latter, and before this feature could not reach any of
them. Answering a hold additionally needs the authority its reason names. Error bodies use the project's
standard `ApiError` shape.

`withAuth` accepts a single capability, so these routes declare `requires: "base"` and admit the actor with
one shared check, `canSeeHolds(actor)`, rather than widening `withAuth` for every route in the app. A
refusal from that check is still audited by `withAuth`'s catch, like any `UNAUTHORIZED`.

## 1. Merge — unchanged request, two new held reasons

```http
POST /api/dedup/merge   { "canonicalId": "…", "mergedId": "…" }
```

The discriminated outcome gains two reasons, both with the same `outcome: "held"` shape:

```jsonc
{ "outcome": "held", "reason": "super_user",       "heldMergeId": "…" }
{ "outcome": "held", "reason": "volunteer_status", "heldMergeId": "…",
  "candidates": { "approvedAt": "2026-03-01", "approvedBy": "Pat Officer" } }
```

## 2. List held merges

```http
GET /api/dedup/held
```

Each item gains who can answer it, so the queue never re-derives authority on the client (research R8):

```jsonc
{
  "held": [
    {
      "id": "…",
      "reason": "volunteer_status",
      "canonicalId": "…", "canonicalDisplayName": "Peggy CDR",
      "mergedId": "…",    "mergedDisplayName": "Peggy Dempsey",
      "attemptedAt": "2026-09-13T15:02:00Z",
      "answerableBy": "role.assign",      // "dedup.write" | "role.assign" | "command_line"
      "canAnswer": false                   // for the signed-in actor
    }
  ]
}
```

Reading the list still closes stale holds first, and now also moves an open hold's `reason` to the decision
actually outstanding (research R1, R2).

## 3. Open a held merge — new

```http
GET /api/dedup/held/{id}
```

The question as it stands now (research R9). Common fields, then one block for the reason:

```jsonc
{
  "id": "…",
  "reason": "two_accounts",
  "canonical": { "id": "…", "displayName": "Robert Jones" },
  "merged":    { "id": "…", "displayName": "Rob Jones" },
  "answerableBy": "dedup.write",
  "canAnswer": true,
  "answered": ["volunteer_status"],       // decisions already recorded for this pair

  // reason: two_accounts
  "accounts": [
    { "id": "…", "payerDisplayName": "Robert Jones", "level": "family",
      "expiryDate": "2027-08-31", "lastPaymentDate": "2026-09-01",
      "members": ["Robert Jones", "Ann Jones"] }
  ]

  // reason: two_logins
  // "signIns": [ { "contactId": "…", "loginEmailId": "…", "loginEmail": "rob@example.com",
  //                "identityId": "…" | null, "lastSignInAt": "…" | null } ]

  // reason: role_conflict
  // "grants": [ { "id": "…", "role": "treasurer", "scope": "club-wide",
  //               "conflict": "exclusive" | "role_assign" } ]

  // reason: volunteer_status
  // "volunteer": { "approvedAt": "2026-03-01" | null, "approvedBy": "Pat Officer" | null }

  // reason: super_user
  // "instruction": "Super-user can only be granted at the command line. Make the kept contact a
  //                 super-user there, and this merge can then be completed."
}
```

**404** `HELD_MERGE_NOT_FOUND` — no open hold with that id (answered, abandoned or closed).

## 4. Answer a held merge — extended

```http
POST /api/dedup/held/{id}/resolve
```

The body answers **the hold's current reason only** — exactly one kind, as today — and gains the volunteer
answer:

```jsonc
{ "survivingAccountId": "…" }                                        // two_accounts
{ "survivingIdentityId": "…", "survivingLoginEmailId": "…" }         // two_logins
{ "keepGrantIds": ["…"] }                                             // role_conflict; [] is valid
{ "carryVolunteer": true }                                            // volunteer_status
```

The server merges it with the answers already stored for the pair and retries the merge (research R2).

**200 — completed**: the merge outcome, as `POST /api/dedup/merge` returns it.

**200 — held for the next decision**: the same hold id, now asking its next question:

```jsonc
{ "outcome": "held", "reason": "volunteer_status", "heldMergeId": "<same id>", "candidates": { … } }
```

**403** `UNAUTHORIZED` — the actor holds neither `dedup.write` nor `role.assign`, or lacks the authority
the hold's *current* reason names.

**409** `HELD_MERGE_REASON_MISMATCH` — the answer is for a different question than the one outstanding.

**409** `HELD_MERGE_NOT_ANSWERABLE` — a `super_user` hold. Refused for everyone; the message is the
command-line instruction.

**409** `HELD_MERGE_STALE` — a stored or given answer no longer matches the pair: an account deleted or
moved to another payer by a later merge, a sign-in removed, a grant no longer the merged contact's. It is
`detectHold` that finds this, so the merge, the auto-close and this route all agree. The stale answer is
dropped, the hold returns to that question, and the message says what changed (research R3).

## 5. Don't merge — reachable by a President too

```http
DELETE /api/dedup/held/{id}
```

Open to anyone with `dedup.write` or `role.assign`, for every reason including `super_user`.
