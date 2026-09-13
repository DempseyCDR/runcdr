# Feature Specification: Undo merge

**Feature Branch**: `074-undo-merge`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: "undo merge, feature 074. Reverse a completed merge, restoring the retired
contact and everything the merge moved off it." Requirements session 2026-09-11, decisions D1–D6.

## Context

Merging two contact records is the only destructive action the mailing-list manager performs, and it is
the one action she cannot take back. Feature 069 made a merge *safe to attempt* — a merge that cannot be
completed is held, and writes nothing. Feature 072 made a merge *complete* — everything a person owns now
follows them to the surviving record. Neither made a merge **reversible**.

Today a mistaken merge is recovered by restoring the database. That is not a real option: it discards
every other change made since the backup, and it requires someone who is not the mailing-list manager.

The obstacle is that the merge does not record enough to reverse itself. It records how *much* moved, not
*what* moved, and in five places it destroys or overwrites data leaving no trace at all. Both are
addressed here, and both are changes to how a merge is *recorded* rather than to what a merge *does* —
which references a merge moves was settled by feature 072 and is not revisited.

This feature is aimed squarely at the recent mistake: the merge noticed within minutes, hours, or days.
Merges already in the database cannot be reversed and will not be, and older merges are expected to be
reconstructed by hand, accepting some loss of history. What the feature must never do is *pretend* — an
un-reversible merge must say so plainly, before and after the fact.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Take back a merge that was a mistake (Priority: P1)

The mailing-list manager merges two contact records, then discovers they are two different people — or
that she merged them the wrong way round and the wrong record survived. She opens the surviving contact,
finds the merge in its history, and undoes it. The retired contact comes back to life, and everything the
merge moved off it returns to it. She is shown exactly what was restored, and anything that could not be.

**Why this priority**: This is the feature. Without it, nothing else here has a purpose. It converts the
one irreversible action in the contact-maintenance workflow into a recoverable one, which is what allows
the mailing-list manager to work without escalating to whoever can restore a database.

**Independent Test**: Merge a pair, undo it immediately, and confirm both contact records are in their
pre-merge state — the retired contact is live again, its emails, memberships, attendance, performer
record, door sales and roles are back on it, and the surviving contact holds only what it held before.

**Acceptance Scenarios**:

1. **Given** a merge completed moments ago and nothing has changed since, **When** the mailing-list
   manager undoes it, **Then** both contacts are restored to their pre-merge state and the report
   confirms every recorded row was returned.
2. **Given** a merge that dropped a duplicate attendance row because both records were checked in to one
   event, **When** the merge is undone, **Then** the dropped row is recreated on the restored contact and
   both check-ins exist again.
3. **Given** a merge that discarded one of two competing membership accounts, **When** the merge is
   undone, **Then** the discarded account is recreated with the level, expiry and last-payment date it
   had, and the households that were folded together are separated again.
4. **Given** a row that moved in the merge was edited afterwards, **When** the merge is undone, **Then**
   the row returns to the restored contact carrying the later edit, and the edit is not lost.
5. **Given** a row that moved in the merge was deleted afterwards, **When** the merge is undone, **Then**
   the undo completes and the report names the row it could not return.
6. **Given** an undo has been performed, **When** the same merge is undone again, **Then** the request is
   refused and nothing changes.

---

### User Story 2 - Know whether a merge can be taken back (Priority: P2)

Looking at a contact record, the mailing-list manager can see every merge that produced it: when, by
whom, who was merged in, and — the point of this story — whether it can still be undone, and if not, why
not. Merges that predate this feature are shown as permanently un-reversible rather than offering an
action that would fail. For a merge that *can* be undone, she sees how long ago it happened and how much
has changed since, so she can judge whether reversing it is still sensible.

**Why this priority**: An undo nobody can find is not an undo, and today there is no merge history
surface at all — merges are recorded but never shown. Separately, an undo button that fails on old
merges would be worse than no button: it would teach the mailing-list manager that the safety net is
unreliable exactly when she needs to trust it.

