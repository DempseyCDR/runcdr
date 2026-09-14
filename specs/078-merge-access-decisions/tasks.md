---
description: "Task list for feature 078 — merge access decisions"
---

# Tasks: Merge access decisions

**Input**: Design documents from `/specs/078-merge-access-decisions/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/held-merge-chooser.md](./contracts/held-merge-chooser.md)

**Tests are NOT optional here.** Constitution Principle I (Test-First) is NON-NEGOTIABLE: every behaviour
lands as a failing test before its implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: may run in parallel (different files, no dependency on an incomplete task)
- **[US1]** etc.: the user story the task serves

## Path Conventions

Single Next.js app. Server code under `src/server/`, admin UI under `src/app/(admin)/`, integration tests
under `tests/integration/`, component tests under `tests/component/`.

---

## Phase 1: Setup

- [X] T001 Create migration `src/server/db/migrations/0049_merge_access_holds.sql`:
  `ALTER TYPE held_merge_reason ADD VALUE IF NOT EXISTS 'volunteer_status';`,
  `ALTER TYPE held_merge_reason ADD VALUE IF NOT EXISTS 'super_user';`, and
  `ALTER TABLE held_merges ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}';`. Comment why
  the enum values may share a migration: nothing in it uses them (research R10, contrast 0046).
- [X] T002 [P] Extend `src/server/db/schema/dedup.ts`: add `volunteer_status` and `super_user` to
  `heldMergeReasonEnum`, and `answers: jsonb("answers").notNull().default({})` to `heldMerges`.
- [X] T003 [P] Add `heldMergeAnswersSchema` (Zod) and its type to `src/server/validation/dedup.ts`, matching
  the `answers` shape in [data-model.md](./data-model.md). Stored answers are parsed through it on read,
  never trusted raw (Principle III).

---

## Phase 2: Foundational (Blocking Prerequisites)

**One detector, answers that accumulate, and a chooser to put them in.** Nothing user-visible about the new
reasons yet, but every story depends on this phase.

- [X] T004 Write detector-agreement tests in `tests/integration/dedup.heldMerge.test.ts`: for each existing
  reason (`two_logins`, `two_accounts`, `role_conflict`), the reason `mergeContacts` holds with equals
  `detectHold(db, canonical, merged, {})`; and the auto-close on the list read closes a hold exactly when
  `detectHold` returns nothing, including a `two_accounts` hold after one account is deleted. That is the
  behaviour the SQL sweep provides today. Failing until T005–T006.
- [X] T005 Extract `detectHold(db, canonicalId, mergedId, answers)` in
  `src/server/domain/dedup/mergeService.ts`, returning `{ reason, candidates }` or `null`. Existing order:
  `two_logins`, `two_accounts`, `role_conflict`. `mergeContacts` must call it before writing and hold on
  its result, with no remaining inline detection. Comment that it is the ONLY detector (research R1) and
  cite feature 072's auto-close drift. **An answer settles its question only if it is valid for the pair
  now** (research R3, corrected at analyze): the surviving account is one of the pair's accounts; the
  surviving sign-in and address belong to the pair; each kept grant is the merged contact's. An invalid
  answer is returned as `{ reason, stale: <what changed> }`, never treated as settling. Also make
  `mergeContacts` refuse a `survivingAccountId` outside the pair: its account fold deletes every other
  account, so a foreign id would delete both of the pair's.
- [X] T006 In `src/server/domain/dedup/heldMergeService.ts`, rewrite `closeStaleByDetection` to call
  `detectHold` with each open hold's parsed `answers`. `null` resolves the hold; a different reason
  updates the hold's `reason` in place and records `dedup.merge_held`. Remove the `two_accounts` clause
  from the SQL `closeStaleHolds` sweep, keeping the "either contact merged or archived" clause.
- [X] T007 Write accumulation tests in `tests/integration/dedup.heldMergeDecisions.test.ts`, using existing
  reasons only. Set up a pair that is both `two_accounts` and `role_conflict`. The mailing-list manager
  answers the accounts question; the response is held for `role_conflict` with the **same hold id**; the
  hold row's `reason` is now `role_conflict` and its `answers` holds `survivingAccountId`. The list shows
  the `role_conflict` question, never `two_accounts` (the stuck-pair regression, FR-009). An officer then
  answers `keepGrantIds` and the merge completes with **both** answers applied. Failing until T008.
