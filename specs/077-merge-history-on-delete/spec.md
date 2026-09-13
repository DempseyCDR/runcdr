# Feature Specification: Merge history on delete

**Feature Branch**: `077-merge-history-on-delete`

**Created**: 2026-09-13 (written after implementation began — see Notes)

**Status**: Implemented, pending review

**Input**: Mel Maintenance close-out list §2c. Finding confirmed against the test database on 2026-09-12;
direction decided by Rich on 2026-09-13, including that anyone who has ever acted as staff is never
deleted.

## Context

Feature 074 made a merge reversible, and made undo a **short-term** recovery. But a contact that had ever
been in a merge could never be deleted — undone or not, survivor or merged-away — because the record of
the merge pinned both contacts forever. The delete check did not know this, so the refusal surfaced as a
raw database error rather than the readable refusal the mailing-list manager gets for every other reason.

Three cases were confirmed by running them, not inferred:

| Case | What happened |
|---|---|
| A. A merged-away contact | Passed the delete check as bare, then failed with a raw database error. |
| B. Both contacts **after an undo** | Both live, both bare, both failed the same way. The reachable case: after undoing a mistaken merge, deleting the unwanted duplicate is the natural next step. |
| C. A super-user's unrestricted delete of an undone participant that pays for a membership | The membership account was deleted, then the delete failed — the account gone and the contact still there. |

The permanence was never a decision. A held merge and a "not duplicates" judgement — the merge record's
two closest relatives — have always been deleted with their contact.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Delete the unwanted contact after undoing a merge (Priority: P1)

The mailing-list manager merges two contacts, realises it was a mistake, undoes it, and wants to delete
the contact she never meant to keep. The delete succeeds, and the record of the undone merge goes with the
deleted contact.

**Why this priority**: This is the case feature 074 made reachable, and the one that failed with a raw
error. Without it, undo leaves every mistaken duplicate permanently in the database.

**Independent Test**: Merge two bare contacts, undo, delete one; confirm it is gone, the other remains,
and no merge or undo record names the deleted contact.

**Acceptance Scenarios**:

1. **Given** a merge that has been undone and a restored contact with nothing else attached, **When** the
   mailing-list manager deletes it, **Then** it is deleted and the merge and its undo record are gone.
2. **Given** the same undone merge, **When** the other contact is deleted instead, **Then** that delete
   succeeds too.
3. **Given** a merged-away contact that has not been restored, **When** it is deleted, **Then** the delete
   succeeds and its merge record is gone.

---

### User Story 2 - A survivor's merged-in contacts go with it, but only deliberately (Priority: P2)

A contact that other contacts were merged into carries them: deleting it deletes them too, down the whole
chain. Because a mistaken merge may hold a different person, the mailing-list manager's ordinary delete
refuses such a contact and says why, advising her to undo the merges first if any were mistakes. A
super-user's unrestricted delete may proceed, and takes the chain with it.

**Why this priority**: Deleting a person should remove their leftover merged-away records, which still
carry their name and phone. But it must not quietly delete a different person hiding behind a mistaken
merge.

**Independent Test**: Merge A into B and B into C. As the mailing-list manager, try to delete C and
confirm the refusal names the merged-in contacts and advises undo. As a super-user, force-delete C and
confirm A, B and C are all gone.

**Acceptance Scenarios**:

1. **Given** a survivor with at least one contact merged into it, **When** the mailing-list manager
   deletes it, **Then** the delete is refused, the message says other contacts were merged into it and
   would be deleted too, and advises undoing those merges first or archiving; nothing is deleted.
2. **Given** a chain A → B → C, **When** a super-user force-deletes C, **Then** A, B and C are all
   deleted, and none of them is left behind as an active contact.

---

### User Story 3 - Anyone who has acted as staff is never deleted (Priority: P2)

A contact who has ever acted as staff cannot be deleted by anyone, by either path. The refusal is readable,
says that staff are never deleted, and points to archive as the way to retire them.

**Why this priority**: Accountability for what someone did as staff outlives their role. This was already
true at the database, but surfaced as a raw error; and without an explicit check, deleting a survivor
could reach a merged-in staff member through the cascade and fail the same raw way.

**Independent Test**: Give a throwaway contact a record of having acted as staff; confirm both the ordinary
and the unrestricted delete are refused with the archive advice, and that it survives. Then merge that
contact into another and confirm force-deleting the survivor is refused too.

**Acceptance Scenarios**:

1. **Given** a contact that has acted as staff, **When** the mailing-list manager or a super-user deletes
   it, **Then** the delete is refused, the message says staff are never deleted and to archive instead,
   and the contact remains.
2. **Given** a staff contact merged into a survivor, **When** a super-user force-deletes the survivor,
   **Then** the delete is refused for the same reason and both contacts remain.

---

### User Story 4 - A failed delete changes nothing (Priority: P3)

A delete either completes entirely or leaves everything as it was. It never removes part of what belongs to
a contact and then stops.

**Why this priority**: Case C lost a membership account's level, expiry and last-payment date with nothing
to show for it. Rare, but unrecoverable without a database restore.