**Independent Test**: View a contact produced by a pre-feature merge and confirm the history shows the
merge, marked un-reversible with its reason and no undo action. View one produced by a post-feature merge
and confirm the history shows the merge as reversible along with its age and activity since.

**Acceptance Scenarios**:

1. **Given** a contact that absorbed another in a merge recorded before this feature, **When** the
   mailing-list manager views its merge history, **Then** the merge is listed and marked as not
   reversible, with the reason stated, and no undo action is offered.
2. **Given** a contact that absorbed another after this feature shipped, **When** she views its merge
   history, **Then** the merge is offered as reversible, showing how long ago it occurred and how much
   has happened since.
3. **Given** a contact whose survivor has itself since been merged into a third contact, **When** she
   views the history, **Then** the inner merge is shown as not currently reversible, explaining that the
   later merge must be undone first.
4. **Given** a merge that has been undone, **When** she views the history, **Then** both the merge and
   its reversal are listed, with who performed each and when.

---

### User Story 3 - Restoring sign-in is an access decision (Priority: P3)

Undoing a merge can restore a second person's ability to sign in — either by returning a sign-in binding
to the contact that is coming back, or by recreating one the merge deleted. Changing who can sign in is
an access decision everywhere else in this system, and it stays one here. The mailing-list manager can
undo the merge; the sign-in portion is carried out only if she also holds role-assignment authority, and
is otherwise left alone and reported, so that the rest of the undo is not blocked by it.

**Why this priority**: It is the one part of an undo that *grants* something rather than separating
things that were wrongly joined, so it is the one part that needs a second key. It is P3 because it
affects only merges between two records that could both sign in — rare, and already the subject of a hold
today — and because the remainder of the undo is useful without it.

**Independent Test**: As a holder of duplicate-management authority alone, undo a merge that moved a
sign-in binding; confirm the undo completes, the sign-in portion is skipped, and the report says so.
Repeat as a holder of role-assignment authority and confirm the sign-in portion is carried out.

**Acceptance Scenarios**:

1. **Given** a merge that moved a sign-in binding to the surviving contact, **When** a holder of
   duplicate-management authority alone undoes it, **Then** everything else is restored, the binding is
   left where it is, and the report names it as skipped and why.
2. **Given** the same merge, **When** a holder of role-assignment authority undoes it, **Then** the
   binding returns to the restored contact along with everything else.
3. **Given** a merge that deleted one of two competing sign-in bindings, **When** a holder of
   role-assignment authority undoes it, **Then** the deleted binding is recreated on the restored
   contact and the address that was demoted is marked as a sign-in address again.

---

### Edge Cases

- **The survivor has since been merged into someone else.** Reversing the earlier merge would return rows
  to a contact that is itself retired, stranding them. Merges unwind most-recent-first or not at all.
- **The survivor or the restored contact has been archived since the merge.** The undo is refused rather
  than silently reviving an archived record.
- **A row that moved has since been deleted.** There is nothing to return; the undo completes and reports
  it.
- **A row the merge destroyed cannot be recreated** because the position it occupied is now taken — for
  example the same person was checked in to that event again after the merge. The undo completes, keeps
  the row that exists, and reports the one it did not recreate.
- **Activity after the merge belongs to the survivor.** A membership taken out, an event attended, or an
  email added to the surviving contact after the merge stays with the survivor. An undo returns only what
  the merge moved; it never removes data created afterwards.
- **The surviving record was edited to absorb the merged one's details** — a phone number retyped by
  hand, say. The undo cannot know this happened and will not remove it; the operator may be left with the
  detail on both records.
- **Two people undo the same merge at once.** One succeeds; the other is refused as already undone.
- *(Superseded in part by feature 077, 2026-09-13: deleting a contact now deletes its merge records instead of being refused. "The record is gone" is still not a case, because the merge record goes with it.)* **Neither contact in a merge can be deleted, so "the record is gone" is not a case.** The merge record
  permanently references both contacts, and the database refuses to delete a contact a merge record
  names. An earlier draft carried a "contact no longer exists" refusal; it was removed because no
  sequence of actions can reach it. It should not be reintroduced without first removing that protection.
- **Undoing a merge makes the pair a duplicate suggestion again.** This is intended — see Assumptions.