- [X] T008 Implement accumulation (research R2):
  - In `resolveHeldMerge` (`heldMergeService.ts`), merge the body's answer into the stored `answers`, then
    retry `mergeContacts` with all of them.
  - On a further hold, update the same row's `reason` and `answers`.
  - In `hold()` (`mergeService.ts`), when an open hold exists for the pair with a different reason, update
    its reason instead of returning it unchanged.
  - Record the applied answers on `dedup.merge_resolved`.
- [X] T009 [P] Write authority and visibility tests in `tests/integration/dedup.heldMergeDecisions.test.ts`
  through `GET /api/dedup/held`, `POST …/resolve` and `DELETE /api/dedup/held/{id}` (FR-005, FR-005a,
  research R11). Each item carries `answerableBy`: `dedup.write` for `two_accounts`, `role.assign` for
  `two_logins` / `role_conflict`. Use `jsonReqAs` with a mailing-list-manager actor, a **president** actor
  (which holds `role.assign` but not `dedup.write`) and a base actor with neither.
  - The **president** gets 200 on the list, sees `canAnswer: true` on `two_logins` and `role_conflict`
    and `false` on `two_accounts`, can resolve a `role_conflict` hold and gets 403 resolving a
    `two_accounts` one, and can **Don't merge**. Before this feature a president got 403 on every one of
    these routes, and the queue showed nothing.
  - The mailing-list manager sees `canAnswer: true` on `two_accounts` only.
  - The base actor gets 403 on all of them.
- [X] T010 Widen `HeldMergeReasonAuthority` to `"dedup.write" | "role.assign" | "command_line"` in
  `mergeService.ts`. `authorityFor` in `heldMergeService.ts` covers every reason. `listHeldMerges` returns
  `answerableBy`, and `src/app/api/dedup/held/route.ts` adds `canAnswer` from `actorCan` (always `false`
  for `command_line`). **Widen who can reach holds** (research R11): export
  `canSeeHolds(actor)` (`dedup.write` or `role.assign`) from `heldMergeService.ts`. Change the list
  (`held/route.ts`), `DELETE` (`held/[id]/route.ts`) and resolve (`held/[id]/resolve/route.ts`) routes
  from `requires: "dedup.write"` to `requires: "base"` plus `if (!canSeeHolds(ctx.actor)) throw
  errors.unauthorized("dedup.write")`, with a comment that a President holds only `role.assign`.
  `withAuth` takes a single capability, and widening it is out of scope. Resolve keeps gating on
  `authorityFor`.
- [X] T011 [P] Write detail-read tests in `tests/integration/dedup.heldMergeDecisions.test.ts` for
  `GET /api/dedup/held/{id}`:
  - Common fields per the contract: `id`, `reason`, `canonical`, `merged`, `answerableBy`, `canAnswer`.
  - `answered` lists the reasons already settled.
  - A resolved or abandoned hold returns 404 `HELD_MERGE_NOT_FOUND`.
- [X] T012 Implement `getHeldMergeDetail(db, id, actor)` in `heldMergeService.ts`: run the auto-close for
  that hold, then `detectHold` with its answers, returning the contract's common fields plus a
  `candidates` passthrough (per-reason shapes land in each story). Add
  `export const GET = withAuth<{ id: string }>({ requires: "base" }, …)` to
  `src/app/api/dedup/held/[id]/route.ts`, beside the existing `DELETE`, admitting the actor with
  `canSeeHolds` (T010).
- [X] T013 [P] Write chooser shell tests in `tests/component/contacts.heldMergeChooser.test.tsx`:
  - **Resolve** in the review queue opens the chooser, not a contact record.
  - With `canAnswer: false`, it shows the reason's explanation, that it waits on `answerableBy`, and
    **Don't merge**, with no answer controls.
  - It states that the merge can be undone (FR-007).
  - A `completed` response shows a completion message and closes.
  - A `held` response for a new reason re-reads the hold and shows the next question (FR-008).
- [X] T014 Create `src/app/(admin)/contacts/_components/HeldMergeChooser.tsx`: a `RecordView` modal like
  `MergeCompare`. It loads `GET /api/dedup/held/{id}` and shows the pair, the answered list, the undo
  statement, **Don't merge** (`DELETE`), and a per-reason panel slot, and handles `completed` / `held`
  outcomes. In `src/app/(admin)/contacts/page.tsx`, make **Resolve** open it, and replace
  `(h.reason === "two_accounts" ? true : caps.roleAssign)` with the item's `canAnswer` (research R8).

