# Feature Specification: Merge access decisions

**Feature Branch**: `078-merge-access-decisions`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: "078" — the last open items on the Mel Maintenance close-out list
(`specs/phase-8-requirements/mel-maintenance-remaining.md`): §2a, a merge can silently revoke a volunteer's
access; and §3, the held-merge resolution chooser. Rich has decided all open items land before Mel
Maintenance closes.

## Context

When two contact records are merged and completing it needs a decision nobody has made, the merge is
**held** — it writes nothing, and the question waits in the mailing-list manager's review queue. Three
reasons exist today: both records can sign in, both records pay for a membership, or the merge would give
one person role-assigning authority or two offices that must stay separate.

Two problems remain, and a third surfaced while specifying:

1. **There is no way to answer a hold.** The review queue's **Resolve** only opens a contact record. The
   answers can be recorded behind the scenes, but no screen asks the question — so the only thing anyone
   can do with a held merge is **Don't merge**, even when the decision is the mailing-list manager's own.
2. **A merge can silently lock a volunteer out.** Found walking feature 074's manual pass: a mailing-list
   manager's record merged into a non-volunteer record completed, and afterwards **neither address could
   sign in**, with no message. Volunteer status belongs to the person but is not carried, held or even
   considered by a merge, so the survivor received the volunteer's roles and sign-in while not being a
   volunteer — a state the system refuses to create any other way.
3. **Found while specifying:**
   - **Super-user access can move through a merge.** Super-user can only ever be granted from the command
     line, never through the app. But a merge moves a role-assigning role without holding whenever the
     survivor already has role-assigning authority — so merging a super-user's record into a President's
     makes the President a super-user, through the app, with no one deciding it.
   - **A pair that needs two decisions gets stuck.** When a held merge is answered and the retry then needs
     a *different* decision, the review queue keeps showing the first question, and answering it again
     changes nothing.

These are the fourth and fifth rules the merge has been found walking past, after feature 072's office
exclusivity and role-assigning escalation.

## Clarifications

### Session 2026-09-13

- Q: Should the chooser cover every hold reason? → A: **One chooser for all reasons**, each answerable only
  by the authority its reason requires.
- Q: What should a merge do when the merged contact is a volunteer and the survivor is not? → A: **Hold it
  for an officer**, who may carry volunteer status across with its approval.
- Q: What should a merge do when the merged contact holds super-user? → A: **Proceed only if the survivor
  is already a super-user.** Super-user must never be moved onto anyone who is not already a super-user;
  the command line must be used. (A super-user can grant themselves any role, so a survivor that is
  already a super-user gains nothing.)

### Session 2026-09-14

- Q: Should a President be able to answer holds? → A: **Yes.** (Raised by `/speckit-analyze`: a President
  holds role-assigning authority but not duplicate-management authority, and every hold screen required the
  latter — so before this feature a President could not even see a hold.)

### Session 2026-09-14 (manual pass)

- Finding: a President opened a held pair from the duplicates queue. The comparison offered merge buttons
  the server refused, with nothing on screen, and gave no way to the hold she could answer. → A: **Apply
  all three fixes** — merging and "not duplicates" are offered only to someone who may merge; a held pair
  sends people to its hold from the row and the comparison; a refused action says why. Captured as FR-017.
- Finding (§6): on a pair needing an accounts and a volunteer decision, Mel could not see her question
  until an officer had answered his. → A: **Reorder** — the accounts question comes straight after
  super-user, since no access decision changes it (research R4).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The mailing-list manager answers a two-accounts hold herself (Priority: P1)

Two records for one person each pay for a membership, so merging them was held. The mailing-list manager
opens the hold from her review queue and sees both accounts side by side — level, expiry, last payment and
who each covers. She is told plainly that the account she does not choose is deleted, that everyone it
covers moves to the chosen one, and that the merge can be undone afterwards. She chooses, and the merge
completes.

