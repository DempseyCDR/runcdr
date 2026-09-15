# Feature Specification: Mobile door check-in

**Feature Branch**: `079-mobile-door-checkin`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: "079" — Meg's door check-in, as revised on 2026-09-14 in
`specs/phase-8-requirements/meg-door-checkin.md` after Mel Maintenance closed: MEG-R1–R6 and R8–R10, with
MEG-R7 simplified to what is already built.

## Context

Meg, the door attendant, checks dancers in at the door on a phone. The check-in page was built for a desk:
one long page where the search, the new-contact form, the anonymous check-in row and the list of who is
already in are all open at once, and every search result carries its own set of children, comp and
gift-card controls. On a phone Meg scrolls past forms she is not using to reach the one she needs.

The contact work finished for Mel changes what the door can rely on. Search matches names and email
addresses and leaves out merged and archived contacts. Names follow one rule everywhere — the display
name, with first and last name beneath it only when the display name is custom. Two different people can
share one household email address. Door-created contacts are flagged for Mel's review.

Four problems remain at the door:

1. **The page is not built for a phone.** What Meg needs most — the search, and a quick way to check in
   someone who declines to give a name — is not all visible without scrolling.
2. **Meg cannot tell who is already in** from the search results. Checking someone in twice is refused, but
   she learns it only by trying.
3. **A walk-in can lose their email.** If Meg enters an address that already belongs to another contact,
   the new contact is created without it and nothing tells her. Nothing helps her find an existing contact
   before she creates a duplicate.
4. **The paying count is wrong whenever a booked performer is not checked in.** Paying dancers are worked
   out as attendance, less the booked performers, less the door attendant, less comps. Every booked
   performer is subtracted whether or not they came through the door, so a performer who was never checked
   in makes the paying count one too low. And no screen at the door, or on the treasurer's or Financial
   Secretary's pages, shows how the evening's attendance breaks down.

## Clarifications

### Session 2026-09-14 (requirements review)

Decided while revising `meg-door-checkin.md`, before this spec was written:

- Layout: from the top — the event, confirmed; the search box; one extras row; a Check in anonymously
  button, always above the fold; Add contact and Show checked in buttons; then the search results.
- The event is confirmed by showing it large with a Change control, warning when it is not today's.
- A search result is a name and a Check in button. The per-person controls — children, comp, gift card,
  open band — are **one row** that applies to the next check-in of any kind and resets after it.
- Already-checked-in contacts **stay** in the results, marked with a checkmark instead of Check in.
- Names follow feature 076's rule. Results show reachable addresses only (active or in transition),
  personal ones first, and "reached via …" for a contact reached through a household address.
- Add contact opens a dialog, which suggests existing matches as Meg types.
- The checked-in dialog sorts by display name (default), first or last name, and shows the attendance
  breakdown at the top: paying and children; then caller, band, sound tech and instructor (sound tech and
  instructor only when one is booked and checked in), door attendant, comps and gift cards.
- The breakdown means what the organizer report means, and appears the same way at the top of the
  treasurer report and the Financial Secretary's gate page.
- A booked performer is subtracted from paying **only when checked in**, with no start date — the app has
  not been deployed.
- Open-band musicians stay a community-dance category. The rule comping them at the paired contra is
  **dropped**: Meg comps them there by hand. A musician booked to lead the open band is a performer.
- Performers with no contact are deferred to the booker's workflow.
- "Booked" means booked **for this event**. A performer booked more than once for the same event — possibly
  under two kinds — is counted once, and a warning is shown with the breakdown, since it is usually a
  booking mistake. It is not always one (a musician may also handle sound), so preventing or confirming it
  belongs to the booker's workflow.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Check a dancer in quickly on a phone (Priority: P1)

Meg opens the check-in page on her phone at the start of the evening. The event she is checking dancers
into is shown at the top, and she is warned if it is not today's. She types part of a dancer's name or
email; matches appear below, each showing the name the way the rest of the app shows it and enough of
their email to tell two people apart. Anyone already checked in is marked with a checkmark. For a family
she enters the number of children in the extras row, then taps **Check in** on the right result. The
extras row clears, the search clears, and she is ready for the next dancer. For someone who will not give
a name, she taps **Check in anonymously** without scrolling.

**Why this priority**: checking dancers in is the whole job at the door, and the queue at the door is
where slowness costs the most.