**Checkpoint**: one detector; answers survive between people; every hold opens a chooser that says who can
answer it.

---

## Phase 3: User Story 1: The mailing-list manager answers a two-accounts hold (Priority: P1) 🎯 MVP

**Goal**: Mel answers the hold that is hers, from the queue, in one screen.

**Independent test**: hold a merge of two paying contacts; as Mel, open it, choose an account, and confirm
the merge completes with the chosen account kept and both households on it.

- [X] T015 [P] [US1] Write an integration test in `tests/integration/dedup.heldMergeDecisions.test.ts`:
  the detail for a `two_accounts` hold returns `accounts[]`, each with `id`, `payerDisplayName`, `level`,
  `expiryDate`, `lastPaymentDate` and `members` (display names) (FR-002).
- [X] T016 [P] [US1] Write a component test in `tests/component/contacts.heldMergeChooser.test.tsx`: the
  accounts panel shows both accounts' level, expiry, last payment and members, and states that the
  unchosen account is deleted and everyone it covers moves. Choosing and confirming posts
  `{ survivingAccountId }` to `/resolve`.
- [X] T017 [US1] Return the `two_accounts` candidates with `lastPaymentDate` and member names from
  `detectHold` / `getHeldMergeDetail`, extending `accountsOf` in `mergeService.ts`.
- [X] T018 [US1] Add the accounts panel to `HeldMergeChooser.tsx`.

**Checkpoint**: the most common hold is answerable by the person it belongs to.

---

## Phase 4: User Story 2: An officer answers a sign-in or role hold (Priority: P1)

**Goal**: sign-in and role holds are answerable by an officer. Everyone else sees them waiting. A stale
answer is refused, not applied.

**Independent test**: hold a merge of two contacts that can both sign in. As Mel, confirm it's explained
and unanswerable. As an officer, choose a sign-in and confirm the merge completes.

- [X] T019 [P] [US2] Write integration tests in `tests/integration/dedup.heldMergeDecisions.test.ts`:
  - A `two_logins` detail returns `signIns[]`, per contact, with `loginEmailId`, `loginEmail`,
    `identityId` (or null) and `lastSignInAt`.
  - A `role_conflict` detail returns `grants[]` with `id`, `role`, a `scope` label ("club-wide" or the
    series/group name) and `conflict`.
- [X] T020 [P] [US2] Write stale-answer tests in `tests/integration/dedup.heldMergeDecisions.test.ts`
  (FR-010, research R3). A stored `survivingAccountId` whose account was since deleted, then retried by an
  officer's answer to a later reason, is refused with 409 `HELD_MERGE_STALE`. The stale answer is removed
  from `answers`, the hold's reason returns to `two_accounts`, and nothing is merged. A given answer naming
  a grant no longer on the merged contact is refused the same way.
  - **The data-loss case** (analyze U1): a stored `survivingAccountId` whose account a later merge moved
    to a **third** contact is refused as stale, and afterwards **both** of the pair's accounts still exist
    with their members. Assert it directly against `mergeContacts` too: called with a foreign
    `survivingAccountId`, it refuses and deletes nothing.
  - The auto-close agrees: listing holds with a stale stored answer resets the reason rather than closing
    the hold or leaving it on the later question.
- [X] T021 [P] [US2] Write component tests in `tests/component/contacts.heldMergeChooser.test.tsx`:
  - The sign-in panel's single choice posts `survivingIdentityId` and `survivingLoginEmailId` together.
  - The role panel lists each grant with why it conflicts; submitting none posts `keepGrantIds: []`.
  - Mel (`canAnswer: false`) sees both panels read-only, with "waiting on an officer".
- [X] T022 [US2] Return `signIns[]` and `grants[]` candidates (with scope labels) from `detectHold` /
  `getHeldMergeDetail` in `mergeService.ts` / `heldMergeService.ts`.
- [X] T023 [US2] Act on staleness where `detectHold` reports it (T005), not with a second check. When
  `resolveHeldMerge`'s detection returns `stale`, drop that answer from `answers`, set the hold's reason to
  it, and throw `errors.heldMergeStale(message)`. When the auto-close sees `stale`, drop the answer and set
  the reason without throwing. Add `HELD_MERGE_STALE` and its constructor to
  `src/server/lib/apiError.ts`. Confirm the `mergeContacts` refusal of a foreign `survivingAccountId`
  (T005) has its test (T020).