**Why this priority**: This is the one hold that is entirely the mailing-list manager's to decide, and she
currently cannot decide it. It is the most common hold in contact maintenance.

**Independent Test**: Hold a merge of two paying contacts; as the mailing-list manager, open it, choose an
account, and confirm the merge completes with the chosen account kept and everyone covered by both
accounts covered by it.

**Acceptance Scenarios**:

1. **Given** a merge held because both contacts pay for a membership, **When** the mailing-list manager
   opens it, **Then** she sees both accounts' level, expiry date, last payment date and covered members,
   and a statement that the unchosen account will be deleted and the merge can be undone.
2. **Given** that view, **When** she chooses an account and confirms, **Then** the merge completes, the
   hold leaves her queue, and she is told it completed.
3. **Given** that view, **When** she chooses **Don't merge** instead, **Then** nothing changes and the hold
   leaves her queue.

---

### User Story 2 - An officer answers a sign-in or role hold; everyone else sees what is waiting (Priority: P1)

A merge held because both records can sign in, or because it would compound someone's roles, is an access
decision for an officer who can assign roles. That officer opens the hold and answers it on the same kind
of screen: which sign-in survives, or which of the merged contact's roles move. The mailing-list manager
opening the same hold sees exactly what is being decided and that it is waiting on an officer, and can
still choose **Don't merge**.

**Why this priority**: Without it, sign-in and role holds can only ever be abandoned, and the pair stays
duplicated indefinitely.

**Independent Test**: Hold a merge of two contacts that can both sign in. As the mailing-list manager,
confirm the hold is explained and cannot be answered; as an officer, choose a surviving sign-in and confirm
the merge completes with that sign-in.

**Acceptance Scenarios**:

1. **Given** a merge held because both contacts can sign in, **When** an officer opens it, **Then** each
   record's sign-in is shown — the Google account and the address that labels it — and choosing one keeps
   that account and address together and completes the merge.
2. **Given** a merge held for a role conflict, **When** an officer opens it, **Then** each of the merged
   contact's roles is shown with why it conflicts, and the officer ticks which move; choosing none is a
   valid answer.
3. **Given** either hold, **When** someone without role-assigning authority opens it, **Then** they see
   what is being decided, that it is waiting on an officer, and **Don't merge** — but no way to answer it.
4. **Given** a pair that needs more than one decision, **When** the first is answered, **Then** the next
   is presented straight away, and the review queue shows the decision actually outstanding — never one
   already answered.

---

### User Story 3 - A merge never silently locks out a volunteer (Priority: P1)

Merging a volunteer's record into a record that is not a volunteer is **held for an officer**. The
officer opens it in the chooser, sees that completing it would make the survivor a volunteer, and either
carries volunteer status across — with its approval date and approver — or declines. The mailing-list
manager sees it waiting on an officer. Making the survivor a volunteer is an access decision: once the
survivor is a volunteer, anyone who controls the survivor's own email address can sign in, so it is never
done on the mailing-list manager's authority alone.

**Why this priority**: This produced a real lockout with no message, and recovering needed an undo by an
officer. It also decides whether a merge can ever grant access, which no merge has done before.

**Independent Test**: Merge a mailing-list manager's record into a non-volunteer record; confirm the
merge is held and the mailing-list manager cannot answer it; as an officer, carry volunteer status across
and confirm the merge completes and the person can sign in.

**Acceptance Scenarios**:

1. **Given** a volunteer merged into a non-volunteer, **When** the merge is attempted, **Then** it is held
   for an officer and nothing is written.
2. **Given** that hold, **When** an officer carries volunteer status across, **Then** the merge completes,
   the survivor is a volunteer with the merged contact's approval date and approver, and the person can
   sign in.
3. **Given** that hold, **When** the mailing-list manager opens it, **Then** she sees it waits on an
   officer and can choose **Don't merge**, but cannot carry volunteer status across.
4. **Given** that hold, **When** an officer makes the survivor a volunteer on the access screen instead,
   **Then** the hold closes itself and the merge can be completed.