**Independent Test**: on a medium phone (390 × 844), confirm the event, search for an existing contact, set
children in the extras row, and check them in with one tap; confirm the extras row reset, a second search
shows them checkmarked, and an anonymous check-in is reachable without scrolling.

**Acceptance Scenarios**:

1. **Given** the page is opened on a phone, **When** it loads, **Then** the event, the search box, the
   extras row, Check in anonymously, Add contact and Show checked in are all visible without scrolling,
   and the search box has focus.
2. **Given** the selected event is not today's, **When** the page shows it, **Then** it warns that the
   event is not today's and offers Change.
3. **Given** a search matching several contacts, **When** the results show, **Then** each shows the
   display name, with first and last name beneath only when the display name is custom, and the contact's
   reachable addresses (active or in transition) with personal ones first.
4. **Given** a contact with no address of their own who is reached through a household address, **When**
   they appear in results, **Then** the result says who they are reached through.
5. **Given** a contact already checked in to this event, **When** they appear in results, **Then** they
   show a checkmark and no Check in button.
6. **Given** children, comp or gift card set in the extras row, **When** Meg checks anyone in, **Then**
   those apply to that check-in only, and the extras row is reset afterwards.
7. **Given** the extras row, **When** the event is not a community dance, **Then** it offers no open-band
   control.
8. **Given** a search with results, **When** Meg presses Enter, **Then** the top result is checked in —
   unless it is already checked in, in which case nothing is recorded.
9. **Given** a dancer who declines to give a name, **When** Meg taps Check in anonymously, **Then** an
   anonymous check-in is recorded with whatever the extras row holds.

---

### User Story 2 - Add a walk-in without creating a duplicate or losing their email (Priority: P1)

A dancer Meg cannot find is new to the club — or so it seems. She taps **Add contact**, and a dialog opens.
As she types the first name, last name or email, existing contacts that match appear; if one is the
dancer, she checks that contact in instead. Otherwise she completes the form and checks the new contact in.
If the email she typed already belongs to someone else, she is asked which it is: the same person (check
that contact in), a different person sharing a household email (link them to it, then check in), or a
mistyped address (correct it).

**Why this priority**: every duplicate created at the door is later work for Mel, and an email silently
lost at the door is a dancer the club can no longer reach.

**Independent Test**: open Add contact; type a name matching an existing contact and check that contact in
from the suggestions; then add a genuinely new contact whose email belongs to someone else, and exercise
each of the three answers.

**Acceptance Scenarios**:

1. **Given** the Add contact dialog, **When** Meg types a name or email matching existing contacts,
   **Then** those contacts are suggested, each with a way to check them in instead.
2. **Given** a completed form, **When** Meg checks the new contact in, **Then** the contact is created with
   the details entered, checked in with the extras row applied, and flagged for Mel's review.
3. **Given** an email that already belongs to another contact, **When** Meg submits, **Then** she is asked
   whether it is that person, a different person sharing the address, or a mistake — and nothing is
   created until she answers.
4. **Given** she answers "that person", **Then** the existing contact is checked in and no new contact is
   created.
5. **Given** she answers "a different person sharing it", **Then** the new contact is created, reached
   through that address without owning it, and checked in.
6. **Given** she answers "a mistake", **Then** the form returns with the email ready to correct.
7. **Given** the form, **When** Meg leaves email and phone blank, **Then** the contact can still be created
   and checked in.

---

### User Story 3 - See who is in, and correct mistakes (Priority: P2)

Partway through the evening Meg taps **Show checked in**. A scrollable dialog lists everyone checked in,
sorted by display name; she can sort by first or last name instead. At the top she sees how the evening
breaks down — paying and children, then the performers who are in, the door attendant, comps and gift
cards. She taps a name to correct it: change the children, mark or unmark open band, move them to the
other event in the group, or remove the check-in. When Rich relieves her, he opens the page on his own
phone and sees the same list and counts.

**Why this priority**: corrections are less frequent than check-ins, and they already work today — this
moves them where they fit on a phone and adds the tally.

**Independent Test**: check in several dancers, a performer and an anonymous guest; open Show checked in;
confirm the three sort orders, the breakdown counts, and that a correction updates both the list and the
counts.

**Acceptance Scenarios**:

1. **Given** check-ins for the event, **When** Meg opens Show checked in, **Then** a scrollable dialog lists
   them sorted by display name, and she can sort by first name or last name.
2. **Given** the dialog, **When** it opens, **Then** the breakdown appears at the top as a list that wraps
   on a narrow screen: paying and children first; then caller, band, sound tech, instructor, door
   attendant, comps and gift cards.