- [X] T024 [US2] Add the sign-in and role panels to `HeldMergeChooser.tsx`. In `page.tsx`, rewrite the
  queue's `role_conflict` explanation, which says "There is no resolution screen", now false.

**Checkpoint**: every hold that existed before this feature is answerable from the queue.

---

## Phase 5: User Story 3: A merge never silently locks out a volunteer (Priority: P1)

**Goal**: a volunteer merged into a non-volunteer is held for an officer, who may carry volunteer status
across. An undo reverses the carry.

**Independent test**: merge a mailing-list manager into a non-volunteer. Confirm it's held and Mel cannot
answer. As an officer, carry volunteer status, and confirm the merge completes and the person can sign in.

- [X] T025 [P] [US3] Write integration tests in `tests/integration/dedup.heldMergeDecisions.test.ts`:
  - A volunteer merged into a non-volunteer holds as `volunteer_status` and writes nothing.
  - Mel's resolve is 403.
  - An officer's `{ carryVolunteer: true }` completes the merge. The survivor has `is_volunteer`, and the
    merged contact's `volunteer_approved_at` and `volunteer_approved_by`.
  - `volunteer.designated` is recorded, naming the merge.
  - `resolveSignIn` then succeeds for the moved sign-in.
  - Designating the survivor via `designateVolunteer` closes the hold on the next list read.
  - A survivor already a volunteer: no hold.
  - `detectHold` puts `volunteer_status` before `two_logins`.
- [X] T026 [P] [US3] Write undo tests in `tests/integration/dedup.unmerge.test.ts`:
  - The completed carry's manifest holds three `overwrite` entries on `contacts` (`is_volunteer`,
    `volunteer_approved_at`, `volunteer_approved_by`), all `accessChanging`.
  - An undo with `canAssignRoles: true` restores the survivor to a non-volunteer with its prior approval
    values.
  - An undo without `canAssignRoles` skips all three as `not_authorized`.
- [X] T027 [P] [US3] Write validation tests in `tests/integration/dedup.heldMergeDecisions.test.ts`:
  `heldResolveSchema` accepts `{ carryVolunteer: true }` alone and refuses it combined with another kind of
  answer; a `carryVolunteer` answer to a non-volunteer hold is 409 `HELD_MERGE_REASON_MISMATCH`.
- [X] T028 [US3] Add the `volunteer_status` check to `detectHold` in `mergeService.ts`, ahead of
  `two_logins`: `merged.isVolunteer && !canonical.isVolunteer`, settled by `answers.carryVolunteer`, with
  candidates `{ approvedAt, approvedBy }`. `authorityFor("volunteer_status")` is `role.assign`.
- [X] T029 [US3] Implement the carry:
  - Add `carryVolunteer?: true` to `MergeResolution` (`mergeService.ts`), to `heldResolveSchema`'s
    exactly-one-kind refinement (`validation/dedup.ts`), and to `resolveHeldMerge`'s answered check.
  - Inside the merge transaction, set the survivor's three volunteer columns from the merged contact.
  - Record three `accessChanging` overwrites via the manifest builder, and `recordAudit`
    `volunteer.designated` with `{ via: "merge", mergeAuditId }`.
- [X] T030 [P] [US3] Write a component test in `tests/component/contacts.heldMergeChooser.test.tsx`: the
  volunteer panel says completing makes the survivor a volunteer, shows the carried approval date and
  approver, and posts `{ carryVolunteer: true }`. Mel sees it waiting.
- [X] T031 [US3] Add the volunteer panel to `HeldMergeChooser.tsx`. Add a `volunteer_status` entry to
  `HELD_MESSAGE` in `page.tsx`, so an attempted merge says why it was held (feature 072, FR-018).

**Checkpoint**: the lockout from 074's manual pass is held, answerable, and reversible.

---

## Phase 6: User Story 4: Super-user access never moves through the app (Priority: P3)

**Goal**: a super-user merges only into a super-user; otherwise the merge is held with no in-app answer
for anyone.

**Independent test**: merge a super-user into a President and confirm it's held and unanswerable, even by
an officer. Grant the President super-user at the command line, and confirm the merge then completes.

