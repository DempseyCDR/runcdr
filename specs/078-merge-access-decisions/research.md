# Phase 0 Research: Merge access decisions

Eleven decisions. R1 and R2 are the spine: everything else hangs off one detection function and answers that
accumulate on the hold.

## R1 — One function decides what, if anything, still blocks a merge

**Decision**: extract `detectHold(db, canonicalId, mergedId, answers)` from `mergeContacts`. It returns the
first obstacle the given answers do not settle — its reason and the candidates for answering it — or
nothing. The merge calls it before writing anything; the chooser's detail read calls it to show the
question; and the auto-close calls it to decide whether a hold is still blocked.

**Rationale**: feature 072 shipped exactly the failure this prevents. The held-merge auto-close and the
merge detection asked subtly different versions of "can both of these sign in?", so a hold would close and
the next attempt would raise it again, forever. Three callers asking the same question must call the same
code. This also makes the two new reasons close themselves for free, with no new sweep, and replaces the
SQL `two_accounts` count in `closeStaleHolds` — the "either contact merged or archived" sweep stays.

**Alternatives considered**: add the new checks inline in `mergeContacts` and matching SQL in the sweep
(rejected — that is the 072 drift, twice over); compute candidates only in the merge's held outcome
(rejected — the chooser opens a hold days later, when the outcome is long gone).

## R2 — Answers accumulate on the hold, and the hold's reason is always the outstanding one

**Decision**: add `held_merges.answers jsonb`. Resolving merges the new answer into the stored answers and
retries the merge with all of them. If the merge is held again for a different reason, the **same hold
row** is updated to that reason, keeping its answers.

**Rationale**: `mergeContacts` re-detects every obstacle from scratch on each attempt, so a retry that
omits an earlier answer re-raises that obstacle. And the answers come from different people at different
times — the mailing-list manager answers the accounts question today, an officer answers the volunteer
question next week — so nothing but the hold can carry them.

This is also the fix for the stuck pair. Today `hold()` returns the pair's existing open hold whenever
there is one, whatever its reason, so a retry held for a new reason reports the new reason but leaves the
row asking the old question. `held_merges_pair_open` allows one open hold per pair, which is right: the
pair has one outstanding decision at a time, and the row's reason must be it.

**Alternatives considered**: have the client re-send every earlier answer (rejected — the earlier answers
were given by someone else, possibly in another session); a row per reason (rejected — breaks the one-open-
hold-per-pair index, and the queue would show questions that cannot yet be asked).

## R3 — A stale answer is caught by the detector, not beside it

**Decision**: an answer settles its question **only if it is valid for the pair now**, and that judgement
lives inside `detectHold`. The chosen account must be one of the pair's accounts; the chosen sign-in and its
address must belong to the pair; each kept grant must still be the merged contact's. An invalid stored
answer is reported by `detectHold` as stale for that reason. Resolving then drops it from `answers`, sets the
hold back to that reason, and refuses with `HELD_MERGE_STALE` saying what changed (FR-010). As defence in
depth, `mergeContacts` itself refuses a surviving account that is not one of the pair's.

**Rationale — corrected at `/speckit-analyze`**: this decision first placed the check in
`resolveHeldMerge`, a second judge of answers beside the detector — exactly what R1 exists to rule out. And
there is a real data-loss path behind it. The merge deletes **every** account of the pair except the chosen
one, and copies their members into it. `detectHold` treated an answer as settling its question merely by
being present. So a stored `survivingAccountId` whose account a later merge had moved to a third contact
would have deleted **both** of the pair's accounts and copied their households into a stranger's. Putting
validation where answers are judged makes the merge, the auto-close and the chooser agree, and makes that
path impossible.

## R4 — Detection order: follows dependency, not authority

**Decision**: `super_user` → `two_accounts` → `volunteer_status` → `two_logins` → `role_conflict`.
*(Revised after the manual pass — see below.)*

**Rationale**: a super-user hold cannot be answered in the app at all, so it must surface before anyone
spends effort answering other questions for a merge that cannot complete. Volunteer status comes before
the sign-in question because whether the survivor may sign in at all decides whether choosing a sign-in
means anything. The accounts question depends on no access decision, so it comes straight after
super-user. With R2, order affects only which question is asked first, never whether a merge can
complete.

**Revised in the manual pass (§6).** The first order was `super_user` → `volunteer_status` → `two_logins` →
`two_accounts` → `role_conflict`, keeping the three older reasons in their existing relative order. On a
pair needing both a volunteer and an accounts decision, Mel could not see her question until an officer
had answered his — and Mel works the queue daily while officers visit it occasionally. Ordering by
authority made the frequent answerer wait on the infrequent one for no reason: her answer never depended
on his. The cost is small: if the officer then declines the merge, Mel's answer was wasted (seconds, and
nothing written), and a stored answer waits longer and so may go stale — which R3 already handles.

**Alternative rejected**: posing every outstanding question at once. Nobody would wait, but a hold has one
reason and one authority check, and some questions depend on earlier answers (volunteer status on the
sign-in choice; the roles moved on whether a conflict remains), so it would show questions that may turn
out not to matter. A redesign, not a reorder.

## R5 — Super-user: a property of the pair, not of the grants that would move

**Decision**: the merge is held as `super_user` whenever the merged contact holds super-user and the
survivor does not. It is checked on the merged contact's grants as a whole, **not** on the grants a
role-conflict answer chooses to move. `authorityFor("super_user")` is `command_line`, and resolving is
refused for everyone. When the survivor already holds super-user, the merged contact's duplicate grant is
simply not moved, as any duplicate grant already is.