3. **Given** no sound tech is booked, or one is booked but not checked in, **When** the breakdown shows,
   **Then** there is no sound tech entry. The same holds for an instructor.
4. **Given** an attendee in the dialog, **When** Meg corrects children, open band, event or removes the
   check-in, **Then** the list and the breakdown reflect it.
5. **Given** two attendants on their own phones, **When** one checks someone in and the other then opens
   Show checked in, **Then** the second sees that check-in and the updated counts.

---

### User Story 4 - A paying count everyone can trust (Priority: P2)

The organizer report, the treasurer report and the Financial Secretary's gate page all show the evening's
attendance breakdown the same way as the door, from the same figures. A booked performer who never came
through the door is not subtracted from paying. Months later, after the check-ins themselves have been
purged, the event's figures are unchanged.

**Why this priority**: the paying count drives the average ticket and the club's view of each series; it
matters, but after the door itself works well.

**Independent Test**: for an event with a booked caller and sound tech where only the caller is checked
in, confirm paying subtracts the caller alone, and that the door dialog, the treasurer report, the gate
page and the organizer report agree; purge the event's check-ins and confirm the figures do not change.

**Acceptance Scenarios**:

1. **Given** a booked performer who is not checked in, **When** paying is worked out, **Then** that
   performer is not subtracted.
2. **Given** a booked performer who is checked in, **When** paying is worked out, **Then** they are
   subtracted once, and counted under their kind (caller, band, sound tech or instructor).
3. **Given** an event, **When** the treasurer report or the gate page is opened, **Then** the attendance
   breakdown appears at the top, with the same figures as the door's dialog.
4. **Given** an event, **When** the organizer report is run, **Then** its paying dancers and average ticket
   use the same paying figure.
5. **Given** an event whose check-ins have been purged, **When** any of these views is opened, **Then** its
   breakdown and paying figure are the same as before the purge.
6. **Given** a performer is checked in and their booking is then removed, or a booking is added for someone
   already checked in, **When** the breakdown is next shown, **Then** it reflects the current bookings.
7. **Given** a checked-in performer booked twice for the same event, under two kinds, **When** the
   breakdown is shown, **Then** they are subtracted once, counted under one kind, and a warning names the
   performer and both kinds — on the door dialog, the treasurer report and the gate page alike.

---

### Edge Cases

- **No event selected, or no event today**: check-in actions are unavailable until an event is chosen; the
  event area offers Change.
- **A search matching many contacts**: the results say more matched than are shown and suggest narrowing
  the search.
- **Enter with no results**: nothing is recorded.
- **The same person booked twice for one event** (for example as musician and sound tech): subtracted once,
  counted under one kind — caller before band, band before sound tech, sound tech before instructor — and
  flagged with a warning (FR-033). Usually a booking mistake, but not always: a musician may also handle
  sound. Check-in is never blocked by it.
