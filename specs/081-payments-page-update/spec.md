# Feature Specification: Performer payments, rebuilt for Mary

**Feature Branch**: `081-payments-page-update`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "payments page update" — the second item in the delivery plan of
`specs/phase-8-requirements/mary-fs-payments.md`: **MARY-R1, R2, R3, R4, R6, R7, R9, R10, R11, R12,
R13, R14, R17** and cross-cutting **X-P1**, with the resolved considerations **C1, C3, C4, C5**.

## Context

After a dance, Mary, the Financial Secretary, pays the evening's performers — usually one check each
— on the performer payments page. The Treasurer (Mike) later enters those checks in the club's books
from the treasurer report.

The page works, but it was built for a desk and it lets mistakes through:

- It is a wide desk form, with a bare event list at the top and no order to the performers.
- A performer added at the last minute is always booked at the role's default rate, and an
  instructor or open-band musician can never be paid at all.
- Nothing stops two checks settling the same booking, or the same check number being used on several
  checks (check #1500 appears three times at one event in the development data).
- A check entered by mistake before it was written cannot be removed, and a check that settles
  several bookings can only have its number corrected.
- Voiding takes one tap, records no real reason, and the voided check then disappears from the page
  and from the treasurer report.
- The summary line ("Expected · Actual · Delta") mixes "not paid yet" with "paid a different
  amount", and the Treasurer never sees when a payment differs from its booking.
- Online membership payments that could not be matched sit on this page, though they are not
  performer pay.
- Paying a performer in cash — the most common reason for cash paid out at the gate — is entered
  twice: once here, as a payment with no check number and a note, and again on the gate page as cash
  paid out. Nothing ties the two together.
- A performer who was not paid on the night can only be paid from that night's page, although the
  money — cash especially — comes from a later evening.

## Clarifications

### Session 2026-09-16 (from the requirements review)

- Q: What does an override in the list change? → A: Only what is paid. The booked amount stays as
  the Booker set it, so the Treasurer sees the difference (C1).
- Q: What does the rate in the Add dialog set? → A: The new booking's booked amount (C1).
- Q: What does the Substitute dialog set? → A: The substitute's booked amount is copied from the
  replaced performer; the dialog has no override (MARY-R6, C1).
- Q: Does an override need a note? → A: Optional; the notes box opens only when the amount is
  overridden, and a note shows only when one was written (MARY-R4).
- Q: Which roles does the Add dialog offer? → A: Every role the event's series allows (C3).
- Q: Delete or void a check entered by mistake? → A: Both — delete when it was never written, void
  when it was written then cancelled — explained before the tap (MARY-R12 Q5).
- Q: How unique is a check number? → A: Across all the club's checks, live or voided (MARY-R13 Q7).
- Q: Where does the "second check to this performer" warning apply? → A: Everywhere a check is
  recorded or its payee changed, counting live checks at the same event (MARY-R9 Q4).
- Q: Where do voided checks show? → A: Quietly on the payments page; on the treasurer report in one
  list of all checks sorted by check number (MARY-R11).

### Session 2026-09-16 (after the first draft)

- Q: How is a performer paid in cash? → A: Cash is an option for settling a **single** booking, in
  place of a check number. It is not offered in the several-performers dialog. Cash paid to
  performers is the most common reason for cash paid out at the gate.
- Q: What if a performer is not paid at the event and is paid at a later one? → A: A recognised
  case, to be handled (User Story 7).

### Session 2026-09-16 (/speckit-clarify)

- Q: How does cash paid to performers reach the gate? → A: Automatically — a read-only line of cash
  paid out on the gate page, taken off the deposit whenever it changes; the gate's own cash-paid-out
  entry covers other payouts only (FR-033).
- Q: How far back does "Pay an earlier booking" look? → A: 90 days before the event being paid
  (FR-036).
- Q: One feature or two? → A: One feature with all eight stories; US1–US3 are built and verified
  first.
- Q: What does a check number look like, given that duplicate check books have been ordered? → A:
  Digits, optionally followed by one letter to tell a duplicate book apart (1500, 1500A), stored in
  capitals; anything else is refused (FR-039).
- Q: Can a letter be entered on a phone, whose number keypad has none? → A: No — YAGNI; duplicate
  check books are rare. The field keeps the number keypad; a lettered number is typed where there is
  a full keyboard. The server still accepts and stores the letter (FR-039).

### Session 2026-09-17 (manual pass)

- Q: How is the event named at the top? → A: Series first, then label, date and a 12-hour time
  (FR-002).
- Q: Tooltips on Void and Delete? → A: Phones cannot hover, so the explanation is shown once above
  the list instead (FR-018).
- Q: Where does a void's history go? → A: Directly under the payment line, like its note (FR-021).
- Q: When does deleting warn about the treasurer report? → A: Only when it was generated after the
  event's day, and without naming the Treasurer: "It may already be in the ledger." (FR-017).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pay the evening's performers on a phone (Priority: P1)

Mary opens the payments page on her phone after the dance. The event is confirmed at the top, with a
warning if it is not today's. Under it, a short summary says what is booked, what is paid and how
many performers are still to pay. The performers are listed caller first, then lead musician,
musician, sound tech and everyone else. For each one she enters the check number — or chooses cash,
paid from the evening's takings. The booked amount is assumed unless she changes it, and when she
does, a notes box opens for an optional reason. An instructor who is free by rule can still be paid
if the club decides to.

**Why this priority**: this is what Mary does every event; today it needs a desk.

**Independent Test**: open an event with a caller, two musicians and an instructor on a phone-sized
screen; pay each with a check number, one at a different amount with a note; confirm the list order,
the summary before and after, and that the instructor could be paid.

**Acceptance Scenarios**:

1. **Given** the page on a phone, **When** Mary opens it, **Then** the event is shown large with its
   date, series and start time, with a **Change** control, and a warning when the event is not today
   (on the phone's own date) — the same confirmation the door check-in page uses.
2. **Given** an event, **When** its performers are listed, **Then** they run caller, lead musician,
   musician, sound tech, then everyone else, and by name within each role.
3. **Given** a booked performer with no payment, **When** Mary enters a check number and records it
   without changing the amount, **Then** a payment of the booked amount is recorded with that
   number.
4. **Given** a booked performer, **When** Mary changes the amount, **Then** a notes box opens;
   **When** she records it, **Then** the payment is the amount she entered, the booked amount is
   unchanged, and the note (if written) is kept and shown on the row. A row with no note shows no
   note label.
5. **Given** a booking that is free — by role (instructor, open-band musician), by a $0 rate, or
   donated — **When** Mary chooses **Pay**, **Then** she can record a payment against it at the
   amount she enters.
6. **Given** an event, **When** the page shows its summary, **Then** it reads "Booked $X · Paid $Y ·
   Still to pay $Z (N)" — N being the bookings with a booked amount and no live payment — and reads
   **All paid** in place of the last part when none are left.
7. **Given** a payment that differs from its booking, **When** the summary is shown, **Then** a
   second line reads "Difference ±$D"; **Given** none differ, **Then** that line is absent.
8. **Given** the gate page for the same event, **When** Mary opens it, **Then** the same summary is
   shown at its top.
9. **Given** the page on a phone, **Then** nothing scrolls sideways, every action is a large tap
   target, and a refusal is shown where the action was taken.
10. **Given** a paid booking whose fee the performer donates, **When** Mary records it as donated,
    **Then** it is settled with no payment, as today.
11. **Given** a single booking, **When** Mary chooses **Cash** instead of entering a check number
    and records it, **Then** a cash payment of the booked amount (or the amount she entered) is
    recorded, with no check number and no note required.
12. **Given** cash payments to performers at an event, **When** the gate page for that event is
    shown, **Then** they appear as their own line of cash paid out, naming each performer and
    amount, and the deposit is reduced by them — without Mary entering them again. The gate's own
    cash paid out entry is for other payouts only.
13. **Given** a cash payment is recorded, corrected or deleted after the gate was saved, **Then**
    the gate's deposit follows.

---

### User Story 2 - One check per booking, one number per check (Priority: P1)

Mary records checks quickly and sometimes twice. The page and the server stop a booking being
settled by two live checks, and stop a check number being used for two checks. If she enters a
number that is already used, she is asked whether to add this booking to that check or change the
number. If she writes a second check to a performer who already has one at this event, she is asked
to confirm.

**Why this priority**: duplicates corrupt what the Treasurer enters in the books; today they are
accepted silently.

**Independent Test**: try to pay an already-paid booking again; try a check number already used at
this or another event; pay a performer booked in two roles with two checks; confirm each is refused,
offered a choice, or asks for confirmation as below.

**Acceptance Scenarios**:

1. **Given** a booking with a live payment, **When** anyone tries to record another payment settling
   it, **Then** it is refused, by the server as well as the page. **Given** that payment is voided,
   **Then** a new one is allowed.
2. **Given** a check number already used by any of the club's checks, live or voided, **When** Mary
   enters it for a new payment, **Then** she is asked: **Add this booking to check #N** — the
   existing check then settles this booking too, its amount growing by this booking's amount — or
   **Change the number**. A second check with that number is never created, and the server refuses
   one however it is asked.
3. **Given** the existing check #N is voided, **When** its number is entered again, **Then** Mary
   may only change the number.
4. **Given** a performer who already has a live check at this event, **When** Mary records another
   check to that performer — from a row, from the several-performers dialog, or by changing a
   check's payee — **Then** the page warns and records it only after she confirms.
5. **Given** the several-performers dialog, **When** Mary records one check for several bookings,
   **Then** each booking is settled by it, and the same rules apply to each booking and to the
   number.
6. **Given** the several-performers dialog, **Then** it offers no cash option and requires a check
   number; the server refuses a payment settling several bookings that is not a numbered check.
7. **Given** a performer who already has a live payment at this event, check or cash, **When** Mary
   pays them again in cash, **Then** the same confirmation is asked.

---

### User Story 3 - Correct, delete or void a check (Priority: P1)

Mary sometimes enters a check before writing it, and gets it wrong. Until it is written she can
correct it — number, payee, amount, and which bookings it settles with each one's amount — or delete
it. A check that was written and then cancelled is voided instead, with a reason, and stays visible.
The page tells her the difference before she taps.

**Why this priority**: without it the duplicates in US2's data cannot be cleaned up, and mistakes
stay in the books.

**Independent Test**: correct a two-booking check to settle three bookings at new amounts; delete an
unwritten check; void a written check with a reason and record its replacement; confirm what each
leaves behind.

**Acceptance Scenarios**:

1. **Given** a live check, **When** Mary edits it, **Then** she can change its number, its payee,
   its amount, and which bookings it settles with each one's amount — whether it settles one booking
   or several — subject to US2's rules. A voided check cannot be edited.
2. **Given** the Void and Delete actions, **When** Mary looks at them, **Then** each carries a short
   explanation she can read without hovering — "Void: the check was written. Delete: it was never
   written."
3. **Given** Mary chooses **Delete**, **When** the confirmation opens, **Then** it reads "This
   erases check #N as never written. If you wrote it, void it instead." and offers both Delete and
   Void. **When** she deletes, **Then** the check is gone and the deletion is recorded in the audit
   log.
4. **Given** an event whose treasurer report has already been generated, **When** Mary deletes a
   check there, **Then** she is warned that the Treasurer may already have entered it, and may still
   delete it.
5. **Given** Mary chooses **Void**, **When** the confirmation opens, **Then** it names the check,
   lists every booking it settles, and asks for a short reason; the void is recorded only with a
   reason.
6. **Given** a voided check, **When** the payments page is shown, **Then** a quiet line under each
   booking it had settled reads "Voided #N — {reason}", and it stays after a replacement is
   recorded.
7. **Given** a booking whose check was voided, **When** Mary records a new check for it, **Then**
   the new check is recorded as replacing the voided one.
8. **Given** a voided check, **When** anyone tries to void it again, **Then** it is refused and its
   original date and reason are unchanged.
9. **Given** a cash payment, **When** Mary acts on it, **Then** she can correct its amount or delete
   it — after a confirmation naming the performer and amount — but not void it (there is no check to
   cancel). The treasurer-report warning of scenario 4 applies to it too.

---

### User Story 4 - Add a last-minute performer (Priority: P2)

A musician sat in who was never booked. Mary opens **Add a performer**, searches for them, picks the
role they played, sees that role's default rate at this event and changes it if they agreed another
figure. If the musician is not yet a performer — or not even a contact — she creates them from the
dialog.

**Why this priority**: it happens a few times a season; today it works but always at the default
rate.

**Independent Test**: add an existing performer as an instructor at $50; add a brand-new person as a
musician; confirm the bookings, their booked amounts, and that the new performer is linked to a new
contact.

**Acceptance Scenarios**:

1. **Given** the Add dialog, **When** Mary searches, **Then** matching performers are listed, and
   one already booked on this event is marked "already booked as {role}" and cannot be added again.
2. **Given** a performer chosen, **When** Mary picks a role, **Then** only the roles the event's
   series allows are offered (no sound tech where the series has no sound-tech slot), and the role's
   default rate at this event is shown.
3. **Given** a role and rate, **When** Mary adds the performer, **Then** a booking is created with
   the rate shown — or the rate she entered — as its booked amount, including a paid instructor or
   open-band musician.
4. **Given** a search that finds no performer, **When** Mary creates one, **Then** the performer is
   linked to the matching contact if there is one, or to a new contact created first; a performer is
   never created without a contact.

---

### User Story 5 - Substitute a performer (Priority: P2)

The booked caller was ill and another caller took the evening. Mary opens **Substitute a
performer**, picks the booking being replaced, and finds the substitute (creating them if needed).
The substitute steps into the same slot at the same booked amount.

**Why this priority**: occasional; today it is a small form with no pay shown.

**Independent Test**: substitute an unpaid $120 caller booking; confirm the substitute is booked at
$120 and the list shows them; pay them $100 in the list with a note, and confirm the difference
shows.

**Acceptance Scenarios**:

1. **Given** the Substitute dialog, **When** Mary picks a booking, **Then** its role and booked
   amount are shown.
2. **Given** a substitute found or created (as in US4), **When** Mary confirms, **Then** the
   substitute is booked in that slot with the replaced performer's booked amount, and the dialog
   offers no amount to change.
3. **Given** the replaced performer was already paid by a live check, **Then** the substitution
   behaves as today (the paid booking is kept and the substitute is booked alongside).

---

### User Story 6 - The Treasurer sees differences and every check (Priority: P2)

Mike opens the treasurer report for the event. Every check is in one list sorted by check number,
voided ones included with their reason and what replaced them. Where a check paid a performer a
different amount from their booking, he sees both amounts and Mary's note.

**Why this priority**: it is what lets Mike enter the evening in the books correctly.

**Independent Test**: for an event with an overridden payment with a note, a voided check and its
replacement, open the treasurer report and confirm each is shown as below.

**Acceptance Scenarios**:

1. **Given** an event's checks, **When** the treasurer report is shown, **Then** all of them — live
   and voided — are listed together, sorted by check number, with payments that have no number after
   them.
2. **Given** a voided check, **Then** its line shows that it was voided, the reason, and the number
   of the check that replaced it, if any.
3. **Given** a payment that differs from its booking, **Then** its line shows the booked amount, the
   amount paid, and Mary's note if she wrote one; **Given** it matches, **Then** no booked amount or
   difference is shown.

---

### User Story 7 - Pay a booking from an earlier event (Priority: P2)

A fiddler played on the 4th but had left before Mary wrote checks. At the dance on the 18th Mary
pays them — in cash from that evening's takings, or with a check she hands over there. On the 18th's
page she chooses **Pay an earlier booking**, finds the fiddler, and sees their unpaid bookings from
earlier events. She pays the one from the 4th.

**Why this priority**: it happens; today it cannot be done from the evening the money comes from, so
the cash is unaccounted for or the check is filed under the wrong evening.

**Independent Test**: leave a booking on one event unpaid; on a later event, pay it in cash; confirm
the earlier event shows it paid, and the later event's gate counts the cash in its cash paid out.

**Acceptance Scenarios**:

1. **Given** the payments page for an event, **When** Mary chooses **Pay an earlier booking** and
   finds a performer, **Then** she sees that performer's bookings from events in the previous 90
   days that have a booked amount and no live payment, each with its event date, role and booked
   amount.
2. **Given** one of those bookings, **When** Mary pays it by check or cash, **Then** the payment
   belongs to the event she is on — it is that evening's check or cash — and settles the earlier
   booking, subject to US2's rules.
3. **Given** that payment, **When** the earlier event's page is shown, **Then** the booking reads
   "Paid at {later event's date}" and counts as paid in its summary.
4. **Given** that payment, **When** the later event's page is shown, **Then** it is listed apart
   from the evening's own performers, with the earlier event's date, and the summary adds a line
   "Earlier bookings paid tonight $X".
5. **Given** the payment was cash, **Then** it counts in the later event's cash paid out on its gate
   page (US1 scenario 12).
6. **Given** the earlier event's treasurer report, **Then** the booking is shown as paid at the
   later event; **Given** the later event's treasurer report, **Then** the payment is listed with
   the earlier event it settled.

---

### User Story 8 - Unmatched online payments leave the payments page (Priority: P3)

The list of online membership payments that could not be matched to a contact is removed from the
payments page. It is membership money, belongs to no event, and gets its own home later.

**Why this priority**: tidying; online payments are not live and nothing has been parked.

**Independent Test**: open the payments page and confirm there is no unmatched-payments section.

**Acceptance Scenarios**:

1. **Given** the payments page, **When** it is shown, **Then** it has no section for unmatched
   online payments.
2. **Given** the underlying records, **Then** they are unchanged and still reachable by the existing
   means.

---

### Edge Cases

- **A booking settled by a payment recorded at another event**: shown as "Paid at {date}" and
  counted as paid in its own event's summary (US7).
- **Paying late on the earlier event's own page**: still possible; the payment then belongs to that
  earlier event. Mary chooses by where the money comes from — for cash, tonight's takings, so
  tonight's page.
- **An unpaid booking more than 90 days old**: not offered by "Pay an earlier booking"; Mary pays it
  from its own event's page.
- **A booking the performer declined and was never paid for**: not listed and not counted in the
  summary; a declined booking that was paid (a no-show kept after substitution) counts as paid.
- **An earlier booking that is free**: listed only if it has a booked amount; a free one can still
  be paid from its own event's page (FR-007).
- **A cash payment settling several bookings**: impossible — split into one cash payment per
  booking, or write a check.
- **A multi-booking check whose bookings are edited down to one**: allowed; editing it to settle
  none is refused — delete it instead.
- **Adding a booking to an existing check number at another event**: the check belongs to one event,
  so Mary may only change the number.
- **Adding a booking to check #N whose payee is someone else**: allowed — one check may settle
  several performers' bookings, paid to one payee (a band leader, say). The choice shows whose check
  it is.
- **A payee change on a check to a performer with another live check here**: warns, as in US2.
- **A check from a duplicate check book** — the club has been sent two books with the same numbers:
  Mary adds a letter (1500A), which is a different number from 1500.
- **A number typed with a stray character** ("#1500", "15OO"): refused, saying numbers are digits
  with an optional letter.
- **Two people recording at once**: the server's rules decide; the loser sees the refusal and the
  refreshed list.
- **The Treasurer** uses the page with the same powers as Mary.
- **Someone without payment authority for the event's series**: the page is read-only for them and
  every action is refused by the server, with a message.
- **Existing duplicate check numbers or double-settled bookings** in development data: see
  Assumptions.

## Requirements *(mandatory)*

### Functional Requirements

#### Layout and summary

- **FR-001**: The payments page MUST be usable on a phone first: a compact top region, dialogs for
  less common tasks, large tap targets, no sideways scrolling, and refusals shown where the action
  was taken.
- **FR-002**: The page MUST confirm the event at the top the same way the door check-in page does —
  series, label, date and a 12-hour start time (in that order, on both pages), a Change control and
  a not-today warning.
- **FR-003**: Performers MUST be listed caller, lead musician, musician, sound tech, then all other
  roles, and by name within each role.
- **FR-004**: The page MUST show a summary: **Booked** (all bookings' booked amounts), **Paid**
  (live payments, wherever recorded), and **Still to pay** (the booked amounts of bookings with a
  booked amount and no live payment, with their count — free bookings are not counted) — or **All
  paid** when none remain — plus a **Difference** line (paid minus booked, over the paid bookings)
  only when it is not zero, and an **Earlier bookings paid tonight** line only when there are any
  (FR-035).
- **FR-005**: The gate page MUST show the same summary for its event.

#### Paying

- **FR-006**: Recording a check with no amount entered MUST pay the booked amount.
- **FR-007**: Mary MUST be able to pay any booking a different amount from its booked amount,
  including a free booking (free by role, by a $0 rate, or donated); doing so MUST NOT change the
  booked amount.
- **FR-008**: An overridden payment MAY carry a note. The notes box MUST appear only when the amount
  is overridden, and a note MUST be displayed only when one exists.
- **FR-009**: Instructor and open-band musician bookings MUST be free unless a booked amount is set
  for them.
- **FR-010**: Recording a donated fee MUST keep working as today.
- **FR-031**: A payment MUST be either a **check**, with a number, or **cash**, with none. Mary MUST
  be able to settle a single booking in cash; a cash payment MUST NOT require a note.
- **FR-032**: Cash MUST NOT be offered in the several-performers dialog. A payment settling more
  than one booking MUST be a numbered check; the server MUST refuse anything else.
- **FR-033**: Cash paid to performers at an event MUST count in that event's cash paid out: the gate
  page MUST show it as its own line naming each performer and amount, the deposit MUST be reduced by
  it whenever it is recorded, corrected or deleted, and the gate's own cash-paid-out entry MUST
  cover other payouts only.

#### Integrity

- **FR-011**: A booking MUST be settled by at most one live payment; the server MUST refuse a
  second. A voided payment settles nothing.
- **FR-012**: A check number MUST identify one check across all the club's checks, live or voided;
  the server MUST refuse a duplicate however it is submitted.
- **FR-013**: Entering a check number already in use MUST offer **Add this booking to check #N**
  (when that check is live and at this event) and **Change the number**, and nothing else. **Change
  the number** MUST hint that a check from a duplicate check book takes a letter (e.g. 1500A).
- **FR-039**: A check number MUST be digits optionally followed by one letter. It MUST be stored in
  capitals, so "1500a" and "1500A" are the same number; any other form MUST be refused with a
  message saying what is allowed. Check numbers MUST sort as numbers, with a lettered number
  straight after its plain one (1499, 1500, 1500A, 1500B, 1501).
- **FR-014**: Recording a payment (check or cash), or changing a check's payee, to a performer who
  already has a live payment at the same event MUST require Mary's confirmation, on every path that
  records a payment.

#### Correcting, deleting and voiding

- **FR-015**: Mary MUST be able to edit a live check's number, payee, amount, and the bookings it
  settles with each one's amount, for single- and multi-booking checks alike, subject to
  FR-011–FR-014. Voided checks MUST NOT be editable.
- **FR-016**: Mary MUST be able to delete a check, after a confirmation worded "This erases check #N
  as never written. If you wrote it, void it instead." that also offers Void. Every deletion MUST be
  audited.
- **FR-017**: Deleting a check at an event whose treasurer report was generated after the day of the
  event MUST warn "The treasurer report for this event has been generated. It may already be in the
  ledger.", without refusing. A report generated on the event's own day does not warn — the
  Treasurer works from it the next day.
- **FR-018**: What Void and Delete mean MUST be readable without hovering: "Void: the check was
  written. Delete: it was never written." is shown once, above the list of performers, to those who
  may record payments.
- **FR-019**: Voiding MUST require confirmation and a reason, and the confirmation MUST list every
  booking the check settles.
- **FR-020**: A voided check MUST NOT be voided again; its void date and reason MUST stay as first
  recorded.
- **FR-021**: A voided check MUST remain visible on the payments page as a quiet line under each
  booking it settled, with its number and reason — directly under how the booking is now paid,
  beside the payment's note, above the actions.
- **FR-022**: A new payment for a booking whose payment was voided MUST be recorded as replacing
  that payment.
- **FR-034**: A cash payment MUST be correctable (its amount) and deletable after a confirmation
  naming the performer and amount, with FR-017's warning; it MUST NOT be voided.

#### Adding and substituting performers

- **FR-023**: **Add a performer** MUST open a dialog to search performers, choose a role from those
  the event's series allows, see that role's default rate at this event, and override it; the rate
  used MUST become the new booking's booked amount.
- **FR-024**: The Add dialog's search MUST mark a performer already booked on the event with their
  role and MUST NOT add them again.
- **FR-025**: **Substitute a performer** MUST open a dialog to choose the booking being replaced and
  find the substitute; the substitute's booked amount MUST be the replaced booking's, with no
  override in the dialog.
- **FR-026**: When no performer is found, the Add and Substitute dialogs MUST let Mary create one,
  linked to an existing contact or to a contact created first. A performer MUST never be created
  without a contact.

#### Paying a booking from an earlier event

- **FR-035**: From an event's page, Mary MUST be able to pay, by check or cash, a booking from an
  earlier event that has a booked amount and no live payment. The payment MUST belong to the event
  she is on and settle the earlier booking, subject to FR-011–FR-014.
- **FR-036**: The choice MUST start from the performer and list only that performer's bookings at
  events in the 90 days before the event being paid that have a booked amount and no live payment,
  each with event date, role and booked amount. Older unpaid bookings are paid from their own
  event's page.
- **FR-037**: A booking settled by a payment at another event MUST show on its own event's page as
  "Paid at {that event's date}"; the paying event's page MUST list such payments apart from its own
  performers, with the earlier event's date.

#### Treasurer report

- **FR-027**: The treasurer report MUST list all of an event's checks, live and voided, in one list
  sorted by check number, payments without a number last; a voided check MUST show its reason and
  its replacement's number.
- **FR-028**: The treasurer report MUST show, for each payment that differs from its booking, the
  booked amount, the amount paid and the note if any.
- **FR-038**: The treasurer report MUST list the event's cash payments to performers, marked as
  cash, within its cash paid out; and for a payment settling a booking from another event, it MUST
  name that event — on both events' reports.

#### Removed

- **FR-029**: The payments page MUST NOT show unmatched online membership payments. The records and
  any other way of reaching them MUST be unchanged.

#### Authority

- **FR-030**: Every action on the page MUST keep today's authority: the Financial Secretary and
  Treasurer for the event's series. Creating a performer or contact from a dialog MUST require the
  authority those actions already require, which the Financial Secretary holds.

### Key Entities *(include if feature involves data)*

- **Booking**: a performer engaged for an event in a role, with its **booked amount** (what the
  Booker set, or the Add dialog's rate, or copied on substitution), and whether it is free or
  donated.
- **Payment**: what was actually paid to one payee — a **check** (with a **check number**, unique
  club-wide) or **cash** — belonging to the event where it was made, with a total, an optional
  **note**, and one or more **lines**, each settling one booking (at that event or an earlier one)
  with its own amount. Cash settles exactly one booking. A check may be **voided** (with date and
  reason) and may **replace** an earlier voided payment.
- **Door record's cash paid out**: the gate's other cash payouts with their reason, plus the event's
  cash payments to performers.
- **Performer**: a person who performs, always linked to a **contact**.
- **Treasurer report generation**: the record that the report was produced for an event, used for
  FR-017's warning.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Mary can pay a typical evening's four performers on a phone, each with a check number,
  without sideways scrolling or leaving the page.
- **SC-002**: **Zero** bookings settled by two live payments and **zero** check numbers used twice
  can be created, through the page or directly against the server.
- **SC-003**: Every check entered by mistake can be corrected or removed from the page, whether it
  settles one booking or several.
- **SC-004**: Every voided check is visible, with its reason, on both the payments page and the
  treasurer report.
- **SC-005**: For every payment that differs from its booking, the Treasurer can see both amounts
  without asking Mary.
- **SC-006**: The summary always adds up against the listed rows: Booked = Paid + Still to pay −
  Difference.
- **SC-007**: Cash paid to a performer is entered once, and the evening's deposit is right without a
  second entry on the gate page.
- **SC-008**: A performer left unpaid on the night can be paid from any evening in the following 90
  days, and both evenings' pages and reports show where the payment was made.

## Assumptions

- The app is not yet in production. Duplicate check numbers and any double-settled bookings in the
  development data are cleaned up (with this feature's delete) or reset before the new rules are
  enforced; no migration repairs them automatically.
- "At this event" for the second-check warning counts live checks recorded at the event being paid.
- A check belongs to one event, so "Add this booking to check #N" is offered only for a live check
  at this event.
- The event confirmation, search and dialogs reuse what the door check-in page (feature 079) built
  rather than copies.
- The treasurer report's existing lines (payee, amount, class, number) are kept; this feature adds
  to them.
- The gate page gets only the summary and the performers' cash line here; its rebuild is the next
  feature.
- Existing payments without a check number in the development data are treated as cash.
- Mary is trusted to pay a late booking from the event the money comes from; the page does not
  guess.

## Out of Scope

- The gate page's rebuild, named sales and the cash-counting dialog (MARY-R8, R15, R16) — the next
  feature.
- A home for unmatched online payments and its grant (backlog B52).
- Warnings for unconfirmed bookings (BK-C5) — the booker's work.
- A second role for a performer already booked (C5: not for the Financial Secretary).
- Performers created before the contact rule that still have none (BK-C3).
- Changing the Booker's booking screens.
- Payment methods other than check and cash (for example an online transfer).
