# Feature Specification: A sign-out control for staff

**Feature Branch**: `083-staff-sign-out`

**Created**: 2026-09-20

**Status**: Draft

**Input**: User description: "B53"

Backlog **B53**, raised during the feature 082 walk-through on 2026-09-18: signing out is possible on the
server but impossible in the app. A volunteer who wants to hand the door phone to the next person, or to
look at a page as a different role, has no way to end their session short of clearing the browser's
cookies.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ending your own session (Priority: P1)

A volunteer who is signed in can sign out from wherever they are working, and is returned to the public
site with their session ended. Signing in again requires the usual sign-in.

**Why this priority**: This is the whole of the backlog item. Everything else here is a refinement of it,
and without it the feature does not exist.

**Independent Test**: Sign in as any volunteer, use the sign-out control, and confirm that a staff page
now asks for sign-in rather than opening.

**Acceptance Scenarios**:

1. **Given** a signed-in volunteer on a staff page, **When** they choose **Sign out**, **Then** their
   session ends and they arrive at the public home page.
2. **Given** a volunteer who has just signed out, **When** they open a staff page, **Then** they are
   asked to sign in.
3. **Given** a volunteer who has just signed out, **When** they use the browser's Back button, **Then**
   no staff page opens without signing in again.
4. **Given** nobody is signed in, **When** the public site is browsed, **Then** no sign-out control is
   offered.

---

### User Story 2 - Handing the phone to the next volunteer (Priority: P2)

The door phone is shared: one volunteer finishes the door shift and hands it to the next. The person
holding it can see whose session it currently holds, so they know whether to carry on or to sign out and
sign in as themselves.

**Why this priority**: It is what makes the control trustworthy on a shared device — the entries a
volunteer records are attributed to whoever is signed in, and feature 082 shows "recorded by" against
them. In scope (decided 2026-09-20), but the sign-out control alone already unblocks the hand-over, so it
follows User Story 1.

**Independent Test**: Sign in as one volunteer on a phone-sized screen, confirm the signed-in name is
shown, sign out, sign in as another, and confirm the name has changed.

**Acceptance Scenarios**:

1. **Given** a signed-in volunteer on a staff page, **When** they open the volunteer menu, **Then** they
   see the name of the person whose session the device holds, beside the sign-out control.
2. **Given** a shared phone at the door, **When** one volunteer signs out and the next signs in, **Then**
   what the next volunteer records is attributed to them, not to the previous volunteer.

---

### User Story 3 - Checking a page as another role (Priority: P3)

Someone testing or supporting the app signs out and back in as a different volunteer, to see a page as
that role sees it — the door's view rather than the Financial Secretary's, for example.

**Why this priority**: This is the occasion that raised B53, but it is a maintainer's convenience rather
than a volunteer's need, and User Story 1 already delivers it.

**Independent Test**: Sign out and sign in as an account holding different capabilities, and confirm the
same page offers different controls.

**Acceptance Scenarios**:

1. **Given** a volunteer signed in with one set of capabilities, **When** they sign out and sign in as an
   account with another, **Then** the pages they open offer the second account's controls.

---

### Edge Cases

- **A session that has already ended** (expired, or revoked elsewhere): choosing sign out still leaves the
  volunteer signed out and on the public home page, with no error.
- **Signing out twice**, for instance from two tabs: the second attempt behaves the same as the first.
- **Unsaved work**: the gate page already warns before leaving with unsaved figures; signing out from it
  must not slip past that warning.
- **A mis-tap on a phone**: the control must not sit where a thumb lands by accident while working — see
  the assumption about placement below.
- **Someone else's link or image**: an invitation to sign out that did not come from the volunteer's own
  use of the control must not end their session.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A signed-in volunteer MUST be offered a **Sign out** control in the volunteer menu, which
  renders on **every** page whenever a volunteer is signed in — staff pages and public pages alike — and
  on none at all when nobody is (research R1).