- [X] T032 [P] [US4] Write integration tests in `tests/integration/dedup.heldMergeDecisions.test.ts`:
  - A super-user merged into a President holds as `super_user`, first in `detectHold` order, and writes
    nothing.
  - Resolving is refused with 409 `HELD_MERGE_NOT_ANSWERABLE` for a vice-president actor and for the
    standing super-user test session alike.
  - `answerableBy` is `command_line` and `canAnswer` is `false` for everyone.
  - A `role_conflict` answer that leaves super-user behind does not complete the merge (research R5).
  - After `bootstrapOfficer` grants the survivor `super_user`, the list read closes the hold and a merge
    completes.
  - A super-user merged into a super-user: no hold, and the duplicate grant is not moved.
- [X] T033 [US4] Add the `super_user` check to the front of `detectHold` in `mergeService.ts`: the merged
  contact holds a `super_user` grant and the survivor does not, regardless of `keepGrantIds`.
  `authorityFor("super_user")` is `command_line`. In `resolveHeldMerge` (or the resolve route), refuse
  every actor with `errors.heldMergeNotAnswerable(instruction)`, added to `apiError.ts` as
  `HELD_MERGE_NOT_ANSWERABLE`. The detail's `instruction` names the command-line grant.
- [X] T034 [P] [US4] Write a component test in `tests/component/contacts.heldMergeChooser.test.tsx`: the
  super-user panel shows the command-line instruction and **Don't merge**, and no answer control, even
  when the actor is an officer.
- [X] T035 [US4] Add the super-user panel to `HeldMergeChooser.tsx`. Add a `super_user` entry to
  `HELD_MESSAGE` in `page.tsx`.

**Checkpoint**: all four user stories complete.

---

## Phase 7: Polish & Cross-Cutting

- [X] T036 [P] Update `specs/DATA_MODEL.md`: `held_merge_reason`'s two new values, and
  `held_merges.answers` with the rule that `reason` is always the outstanding decision.
- [X] T037 [P] Update `specs/phase-8-requirements/mel-maintenance-remaining.md`:
  - Close §2a (volunteer lockout) and §3's chooser, by 078.
  - Record and close the two findings made while specifying: super-user moving through a merge, and the
    stuck pair.
  - Record the result of the access-rule audit (research R7, FR-016): the two rules 078 adds were the only
    ones a merge walked past.
  - State that every item on the list has landed, **closing Mel Maintenance**.