## Requirements *(mandatory)*

### Functional Requirements

Recording — what a merge must now write down (foundational; no user-visible behaviour of its own):

- **FR-001**: A merge MUST record, for every row it re-links, enough to identify that exact row and
  return it to the contact it came from.
- **FR-002**: A merge MUST record the complete prior content of every row it destroys, sufficient to
  recreate that row as it was. This covers the discarded sign-in binding, the discarded membership
  account, and the duplicate household-member and attendance rows dropped on collision.
- **FR-003**: A merge MUST record every field value it overwrites on a row it does not move, sufficient
  to restore the prior value. This covers the sign-in designation removed from the address that was not
  chosen.
- **FR-004**: A merge MUST record every row it creates, sufficient to remove it again. This covers the
  household memberships copied onto the surviving account when two accounts were folded together.
- **FR-005**: The record MUST be written in the same transaction as the merge itself. A merge that
  completes without a complete record MUST NOT be possible.
- **FR-006**: The record MUST be append-only. Undoing a merge MUST NOT alter or remove the record of that
  merge.

Reversibility — when an undo is available:

- **FR-007**: A merge MUST be treated as reversible only if it carries a complete record under FR-001 to
  FR-004. Merges recorded before this feature MUST be presented as permanently not reversible, with the
  reason given, and MUST NOT offer an undo action.
- **FR-008**: A merge MUST be reversible only while the contact that survived it is itself live — not
  merged into any other contact. Where merges form a chain, the most recent MUST be undone first.
- **FR-009**: A merge MUST NOT be reversible if either contact involved has been archived since.
- **FR-010**: A merge that has already been undone MUST NOT be undone again.
- **FR-011**: There MUST be no time limit on reversibility. Age MUST be surfaced as information, not
  enforced as a cut-off.

The reversal itself:

- **FR-012**: An undo MUST return the retired contact to life, with its own fields unchanged.
- **FR-013**: An undo MUST return every recorded re-linked row to the contact it came from, carrying any
  changes made to that row since the merge.
- **FR-014**: An undo MUST recreate every recorded destroyed row on the restored contact.
- **FR-015**: An undo MUST restore every recorded overwritten field value.
- **FR-016**: An undo MUST remove every row the merge created.
- **FR-017**: An undo MUST recompute the derived membership status of **both** contacts.
- **FR-018**: An undo MUST skip, rather than fail on, any row that no longer exists or that can no longer
  be returned or recreated, and MUST report each such row and the reason.
- **FR-019**: An undo MUST be all-or-nothing: either the whole reversal is applied or none of it is, and
  a failure part-way MUST leave the merge intact. This governs **unanticipated** failure only, and does
  not conflict with FR-018: a condition FR-018 names — a row gone, a position taken, authority absent —
  is a skip, and a skip is a successful outcome, not a failure. Anything else aborts the whole reversal.
- **FR-020**: An undo MUST report what it restored, per kind of record, and what it could not.
- **FR-021**: An undo MUST be recorded — who performed it, when, which merge it reversed, and what it was
  unable to restore — and that record MUST appear in the merge history alongside the merge.
- **FR-022**: An undo MUST NOT remove or alter data created after the merge.

Authority:

- **FR-023**: Undoing a merge MUST require duplicate-management authority — the same authority that
  performs a merge.
- **FR-024**: Any part of an undo that changes who can sign in — returning a sign-in binding to the
  restored contact, or recreating a deleted one, together with the sign-in designation on the address
  that labels it — MUST additionally require role-assignment authority.
- **FR-025**: Where the actor lacks role-assignment authority, the undo MUST proceed without the sign-in
  portion and report it as skipped, rather than refusing the whole reversal.

Visibility:

- **FR-026**: The merges that produced a contact MUST be visible on that contact's record: when, by whom,
  which contact was merged in, and whether it can be undone.
- **FR-027**: A merge shown as reversible MUST display how long ago it occurred and an indication of how
  much has changed since, so the operator can judge whether reversing it is still sensible.