- **FR-002**: Choosing it MUST end the session, so that every staff page and every staff request made
  afterwards requires signing in again.
- **FR-003**: After signing out, the volunteer MUST arrive at the public home page, which MUST be
  reachable and useful while signed out.
- **FR-004**: The control MUST NOT be offered when nobody is signed in.
- **FR-005**: The volunteer menu MUST show the name of the volunteer whose session the device holds,
  beside the sign-out control.
- **FR-006**: Signing out MUST be the deliberate act of the person holding the device: content elsewhere —
  a link, an image, a page that loads something — MUST NOT be able to end a volunteer's session.
- **FR-007**: The control MUST be usable on a phone: reachable without zooming, and with a touch target no
  smaller than the other controls in the menu.
- **FR-008**: Signing out MUST leave the records a volunteer made intact, and MUST leave every other
  signed-in volunteer's session untouched.
- **FR-009**: A sign-out MUST be recorded in the audit trail, as a sign-in already is. *(Already true —
  research R3; no work.)*
- **FR-011**: Signing in MUST let the person CHOOSE which account to use. Ending the club's session does
  not end the identity provider's, so a sign-in that does not ask silently returns the account already
  signed in there — and the next volunteer at a shared phone becomes the last one. *(Added 2026-09-21,
  from the walk-through: Rich signed out, signed in again and was returned to the same account with no
  chance to switch.)*
- **FR-010**: The site menu MUST be left as it is — presentation that makes no authorization decision and
  renders the same entries whether or not a volunteer is signed in (features 034/046).

### Key Entities

- **Session**: the record that a particular volunteer is signed in on a particular device. Signing out
  ends exactly one — the one on the device in hand.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A volunteer can sign out in **one action** from the menu, from any page they work on,
  without knowing anything about browser settings or cookies.
- **SC-002**: After signing out, **no** staff page or staff action is available without signing in again —
  including by going Back.
- **SC-003**: On a shared door phone, the next volunteer can tell within **5 seconds**, without leaving
  the page they are on, whose session the device holds.
- **SC-004**: Handing the phone over — sign out, sign in as the next volunteer — takes under **30 seconds**
  and needs no help from a maintainer.
- **SC-005**: No volunteer's session ends except by their own use of the control, its expiry, or a
  deliberate revocation.

## Assumptions

- **The server half already exists and is unchanged.** Feature 015 built the route that ends a session,
  clears the sign-in cookie and returns to the public home page; it refuses anything but a deliberate
  submission, which is what FR-006 rests on. This feature is the missing control, not new session
  machinery.
- **Placement: the volunteer menu (decided 2026-09-20).** The site menu is documented as presentation
  that makes no authorization decision and renders the same entries signed in or out (features 034/046);
  a sign-out item there would have changed that rule, so it is left alone. The volunteer menu carries no
  such rule. *(Corrected at planning, research R1: that menu renders from the root layout on EVERY page
  when someone is signed in — public pages included — and not at all for an anonymous visitor. The cost
  assumed here, walking back to a staff page to sign out, does not exist.)*
- **No confirmation step.** Signing out is not destructive: nothing recorded is lost, and signing back in
  is a few taps. A confirmation would slow the common hand-over case. The control is placed at the end of
  the menu, away from the working controls, to reduce mis-taps (FR-007, and the mis-tap edge case).
- **One device at a time.** Signing out ends the session on the device in hand. Signing every device out
  at once, and an administrator ending someone else's session, are out of scope.
- **Sign-in asks which account (corrected 2026-09-21).** The original assumption — "sign-in itself is
  untouched" — did not survive the walk-through: signing out of the club's app leaves the identity
  provider's own session alone, so the next sign-in came straight back as the same volunteer. The
  authorization request now asks for the account chooser (FR-011). Who may sign in, and how identities
  are matched, are still unchanged. The cost, accepted 2026-09-21: one extra tap per sign-in for a
  volunteer with a single account.
- **Names shown are the volunteer's own display name**, as the rest of the app shows it.