**Rationale**: Rich's rule is that the merge may succeed **only if the survivor already was a super-user**.
A role-conflict answer that left super-user behind would complete a merge the rule forbids. The command-line
tool (`pnpm auth:bootstrap -- --email … --role super_user`) can only grant a role, not remove one, so the
one route forward is making the survivor a super-user there; the hold then closes itself through R1.

**Why this is a gap today**: `findRoleConflicts` holds a role-assigning grant only when the survivor would
*gain* role-assigning authority. Super-user is role-assigning, so merging a super-user into a President —
who already has that authority — moves super-user without a hold.

## R6 — Carrying volunteer status is an overwrite the undo can reverse

**Decision**: the answer is `carryVolunteer: true`. Inside the merge transaction it sets the survivor's
`is_volunteer`, `volunteer_approved_at` and `volunteer_approved_by` from the merged contact. Each change is
recorded in the merge's reversal manifest as an `overwrite` on `contacts`, flagged `accessChanging`, and
the change is audited as `volunteer.designated` with the merge named. There is no answer that completes the
merge **without** carrying — declining is **Don't merge** (FR-011).

**Rationale**: without manifest entries, undoing such a merge would leave the survivor a volunteer — a
grant of access that no longer has a reason. Flagging it `accessChanging` applies feature 074's existing
rule: an undo that changes who can sign in needs role-assigning authority, and without it the entry is
skipped and reported. Reusing `volunteer.designated` keeps the access screen's history complete.

The hold triggers on `merged.is_volunteer AND NOT survivor.is_volunteer`, whether or not the merged contact
holds any grant or sign-in: a volunteer who has never signed in could still enrol before the merge, and
could not after it, because their address would sit on a non-volunteer.

## R7 — The audit FR-016 asks for: no further rule

**Decision**: the two rules this feature adds are the only ones a merge was walking past.

| Rule | Enforced | What a merge does |
|---|---|---|
| Super-user is command-line only (FR-030a) | `grantRole` | **was bypassed** → R5 |
| A grant's subject must be a volunteer (R3 of 016) | `grantRole`, `approveVolunteer` | **was bypassed** → R6 |
| President / VP / Treasurer are exclusive (FR-005a) | `assertExclusivity` | held since 072 (`role_conflict`) |
| Role-assigning authority cannot be gained silently | merge-only rule | held since 072 (`role_conflict`) |
| Clearing a volunteer revokes every grant (FR-028) | `clearVolunteer` | the same invariant as the volunteer requirement — covered by R6 |
| A grant's series or event group must exist | `grantRole` | grants move with scopes that already exist — cannot be violated |
| Financial Secretary with an authority office (FR-029a/b) | a **warning**, computed on read | advisory; appears on the access list after a merge like any grant — nothing to hold |
| A board seat names a board-seat role | `setOfficer` | not an access rule |

**Rationale**: FR-016 exists because this is the third, fourth and fifth rule found the same way. Listing
every rule once, with what the merge does about it, is what makes "no further rule" a finding rather than
a hope.

## R8 — The server says who can answer; the client stops guessing

**Decision**: the held-merge list and detail both return `answerableBy` (`dedup.write`, `role.assign` or
`command_line`) and `canAnswer` for the signed-in actor — `true` for a President on sign-in, role and
volunteer holds, `false` on two-accounts and super-user holds. The queue's hard-coded
`h.reason === "two_accounts" ? true : caps.roleAssign` is removed.

**Rationale**: that line is a second copy of `authorityFor`, and would have silently shown officer-only
controls — or none — for the two new reasons. One source, on the server.

## R9 — Candidates are computed on read, never stored

**Decision**: the detail read calls `detectHold` with the stored answers and returns the current question's
candidates: accounts with level, expiry, last payment and members; each record's sign-in (address, and
whether a Google account is bound and when it last signed in); conflicting grants with role, scope and
why; the merged contact's volunteer approval; or, for super-user, no candidates and the command-line
instruction.

**Rationale**: the same reasoning as feature 074's reversibility verdict — stored candidates would go stale
the moment an account renewed or a sign-in was withdrawn, and FR-010 needs the answerer to see the pair as
it stands.

## R11 — A President can see and answer holds (added at `/speckit-analyze`)

**Decision**: the held-merge list, detail, resolve and Don't-merge routes admit anyone holding `dedup.write`
**or** `role.assign`, through one shared check `canSeeHolds(actor)`, with each route declaring
`requires: "base"`. Answering still needs the reason's own authority.

**Rationale**: a President holds `role.assign` but not `dedup.write`, and every hold route required
`dedup.write` before checking anything else — true since feature 072. The review queue treated the
resulting 403 as an empty list, so a President saw no holds at all, even the sign-in and role holds that
are theirs to answer. Rich decided a President must be able to answer holds. `withAuth` takes a single
capability; widening it would change every route in the app to fix four.

**Alternatives considered**: give President `dedup.write` (rejected — that is merge authority, which is
not what was decided); extend `withAuth` with an any-of requirement (rejected here as wider than the need,
though a reasonable future change if a second case appears).

## R10 — One migration, and why the enum values can share it

**Decision**: migration `0049` adds `volunteer_status` and `super_user` to `held_merge_reason` and the
`answers` column.

**Rationale**: Postgres allows `ALTER TYPE … ADD VALUE` inside a transaction provided the new value is not
*used* before it commits. Migration 0046 stood alone because later statements in it would have used the
value; nothing in 0049 does.