**Independent Test**: Not walkable by hand — it needs a failure forced part-way through a delete. Covered
by an automated test against the real database.

**Acceptance Scenarios**:

1. **Given** an unrestricted delete of a contact that pays for a membership, **When** the delete fails after
   its first changes, **Then** the contact and the membership account both still exist.

---

### Edge Cases

- **Deleting a merged-away contact on its own destroys the survivor's undo** for that merge, since the
  record the undo needs goes with it. Merged-away contacts are not reachable through search, so in
  practice this is the unrestricted API path only.
- **Force-deleting a survivor whose merge is still reversible** removes the merged-in contact outright; the
  chance to undo goes with it. The ordinary delete's refusal is the guard.
- **A merged-in contact that acted as staff** blocks the whole chain's delete — see User Story 3.
- **A contact with several reasons to refuse**: the message names them all, and the staff advice takes
  precedence, since undoing merges would still not make a staff member deletable.
- **Merges recorded before feature 074** follow the same rule: deleting a contact now removes its merge
  history, however old.

## Requirements *(mandatory)*

### Functional Requirements

Merge history:

- **FR-001**: Deleting a contact MUST delete every merge record naming it, as survivor or as merged-away
  contact, and the undo record of each such merge.
- **FR-002**: A contact MUST NOT be refused deletion merely because it took part in a merge, whether or not
  the merge was undone.

Survivors:

- **FR-003**: Deleting a survivor MUST delete every contact merged into it, at any depth.
- **FR-004**: Deleting a survivor MUST NOT leave any merged-in contact restored to active.
- **FR-005**: The ordinary delete MUST refuse a survivor that has any contact merged into it, name that as
  the reason, and advise undoing those merges first if any were mistakes, or archiving.
- **FR-006**: The unrestricted delete MUST be allowed to delete such a survivor, subject to FR-007.

Staff:

- **FR-007**: A contact that has ever acted as staff MUST NOT be deleted by the ordinary or the unrestricted
  delete.
- **FR-008**: FR-007 MUST be checked for the contact being deleted **and every contact merged into it**.
- **FR-009**: The staff refusal MUST say that anyone who has acted as staff is never deleted, and advise
  archiving instead.

All deletes:

- **FR-010**: Every refusal MUST be a readable message naming each reason. No delete may fail with a raw
  database error for any reason this feature covers.
- **FR-011**: A delete MUST be all-or-nothing.
- **FR-012**: Any kind of record that would block a delete MUST be known to the delete check. A new one
  that is not MUST be caught before release, not discovered in use.
- **FR-013**: Every successful delete MUST still be recorded in the audit trail, as part of the same
  all-or-nothing change.

### Key Entities

- **Merge record**: that a merge happened, naming the survivor and the merged-away contact. Now deleted
  with either contact.
- **Undo record**: that a merge was reversed. Deleted with its merge record.
- **Merged-in chain**: every contact merged into a survivor, directly or through other merged-away
  contacts.
- **Staff history**: any record naming a contact as the one who did something as staff — an audited
  action, granting a role, judging a pair "not duplicates", attempting a merge, or approving a volunteer.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After an undo, 100% of restored contacts with nothing else attached can be deleted by the
  mailing-list manager in one attempt.
- **SC-002**: No delete covered by this feature ends in a raw database error; every refusal is a readable
  message naming its reason.
- **SC-003**: No delete ever leaves part of a contact's data removed while the contact remains.
- **SC-004**: No contact that has acted as staff is deleted, by any path, including through a survivor's
  merged-in chain.
- **SC-005**: No merged-in contact is ever left active after its survivor is deleted.

## Assumptions

- **"The delete must say so" is met by a refusal, not a confirmation step.** The ordinary delete refuses a
  survivor with merged-in contacts; the unrestricted delete proceeds. This reuses the existing
  ordinary/unrestricted split rather than adding a confirm-and-proceed flow. *Chosen during
  implementation; confirm or change at review.*
- **"Acted as staff" is broad, and deliberately literal.** It includes any audited action by the contact —
  and the audit trail records **viewing a contact's email or phone** as staff, and **being refused** an
  action, not only changes. So in practice any volunteer who has ever opened contact details on a staff
  screen can never be deleted. Signing in alone does not count. This follows the decision of 2026-09-13 as
  written; narrowing it would mean choosing which audited actions count, which is a separate decision.
- **Archive remains the way to retire** a staff member, or a survivor whose merges should not be undone.
- **Existing merge history is covered.** The change applies to every merge record already in the
  database, not only new ones.

## Out of Scope

- Changing who may delete (ordinary delete: `contact.delete`; unrestricted: super-user).
- Narrowing the definition of "acted as staff".
- A confirmation step before deleting a survivor's chain.
- The volunteer lockout on merge and the held-merge resolution chooser — feature 078.

## Notes

This spec was written after the implementation, at Rich's request, when it was noticed that 077 had only a
plan. The plan (`plan.md`) was written first and is consistent with it; the requirements here are the
behaviour the automated tests already assert, stated for review.