- **FR-028**: A merge shown as not reversible MUST state which condition makes it so.
- **FR-029**: Before a merge is carried out, the operator MUST be told that it will be reversible, so
  that the presence of the safety net is known in advance and not only discovered afterwards.

### Key Entities

- **Merge record**: the existing append-only statement that a merge happened — who, when, canonical and
  retired contact. Extended by this feature to carry the reversal manifest, and to be readable rather
  than write-only.
- **Reversal manifest**: everything needed to undo one merge — the identity of each re-linked row and
  where it came from, the full prior content of each destroyed row, the prior value of each overwritten
  field, and the identity of each created row. Written by the merge, read by the undo, never amended.
- **Undo record**: who reversed a merge, when, and the outcome — what was restored and what could not be,
  with reasons. Sits alongside the merge record in the same history.
- **Reversibility verdict**: for any given merge, whether it can be undone now, and if not, which
  condition prevents it — no manifest, survivor since merged, a contact since archived, or already
  undone. Those four are exhaustive.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A merge discovered to be a mistake can be reversed by the person who made it, unaided, in
  under two minutes from opening the contact record — with no database restoration and no escalation.
- **SC-002**: For a merge undone with no intervening activity, 100% of the records the merge moved,
  destroyed, overwrote or created are returned to their pre-merge state.
- **SC-003**: No undo offered to an operator ever fails for want of a sufficient record: a merge is
  offered as reversible only when it can in fact be reversed.
- **SC-004**: An operator can determine, from the contact record alone and without assistance, whether
  any given past merge can be undone and why not if it cannot.
- **SC-005**: No undo removes or alters any record created after the merge it reverses.
- **SC-006**: Every undo produces a statement of what was and was not restored, with a reason for each
  omission — no undo completes silently.

## Assumptions

- **Undo does not mark the pair as "not duplicates."** After an undo the two contacts will be proposed as
  a duplicate pair again. That is deliberate: reversing a merge because it ran in the *wrong direction* —
  the wrong record survived — is an expected primary use, and recording a rejection would block the
  immediate re-merge that follows. An operator who has decided the pair are genuinely different people
  can reject the pair with the existing control.
- **Restoring sign-in is gated, and a skipped restoration is real unfinished work.** An earlier draft
  assumed automatic enrolment would repair it: the address returns with the undo, so the person simply
  signs in again. That is true only from a *different* Google account. The sign-in path checks the known
  Google account binding first, and while that binding still points at the survivor the attempt is
  refused before enrolment is reached. So the gate in FR-024 protects the deliberate grant of access, but
  the skip it produces must be acted on by someone holding role-assignment authority rather than left.
- **Reversibility begins now.** Every merge already recorded stays un-reversible. There is no backfill,
  no reconstruction from existing data, and no repair routine — the existing record holds counts, not
  identities, and nothing distinguishes a row that moved from one the survivor always had.
- **Old merges are reconstructed by hand.** For a merge that cannot be undone, the expectation is manual
  reconstruction accepting some loss of history. The feature does not assist with this beyond stating
  clearly that the merge is not reversible.
- **The feature is tuned for the recent mistake.** Minutes to days. It remains available indefinitely
  (FR-011), but the information shown alongside an old merge is there precisely because reversing one
  becomes progressively less meaningful as activity accumulates.
- **What a merge moves is unchanged.** The classification of every reference to a contact, settled in
  feature 072, is not revisited. This feature changes what a merge *records*, not what it *does* — with
  the single exception that recording must now occur inside the merge transaction.
- **Merge chains exist in the live data** and are not rare, so the most-recent-first rule (FR-008) is a
  real constraint rather than a theoretical one.
- Existing duplicate-management and role-assignment authorities are reused as-is; no new authority is
  introduced.

## Out of Scope

- The held-merge resolution chooser interface, still unbuilt for all three hold reasons. Tracked in
  `specs/phase-8-requirements/mel-maintenance-remaining.md`.
- Any change to which references a merge moves, or to the hold conditions that stop a merge. Feature 072
  settled both.
- Backfilling, reconstructing or repairing merges recorded before this feature.
- Re-merging as a single action. After an undo, a re-merge is an ordinary merge.