5. **Given** a survivor that is already a volunteer, **When** a volunteer is merged into it, **Then** the
   merge proceeds as today — nothing new is decided.

---

### User Story 4 - Super-user access never moves through the app (Priority: P3)

Super-user access is granted only from the command line. A merge involving a super-user proceeds only
when the survivor is **already** a super-user — a super-user can grant themselves any role, so such a
survivor gains nothing. Otherwise the merge is held, and **no one can answer it in the app**: the queue
says super-user can only be granted at the command line, and once the survivor has been made a super-user
there, the merge can complete.

**Why this priority**: Rare — the club has one or two super-users — but it is the widest access there is,
and today it moves silently.

**Independent Test**: Merge a super-user's record into a President's; confirm it is held with no in-app
answer, even for an officer. Grant the President super-user at the command line; confirm the merge then
completes. Separately, merge one super-user's record into another's and confirm it completes directly.

**Acceptance Scenarios**:

1. **Given** a super-user merged into a contact that is not a super-user — including one that already has
   role-assigning authority — **When** the merge is attempted, **Then** it is held and nothing is written.
2. **Given** that hold, **When** anyone opens it, including an officer, **Then** there is no way to answer
   it; the screen says super-user can only be granted at the command line, and offers **Don't merge**.
3. **Given** that hold, **When** the survivor is made a super-user at the command line, **Then** the hold
   closes itself and the merge can be completed.
4. **Given** a super-user merged into a contact that is already a super-user, **When** the merge is
   attempted, **Then** it proceeds without a hold.

---

### Edge Cases

- **The situation changed while the hold waited** — an account was deleted, a sign-in removed, a role
  revoked. Answering against stale information is refused with a message, and the queue offers the hold as
  it now stands; a hold whose obstacle has gone closes itself, as today.
- **Two people answer the same hold** at once: one completes; the other is told it was already answered.
- **A resolved merge is still reversible.** Every merge completed through a chooser can be undone like any
  other, and the chooser says so before the decision.
- **A contact with a membership and a sign-in and a role conflict** is held for each in turn, and each
  answer is given by whoever holds that decision's authority.
- **Nobody can answer a super-user hold in the app**: the queue must say so, rather than show a hold that
  looks answerable. The command line can only grant a role, not remove one, so the way forward is to make
  the survivor a super-user there.
- **A merge held for volunteer status and a role conflict** — a mailing-list manager merged into a
  non-volunteer that the officer would also have to settle roles for — is presented as each decision in
  turn, per FR-008.

## Requirements *(mandatory)*

### Functional Requirements

The chooser:

- **FR-001**: Opening a held merge from the review queue MUST show a screen that asks the hold's actual
  question, with the information needed to answer it.
- **FR-002**: For a two-accounts hold, the screen MUST show each account's level, expiry date, last payment
  date and covered members, and state that the unchosen account is deleted and everyone it covers moves to
  the chosen one.
- **FR-003**: For a two-sign-ins hold, the screen MUST show each record's sign-in — its Google account and
  the address that labels it — and choosing one MUST keep that account and address together.
- **FR-004**: For a role-conflict hold, the screen MUST show each of the merged contact's roles, why it
  conflicts, and let the answerer choose which move, including none.
- **FR-005**: Only someone holding the hold's authority MUST be able to answer it: the mailing-list
  manager's for two accounts; role-assigning authority for sign-ins, roles and volunteer status; and no one,
  in the app, for super-user.
- **FR-005a**: Holds MUST be visible to, and declinable by, anyone holding duplicate-management authority
  **or** role-assigning authority. A President — who has role-assigning authority but not
  duplicate-management authority — MUST be able to see every hold and answer the ones that are theirs.
- **FR-006**: Anyone who can see a hold but not answer it MUST see what is being decided, that it waits on
  someone with the required authority, and **Don't merge**.
- **FR-007**: Every chooser MUST state, before the answer is confirmed, that the resulting merge can be
  undone.