- **A performer with no contact**: can never be recognised as checked in, so is never subtracted (deferred
  to the booker's workflow).
- **Open band at a performer**: a booked performer cannot be checked in as an open-band musician (already
  enforced).
- **Paying would fall below zero**: shown as zero, as today.
- **A check-in moved to the other event in the group**: counts move with it.
- **A contact merged away after being checked in**: the check-in belongs to the surviving contact, as merges
  already arrange.
- **Two attendants check the same dancer in at once**: the second is refused as already checked in, and
  told so; the extras row she set is kept.
- **Add contact finds the dancer is already in**: when Meg answers that an owned email is that person, and
  that person is already checked in, the dialog says so and offers to close — nothing is recorded.
- **A free event**: the extras row still works, but Meg needs no comps or gift cards; nothing special
  happens.
- **Meg lacks permission to see contact details**: results show names only, as today.

## Requirements *(mandatory)*

### Functional Requirements

#### Page layout (MEG-R8)

- **FR-001**: The check-in page MUST be laid out for a phone first, showing from the top: the event,
  confirmed; the search box; the extras row; the Check in anonymously button; the Add contact and Show
  checked in buttons; then the search results.
- **FR-002**: Everything down to and including the Add contact and Show checked in buttons MUST be visible
  without scrolling on a medium phone (390 × 844 points, portrait), with the browser's address and tool bars
  showing. Check in anonymously MUST never sit below the search results. On a smaller phone (360 wide, or
  375 × 667) the page MUST still work without horizontal scrolling.
- **FR-003**: The page MUST show the selected event prominently — date, series and start time — with a
  Change control to pick another event, and MUST warn when the selected event is not today's.
- **FR-004**: The search box MUST have focus when the page loads, and again after every check-in.

#### Searching and checking in (MEG-R1, MEG-R2, MEG-R3, C6)

- **FR-005**: Each search result MUST show the contact's name by the app's name rule: the display name,
  with first and last name beneath it only when the display name is custom, and no marker saying so.
- **FR-006**: Each result MUST show the contact's reachable email addresses — active or in transition —
  personal ones first, and never an inactive address. A contact reached only through a household
  address MUST show who they are reached through.
- **FR-007**: A contact already checked in to the selected event MUST appear in results with a checkmark in
  place of the Check in button.
- **FR-008**: A result MUST keep its name and its Check in button on one line.
- **FR-009**: The page MUST offer one extras row — children, comp, gift card, and open band only when the
  event is a community dance — that applies to the next check-in of any kind (a search result, a contact
  added through Add contact, or an anonymous check-in) and is reset after every check-in.
- **FR-010**: Pressing Enter in the search box MUST check in the top result, unless it is already checked in
  or there are no results.
- **FR-011**: After any check-in the page MUST clear the search and say who was checked in.
- **FR-012**: Check in anonymously MUST record a check-in with no contact, with the extras row applied.

#### Adding a contact (MEG-R4, MEG-R5)

- **FR-013**: Add contact MUST open a dialog with first name, last name, display name (optional), email and
  phone. Email and phone MAY be left blank. The dialog MUST NOT ask for pronouns.
- **FR-014**: As Meg types a name or email in the dialog, it MUST suggest existing contacts that match, each
  with a way to check that contact in instead of creating a new one.
- **FR-015**: A contact created at the door MUST be checked in immediately with the extras row applied, and
  flagged for Mel's review. Its email, if given, MUST default to personal purpose and contact-tracing
  consent.
- **FR-016**: When the email entered already belongs to another contact, the dialog MUST NOT create the
  contact silently without it. It MUST ask Meg whether the address is (a) that contact — check them in
  instead, (b) a different person sharing the address — create the new contact reached through it without
  owning it, then check them in, or (c) a mistake — return to the form to correct it.
- **FR-017**: A shared address linked at the door MUST follow the existing sharing rules: the new contact
  does not own it, and it can never be their sign-in.

#### The checked-in dialog (MEG-R9, C3, MEG-R6)

- **FR-018**: Show checked in MUST open a scrollable dialog listing the selected event's check-ins, sorted by
  display name by default, with a control to sort by first name or last name.
- **FR-019**: The dialog MUST show the attendance breakdown (FR-022) at the top, as a list that wraps on a
  narrow screen, with paying and children first.
- **FR-020**: From the dialog, Meg MUST be able to correct a check-in as she can today: change children, mark
  or unmark open band, adjust comp and gift-card counts, move it to another event in the same group, assign
  an anonymous check-in to a contact, or remove it — with no confirmation step.
- **FR-021**: The list and breakdown MUST reflect every check-in recorded for the event, by any attendant,
  each time the dialog is opened and after each change made in it.

#### The attendance breakdown (MEG-R9, MEG-R10)

- **FR-022**: An event's attendance breakdown MUST show: **paying**; **children**; **caller**; **band**;
  **sound tech**; **instructor**; **door attendant**; **comps**; **gift cards**.
- **FR-023**: **Paying** MUST equal attendance (children included) less the booked performers who are
  checked in, less one for the door attendant, less comps; never below zero.
- **FR-024**: A performer booked **for the event** MUST count as checked in only when their contact is
  checked in to that event; a booking for any other event, including another event in the same group, does
  not count. Each MUST be counted under one kind — caller; band (lead musician, musician, or a musician
  booked to lead the open band); sound tech; or instructor — and subtracted once.
- **FR-025**: Sound tech and instructor MUST appear in the breakdown only when at least one of that kind is
  booked for the event and checked in.
- **FR-026**: **Comps** MUST be the event's comp count plus its open-band musicians. **Children** MUST be the
  total of children across its check-ins. **Door attendant** MUST be one. **Gift cards** MUST be the
  event's gift-card redemption count.
- **FR-027**: The breakdown MUST be computed once and shown identically at the top of the door's checked-in
  dialog, the **treasurer report**, and the **Financial Secretary's gate page**.
- **FR-028**: The **organizer report**'s paying dancers and average ticket MUST use the same paying figure,
  for every event, with no start date.
- **FR-029**: An event's breakdown and paying figure MUST NOT change when its check-ins are purged after the
  retention period.
- **FR-030**: While the event's check-ins are retained, the breakdown MUST reflect the event's current
  bookings: removing a booking for a checked-in performer, or adding one for someone already checked in,
  MUST be reflected the next time it is shown. After the purge the performer figures are frozen as they
  stood, and the double-booking warning is no longer shown (research R2).

#### Open band (MEG-R7, simplified)

- **FR-031**: Open-band musicians MUST remain a category at community dances only, counted among comps. A
  musician booked to lead the open band MUST be treated as a performer, never as an open-band musician.
- **FR-032**: There MUST be no automatic comp at any other event for a community dance's open-band
  musicians.

#### Double bookings

- **FR-033**: When a checked-in performer is booked more than once for the same event, the breakdown MUST
  count them once, under the first matching kind in the order caller, band, sound tech, instructor, and
  MUST show a warning naming the performer and each kind they are booked under — wherever the breakdown is
  shown.
- **FR-034**: A double booking MUST NOT block or alter a check-in.

### Key Entities *(include if feature involves data)*

- **Check-in**: one person admitted to one event — a contact, or no one for an anonymous check-in — with a
  number of children and whether they are an open-band musician. Deleted after the retention period.
- **Event attendance**: the event's lasting counts, which outlive its check-ins — total attendance, comps,
  open-band musicians, gift-card redemptions, and (new) how many booked performers of each kind were
  checked in.
- **Booking**: a performer booked for an event, of a kind — caller, lead musician, musician, open-band
  musician, sound tech or instructor.
- **Attendance breakdown**: the figures of FR-022, derived from the event's attendance and bookings, shown
  in four places.
- **Contact**: as today; names follow the app's name rule, addresses have purposes and a status, and a
  contact may be reached through another contact's household address.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A dancer found by search is checked in with **one tap** after typing, when no extras apply,
  and with no scrolling on a medium phone (390 × 844 points).
- **SC-002**: On a medium phone (390 × 844 points), the search box, extras row, Check in
  anonymously, Add contact and Show checked in are all reachable **without scrolling**, at every
  point in the evening.
- **SC-003**: **No email entered at the door is lost**: every door-created contact either keeps the address
  entered, is linked to it as shared, or was corrected by Meg.
- **SC-004**: For every event, the breakdown figures are **identical** in the door dialog, the treasurer
  report and the gate page, and the organizer report's paying dancers match them.
- **SC-005**: For every event, paying + performers checked in + door attendant + comps **equals total
  attendance**, whenever paying is above zero.
- **SC-006**: An event's breakdown is **unchanged** after its check-ins are purged.
- **SC-007**: Meg can tell from the search results, **without attempting a check-in**, whether a dancer is
  already in.

## Assumptions

- The app has not been deployed, so changing how the organizer report counts performers needs no start
  date and no migration of history beyond recomputing the new lasting counts for existing events.
- "Booked" means any booking **for that event**, whatever its status, as the organizer report counts
  bookings today.
- The door attendant deduction stays one, however many attendants work the evening.
- The breakdown refreshes when the dialog or page is opened and after each change made there; it does not
  update on its own while open. A reliever sees current state when they open it (MEG-R6).
- Who may see the breakdown follows who may already open each page; the breakdown carries counts only, no
  contact details.
- Search, the name rule, household address sharing, the needs-review flag, check-in corrections, and the
  event selector are reused as they exist today.
- The design target is a typical medium phone in portrait: 390 × 844 points (iPhone 12–16 base models, most
  Galaxy S phones). The browser's own bars take roughly 100–180 points of that height, so "without
  scrolling" means within what the page actually sees. Smaller phones must still work, but are not the
  target.
- Connectivity at the door is not a concern (C8).

## Out of Scope

- Comping open-band musicians automatically at the contra in the same event group (dropped).
- Performers with no contact — deferred to the booker's workflow.
- Preventing a performer being booked twice for one event, or asking the booker to confirm it when it is
  intended (a musician also handling sound) — deferred to the booker's workflow.
- Clearing the needs-review flag only after a new address is uploaded to the email provider — backlog B51.
- Collecting pronouns at the door — belongs to the membership flow.
- Live updates pushed to an open dialog on another attendant's phone.
- Offline check-in.