- [X] T038 [P] Correct the comments that say there is no resolution screen or that a hold is only
  recoverable from the access screen, in `heldMergeService.ts`, `mergeService.ts` and
  `src/app/api/dedup/merge/route.ts`. **FR-016**: above `detectHold` in `mergeService.ts`, add a comment
  listing each rule `grantRole` / `assertExclusivity` / `approveVolunteer` enforce, and the reason that
  handles it (research R7's table). Note that a new rule there needs a matching check here, or a merge
  will walk past it the way it walked past volunteer status and super-user.
- [X] T039 Run the full gate suite, with nothing else on the dev database: `pnpm db:migrate`,
  `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm eslint` and `pnpm exec prettier --check` on the changed
  files only, `pnpm build`, and `pnpm lint:md`. Single-contributor mode: no gate may be skipped.
- [X] T040 Walk [quickstart.md](./quickstart.md) §1–§7 by hand on throwaway contacts (Rich: needs
  mailing-list manager, officer and super-user sign-ins, and the command line for §5). Record the result
  in the plan's Verification section.

---

## Phase 8: Found in the manual pass (FR-017)

A President opened a held pair from the duplicates queue: the comparison offered merge buttons that
failed silently, and no way to the hold she could answer.

- [X] T041 Write an integration test in `tests/integration/dedup.heldMergeDecisions.test.ts`: a suggested
  pair carries its open hold's id whichever way round the merge was attempted, and null once answered.
- [X] T042 [P] Write component tests in `tests/component/contacts.pairActions.test.tsx`: no merge or
  not-duplicates for someone who cannot merge, on the row or in the comparison; a held pair leads to its
  chooser from both; a held pair offers no merge even to Mel; refused merges and rejections say why.
- [X] T043 Add `heldMergeId` to `MergeSuggestion` in `suggestionService.ts`.
- [X] T044 Add `PairPermissions` to `DuplicatePair.tsx` and `MergeCompare.tsx`, pass them from `page.tsx`,
  open the chooser from a held pair, and show refusals from `merge` and `rejectPair`. Give the existing
  tests written from the mailing-list manager's side the capabilities they assumed.
- [X] T045 Reorder `detectHold` to `super_user` → `two_accounts` → `volunteer_status` → `two_logins` →
  `role_conflict`, test-first in `tests/integration/dedup.heldMergeDecisions.test.ts` (Mel's accounts
  question before the volunteer and sign-in questions; super-user still first). Revise research R4, the
  plan and quickstart §6.

---

## Dependencies

```text
Phase 1 (T001–T003)
   └── Phase 2 Foundational (T004–T014): detector, accumulation, authority, detail read, chooser shell
          ├── Phase 3 US1 (T015–T018): accounts panel      ← MVP
          ├── Phase 4 US2 (T019–T024): sign-in + role panels, stale answers
          ├── Phase 5 US3 (T025–T031): volunteer hold, carry, undo
          └── Phase 6 US4 (T032–T035): super-user hold
                 └── Phase 7 Polish (T036–T040)
```

The four story phases depend only on Phase 2. They touch the same files (`mergeService.ts`,
`heldMergeService.ts`, `HeldMergeChooser.tsx`), so implementation tasks across stories are sequential. Test
tasks within a story are parallel.

## Parallel opportunities

- **Phase 1**: T002 and T003 (different files) once T001 exists.
- **Phase 2**: T009, T011 and T013 are test-writing in separate concerns and may be drafted together.
- **Each story**: its test tasks marked [P] (T015/T016; T019/T020/T021; T025/T026/T027/T030; T032/T034).
- **Phase 7**: T036, T037 and T038.

## Implementation strategy

**MVP = Phases 1–3.** Mel can answer her own holds from the queue: the most common case, and the one she
currently cannot act on at all.

**Then Phases 4 and 5, in either order.** Both are P1: the officer's existing holds, and the lockout.
Phase 5 carries the most risk, since it is the only place a merge grants access, so its undo tests
(T026) must pass before the phase is called done.

**Phase 6 last**, as P3: rare, but the widest access there is.

**Mel Maintenance closes** when T037 lands.

## Deviations recorded during implementation

Where the build differs from the tasks, contract or plan as written, and why:

- **`detectHold` returns `{ hold, apply }`, not a detection alone** (T005). `apply` holds only the answers
  valid for the pair now. The merge applies `apply`, never the raw answers, so an answer to a question that
  no longer arises cannot reach the code that deletes accounts and sign-ins.
- **The detail's candidates are one field, `candidates`**, shaped per reason, rather than the contract's
  `accounts` / `signIns` / `grants` / `volunteer` / `instruction`. It is the same shape the merge's held
  outcome already returns, so the chooser and an attempted merge describe a hold identically. Account ids
  are `accountId` and grant ids `grantId`, as they already were there.
- **T013's outcome tests** (completed, and held for the next decision) moved to T016, where the first
  panel exists to drive them.
- **A sign-in is chosen per contact, whole** (T019, T022, T024). Each candidate is one contact's address
  and Google account, either possibly absent, and the answer names exactly what that contact has. The
  resolve schema's "both ids together" rule contradicted the service, which already accepted an address
  alone where no Google account is bound; the schema now refuses only answers of two kinds at once. Found
  while building it: choosing the contact **without** a Google account left the other contact's account
  bound to the survivor, still granting access. The merge now discards the unchosen binding whichever
  sign-in is chosen.
- **The role question offers every one of the merged contact's roles** (T019, T024), with `conflict`
  null on the uncontested ones, which start ticked. The answer names every grant that moves, so listing
  only the contested ones would have made the merge drop the rest without anyone choosing to.
- **Stale is 409 `HELD_MERGE_STALE`; answering the wrong question stays 422
  `HELD_MERGE_REASON_MISMATCH`.** The kind check runs first, so an incomplete sign-in answer is still a
  mismatch, as 072's tests require.
- **Answering reads the hold without the auto-close sweep** (T023). The sweep would drop a stale stored
  answer and move the hold on first, and the answerer would then be told they answered the wrong
  question, when what happened is that an earlier answer stopped fitting.
- **`SUPER_USER_INSTRUCTION` lives in `mergeService.ts`**, re-exported from `heldMergeService.ts`, because
  the detector returns it as the super-user hold's candidates.