- **FR-008**: After an answer, the answerer MUST be told the outcome — completed, or held for a further
  decision — and a further decision MUST be presented straight away to someone who can answer it.
- **FR-009**: The review queue MUST always show the decision actually outstanding for a pair, never one
  already answered.
- **FR-010**: An answer given against information that has since changed MUST be refused with a message,
  not applied.

Volunteers:

- **FR-011**: A merge MUST NOT complete leaving role grants or a sign-in on a survivor that is not a
  volunteer.
- **FR-012**: A merge whose merged contact is a volunteer and whose survivor is not MUST be held for
  someone with role-assigning authority, who may carry volunteer status across or decline. Making the
  survivor a volunteer on the access screen instead MUST close the hold.
- **FR-013**: Where volunteer status does pass to the survivor, its approval date and approver MUST pass
  with it.

Super-user:

- **FR-014**: A merge MUST NOT give any contact super-user access.
- **FR-015**: A merge whose merged contact is a super-user MUST proceed only if the survivor is already a
  super-user. Otherwise it MUST be held with no way to answer it in the app, for anyone; the hold MUST say
  super-user can only be granted at the command line, and MUST close itself once the survivor has been
  made a super-user there.

Rules a merge walks past:

- **FR-016**: Every rule the system enforces when access is granted through the access screen — office
  exclusivity, role-assigning escalation, the volunteer requirement, super-user being command-line only —
  MUST be either enforced by the merge or deliberately held, and the feature MUST check for any further
  such rule rather than fixing only those already found.
- **FR-017**: A suggested pair MUST offer only the actions its viewer may take: merging and marking not
  duplicates to someone with duplicate-management authority, sharing an address to someone who maintains
  addresses, and otherwise a view-only comparison. A pair whose merge is held MUST say so and lead to the
  held merge — for anyone who can see holds — instead of offering the merge again. Any refused action MUST
  say why.

### Key Entities

- **Held merge**: a merge that could not complete without a decision — which pair, why, who attempted it,
  and whether it has been answered or abandoned. Its reason must be the decision still outstanding.
- **Hold reason**: two sign-ins, two paying accounts, role conflict — and, new in this feature, volunteer
  status (answerable by an officer) and super-user (answerable by no one in the app).
- **Answer**: the decision that completes a held merge — which account, which sign-in, which roles move,
  whether volunteer status passes. A super-user hold has no answer; it closes when its cause is removed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every held merge in the review queue can be declined from the queue, and every held merge
  except a super-user one can also be answered there, without opening another screen or asking anyone to
  change data behind the scenes. A super-user hold's only answer is a command-line grant, by design.
- **SC-002**: The mailing-list manager can answer a two-accounts hold unaided, in under two minutes from
  opening it.
- **SC-003**: No merge leaves a person unable to sign in who could sign in before it.
- **SC-004**: No contact gains super-user access through anything done in the app — only a contact that is
  already a super-user can receive a merged super-user's record.
- **SC-005**: The review queue never shows a held merge asking a question that has already been answered.

## Assumptions

- **Who answers is unchanged; who can see is widened.** Two-accounts holds are the mailing-list manager's;
  sign-in, role and volunteer holds need role-assigning authority (Vice-President, President, Super-user),
  as in features 069 and 072. But the hold screens used to require duplicate-management authority just to
  open, which a President lacks — so a President could never see a hold. Seeing and declining a hold now
  needs either authority (FR-005a).
- **A hold's obstacle can still be removed instead of answered** — for example revoking a role on the access
  screen — and the hold closes itself, as today.
- **The screen reuses the review queue's existing surfaces** rather than adding a new page.
- **Undo is unchanged.** A merge completed through the chooser records what it did like any other
  (feature 074).

## Out of Scope

- Changing which records a merge moves, or the merge's own detection of sign-in and account collisions.
- Designating or approving volunteers generally — only what a merge does with volunteer status.
- The staff-deletion rule and merge history on delete — feature 077.
