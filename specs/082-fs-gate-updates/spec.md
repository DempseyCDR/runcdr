# Feature Specification: The gate evening, and the report the Treasurer reads

**Feature Branch**: `082-fs-gate-updates`

**Created**: 2026-09-17

**Status**: Draft

**Input**: User description: "FS-gate-updates" — the third item in the delivery plan of
`specs/phase-8-requirements/mary-fs-payments.md`: **MARY-R1, R2, R8, R15, R16, R20, R21, R22** and
**MEG-R11**.

## Context

At the end of an evening Mary, the Financial Secretary, records what the gate took: the cash she
counts, the card total, the sales that are not admission, and each named customer's membership,
donation or payment for a future event. Michael, the Treasurer, enters the evening in the club's
books from what she records.

Today's gate page is one long desk form, and the evening's record is thinner than the paper gate
report it is meant to replace:

- The page is a wide form with a bare event list at the top. What the figures add up to — admission
  by cash and by card, the card fee, the deposit — is not shown until after saving, and admission
  not at all.
- Counting the cash is a collapsed row of small boxes, keyed with a laptop keyboard, and a
  half-finished count is lost on a reload.
- **Checks are a single total inside the cash.** The Treasurer's answer (16 September) is that each
  check must be recorded: whose it is and what it pays for. One check often covers several things —
  admission for several people, or a T-shirt and admission. In the books a check is credited to its
  writer, while cash goes to the general gate customer, and a third entry matches the bank deposit.
  The deposit slip cannot say who paid for what, so the gate report must, and he goes back to it —
  usually within two years — to correct the books.
- Named sales have no note, so what only the desk knows is lost: which future event a payment is
  for, who else is on a membership, what a donation is for.
- A named sale can only be recorded on the gate page, and saving that page replaces every sale on
  the record, so a sale the door adds while Mary has the page open would be wiped.
- The paper report carries freehand notes and says who filled it in. The app records neither, and
  its audit trail names a placeholder ("door", "admin") rather than the volunteer.
- Large or unusual checks are deposited separately, so an evening can have more than one deposit.
  The app knows only one.

## Clarifications

### Session 2026-09-16 and 2026-09-17 (requirements review with the Treasurer)

- Q: Do checks received need recording separately? → A: Yes, on the gate report — whose check and
  what it pays for (the Treasurer's answer; reverses MARY-R16 Q15's "one total").
- Q: Does a check record its number? → A: No. The bank does not show check images, and Mary takes
  the deposits, so the Treasurer never sees the checks.
- Q: Who is the writer? → A: A contact; someone not yet a contact is added to the contacts first.
- Q: Who records checks? → A: The door may record one as it is handed over, or leave it to Mary, who
  reviews and completes them.
- Q: What about a large check? → A: Mary ticks "deposit separately"; both pages list each deposit.
- Q: What replaces the paper report's freehand notes? → A: A note on each check, a note on each
  named sale, and one note for the evening.
- Q: What does a named sale's note carry? → A: Which future event, who else is on a membership, what
  a donation is for.
- Q: Where does the gate report live? → A: The treasurer page becomes it, laptop-first, printable on
  landscape letter paper; a phone layout is a nice-to-have.
- Q: Does the report say who filled it in? → A: Yes — who recorded the performer payments and who
  recorded the gate money.
- Q: Where does the deposit figure belong on the gate page? → A: Above the fold, near the
  performer-payments summary.

### Session 2026-09-18 (review of the P1 build and the printed gate report)

- Q: How does the door record an anonymous sale — a T-shirt with no name — without the gate's Save
  wiping it? → A: Every sale is its own line, recorded through the shared dialog; the gate's Save no
  longer carries sales at all (an Anonymous pseudo-contact was considered and rejected).
- Q: One dialog for a sale and a check? → A: Yes — **Add a sale**, shared by the check-in page and
  the gate page, choosing cash, check or card; admission is offered only when **check** is chosen.
  "Writer" becomes **Payer**.
- Q: Must a check's admission line say how many people? → A: No — "How many?" is optional; the count
  comes from check-in and is only there to read the writer's intent.
- Q: Quantity for merchandise? → A: Optional, entered at the gate when known.
- Q: How is the printed report laid out? → A: A header (the event, venue, band or musicians, caller
  and sound tech; then who recorded it and the attendance), receipts on the left and expenses on the
  right, then deposits and the card fee on the left and the notes on the right — for print and a
  laptop, stacked on a phone. No QuickBooks class or customer; no page headers or footers.
- Q: Rent? → A: An unpaid expense on the right, out of the totals. Paying the landlord on the night
  (a one-off venue) is backlog B54.
- Q: Voided checks, bookings paid at another evening, booked versus paid? → A: Voided checks with
  their reason in the payments list; bookings paid at another evening in the notes; booked versus
  paid, and a check's further bookings, as note lines under their payment.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record the evening's money on a phone (Priority: P1)

Mary settles up at the end of the evening on her phone. The event is confirmed at the top, then the
summary of what is still to pay and the evening's money so far — including the deposit. Below that,
short sections in the order she works: the door's counts, the cash, the card, the sales and the
checks. As she types, admission, the card fee and the deposit follow along. When
she saves, anything that looks wrong is pointed out so she can correct it and save again.

**Why this priority**: this is the evening's money; without it the rest of the feature has nothing
to report.

**Independent Test**: on a phone-sized screen, enter an evening's cash, card and other sales;
confirm the order of the sections, that admission, the fee and the deposit update while typing, that
the deposit is visible without scrolling, and that saving reports the warnings.

**Acceptance Scenarios**:

1. **Given** the gate page on a phone, **When** Mary opens it, **Then** the event is confirmed as on
   the other pages (series, label, date, 12-hour time, a Change control, a not-today warning), and
   nothing scrolls sideways.
2. **Given** an event, **When** the page is shown, **Then** the sections run: summary (performer pay
   and the money so far, including the deposit), the door's counts, cash, card, sales, checks.
3. **Given** the door's comp and gift-card counts, **When** Mary looks at them, **Then** she sees
   what the door recorded beside the figure she confirms, and the open-band count read-only.
4. **Given** figures being typed, **When** Mary enters gross cash, the float, payouts, card gross or
   a sale, **Then** admission by cash and by card, the card fee and the deposit update before she
   saves.
5. **Given** entries that look wrong — admission coming out negative, cash paid out with no reason,
   card gross with no transaction count — **When** Mary saves, **Then** each is pointed out, the
   save is not blocked, and nothing is said while she is still typing.
6. **Given** unsaved entries, **When** Mary changes the event or leaves the page, **Then** she is
   warned first.
7. **Given** a money field, **When** Mary taps it, **Then** the phone offers its decimal keypad; a
   count field offers the number keypad.

---

### User Story 2 - Count the cash with a keypad (Priority: P1)

Mary counts the drawer: so many hundreds, so many fifties, down to the ones, and the coins as one
figure. She taps the counts on a keypad in the dialog, sees the running total, and puts it into
gross cash. Checks are not part of this count any more.

**Why this priority**: counting is the slowest part of her evening and the reason the page must work
on a phone.

**Independent Test**: open the counting dialog, key a count for each denomination and the coins,
confirm the total, use it as gross cash, then reopen the dialog and confirm the counts are still
there; save the gate and confirm they are gone.

**Acceptance Scenarios**:

1. **Given** the cash section, **When** Mary taps **Count**, **Then** a dialog lists the bill faces
   ($100, $50, $20, $10, $5, $1) and the coins as one amount, with an on-screen number keypad, a
   delete key, and a way to move to the next denomination.
2. **Given** counts keyed in, **When** Mary looks at the dialog, **Then** it shows the running
   total, and **Use as gross cash** puts it in gross cash and closes.
3. **Given** a half-finished count, **When** Mary closes and reopens the dialog, or reloads the
   page, **Then** the counts are still there.
4. **Given** counts kept, **When** the gate is saved, **Then** they are dropped — the saved gross
   cash is the record.
5. **Given** the counting dialog, **Then** it has no place for checks: the checks total comes from
   the checks recorded (User Story 3).

---

### User Story 3 - Record each check received (Priority: P1)

A dancer hands over a check for $95: admission for two people, a T-shirt, and the rest a donation.
Mary (or the door) records the check against its writer, with a line for each thing it pays for and
a note where it helps. The check is not part of the cash count, and a large check can be marked for
its own deposit.

**Why this priority**: it is what the Treasurer asked for, and what the books and the deposit depend
on.

**Independent Test**: record a check for a writer already in the contacts and another for a new
person; give one an admission line for two people, a T-shirt line and a donation line; mark a third
for its own deposit; confirm the checks total, the admission figures, and the deposits listed.

**Acceptance Scenarios**:

1. **Given** the checks section, **When** Mary records a check, **Then** it takes the writer, the
   lines it pays for, and an optional note; it takes no check number.
2. **Given** a writer not yet in the contacts, **When** Mary records the check, **Then** the contact
   is created first and the check is recorded against it; a check is never recorded without a
   contact.
3. **Given** a check's lines, **When** Mary fills them in, **Then** each has an amount and is one
   of: admission (with, optionally, how many people it covers), membership (whose, and its level),
   donation (whose), a future event (whose), or another sale (merchandise, gift card, misc); each
   line takes an optional note.
4. **Given** the lines, **When** Mary saves the check, **Then** the check's amount is the sum of its
   lines, and a check with no lines is refused.
5. **Given** a membership line, **When** the check is saved, **Then** the membership is created or
   renewed at that level, as a membership sale does today.
6. **Given** checks recorded, **When** the page shows the money, **Then** the checks total is theirs
   — gross cash is bills and coins only — and admission is admission paid in cash, plus admission
   paid by check, plus admission paid by card.
7. **Given** a large or unusual check, **When** Mary ticks **deposit separately**, **Then** the
   evening lists its main deposit (the counted cash less the float, the payouts and the cash paid to
   performers, plus the checks not ticked) and one deposit for each ticked check.
8. **Given** a check recorded by mistake, **When** Mary corrects or removes it, **Then** it is saved
   on its own — the gate's Save does not replace the checks.

---

### User Story 4 - One dialog for a named sale, at the door or the gate (Priority: P1)

Meg is at the door when a dancer renews their membership and pays for a friend's ticket next month.
Meg records the sale from the check-in page as it happens, with a note saying which event. Mary sees
it on the gate page later and corrects the note. Mary's own save of the evening's cash never wipes
what Meg recorded.

**Why this priority**: it stops sales being lost, and it is the same dialog User Story 3 records a
check in.

**Independent Test**: record a membership and a future-event sale from the door with notes; open the
gate page, confirm both are listed with their notes, correct one, and save the gate money; confirm
neither sale is lost.

**Acceptance Scenarios**:

1. **Given** the check-in page, **When** Meg records a named sale, **Then** one dialog — the same
   one the gate page opens — finds the contact (creating one as the door does today), takes the
   category, the level for a membership, the amount, how it was paid, and a note.
2. **Given** that dialog on the door, **When** Meg saves a sale, **Then** it is recorded at once, on
   its own.
3. **Given** the door, **When** Meg looks for the evening's money totals or someone else's lines,
   **Then** she cannot change them; she may add a named sale or a check and correct her own.
4. **Given** the gate page, **When** Mary looks at the named sales, **Then** she sees every sale
   with its note, whoever recorded it, and may correct or remove any of them, one at a time.
5. **Given** a sale the door adds while Mary has the gate page open, **When** Mary saves the
   evening's cash and card, **Then** the sale is still there.
6. **Given** a note written on a sale, **When** the sale is shown on the gate page or the gate
   report, **Then** the note is shown with it; a sale without a note shows none.

---

### User Story 5 - Paying a performer confirms they played (Priority: P2)

The caller was still only pencilled in when the evening came, but she called it. Mary pays her, and
the booking stops saying "requested": someone who played and was paid has plainly confirmed, so the
Booker's report and the evening's figures stop counting her as unsettled.

**Why this priority**: it removes a standing inaccuracy in the bookings the club reads, at no extra
work for anyone. It rides here because this feature already touches what a payment records.

**Independent Test**: pay a proposed, a requested and a tentative booking, and a declined one that
holds a live check; confirm the first three read confirmed and the declined one is untouched.

**Acceptance Scenarios**:

1. **Given** a booking that is proposed, requested or tentative, **When** a payment for it is
   recorded, **Then** the booking becomes confirmed.
2. **Given** a booking already confirmed, **When** it is paid, **Then** nothing about its status
   changes.
3. **Given** a declined booking that a live check settles (a no-show kept when someone substituted),
   **When** it is paid, **Then** it stays declined.
4. **Given** a booking confirmed by its payment, **When** the payment is later voided or deleted,
   **Then** the booking stays confirmed.

---

### User Story 6 - The gate report the Treasurer reads (Priority: P2)

Michael opens the evening's report on his laptop and enters it in the books: each check as a receipt
to the person who wrote it, with what it paid for; the cash as the gate's own takings; then each
deposit, matching what the bank shows. He can print it for the binder, and he can see who recorded
the figures if something needs asking about.

**Why this priority**: it is the point of the record — but it reads what User Stories 1–4 write.

**Independent Test**: for an evening with two checks (one deposited separately), cash, other sales,
named sales and performer payments, open the report on a laptop, confirm each section, print it to
landscape letter, and confirm the names of who recorded the money and the payments.

**Acceptance Scenarios**:

1. **Given** an evening's report, **When** Michael reads it, **Then** each check is shown as a
   receipt to its writer, with its lines, their notes and their classes, apart from the cash
   takings.
2. **Given** the report, **Then** it lists each deposit — the main one and each separately deposited
   check — with what makes it up.
3. **Given** the report, **Then** it shows the evening's note and each check's and sale's notes.
4. **Given** the report, **Then** it names who recorded the gate money and who recorded the
   performer payments.
5. **Given** the report on a laptop, **Then** it is laid out for that screen; **When** Michael
   prints it, **Then** it fits landscape letter paper without cut-off columns.
6. **Given** an evening with no checks, **Then** the report says so plainly rather than showing an
   empty table.

---

### User Story 7 - The report on a phone (Priority: P3)

Michael checks a figure from his phone, held sideways.

**Why this priority**: a nice-to-have; the report is read at a desk.

**Independent Test**: open the report at 844 × 390 and confirm it is readable without sideways
scrolling.

**Acceptance Scenarios**:

1. **Given** the report at 844 × 390, **When** Michael reads it, **Then** it fits the width with
   smaller type and no sideways scrolling.

---

### Edge Cases

- **A check whose lines do not add up to what Mary typed as its amount**: the amount is the sum of
  the lines; there is no separate total to disagree with.
- **An admission line with no count**: allowed — "How many?" is optional; the evening's count comes
  from check-in.
- **A check with only a donation line**: allowed; nothing says a check must include admission.
- **A membership line for someone other than the writer**: allowed — the line carries whose
  membership it is.
- **A check deposited separately with the only cash of the evening**: both deposits are listed, one
  of them cash only.
- **The door records a check and Mary later removes a line**: allowed, and recorded against her.
- **Negative admission** (more other sales in cash than was counted): warned after Save, not
  blocked.
- **An evening with no door record yet**: opening the gate page starts one, as today.
- **A gift card redeemed** (not sold): still a count, not a sale, as today.
- **Someone without gate authority**: reads the page, cannot save; the door may still add a named
  sale or check.
- **An evening's records after 90 days**: still there — gate records are not purged.

## Requirements *(mandatory)*

### Functional Requirements

#### The gate page

- **FR-001**: The gate page MUST be usable on a phone first: a compact top region, dialogs for the
  less common tasks, large tap targets, no sideways scrolling, and refusals shown where the action
  was taken.
- **FR-002**: The page MUST confirm the event at the top as the other pages do — series, label,
  date, 12-hour time, a Change control and a not-today warning.
- **FR-003**: The page MUST show, above the fold and beside the performer-pay summary, the evening's
  money so far: admission by cash and by card, the card fee, the checks total and the deposit.
- **FR-004**: The sections MUST run: summary, the door's counts, cash, card, sales, checks.
- **FR-005**: The door's comp and gift-card counts MUST be shown beside the figures Mary confirms;
  the open-band count MUST stay read-only.
- **FR-006**: Admission, the card fee, the checks total and the deposit MUST update as Mary types,
  before she saves.
- **FR-007**: On saving, the page MUST point out negative admission, cash paid out with no reason,
  and card gross with no transaction count, without blocking the save and without warning while she
  types.
- **FR-008**: The page MUST warn before the event is changed or the page left with unsaved entries.
- **FR-009**: Money fields MUST ask for the phone's decimal keypad and count fields its number
  keypad.

#### Counting the cash

- **FR-010**: **Count** MUST open a dialog with the bill faces ($100, $50, $20, $10, $5, $1), the
  coins as one amount, an on-screen number keypad with a delete key and a way to move between
  denominations, and a running total.
- **FR-011**: **Use as gross cash** MUST put the total into gross cash and close the dialog.
- **FR-012**: A part-finished count MUST survive closing the dialog and reloading the page, and MUST
  be dropped when the gate is saved.
- **FR-013**: The counting dialog MUST NOT take checks.

#### Checks received

- **FR-014**: A check received MUST record its writer (shown as the **payer**) as a contact, an
  optional note, and one or more lines; it MUST NOT record a check number.
- **FR-015**: A writer who is not yet a contact MUST have one created first; a check MUST NOT be
  recorded without a contact.
- **FR-016**: Each line MUST carry an amount, an optional note, an optional quantity ("How many?" on
  admission), and one of: admission (a check's line only), membership (the member and the level),
  donation (the payer), future event (the payer), or another sale (merchandise, gift card, misc).
- **FR-017**: A check's amount MUST be the sum of its lines; a check with no lines MUST be refused.
- **FR-018**: A membership line MUST create or renew that member's membership at its level, as a
  membership sale does.
- **FR-019**: Checks MUST NOT count as cash: gross cash is bills and coins, and the evening's checks
  total is the sum of the checks recorded.
- **FR-020**: Admission MUST be admission paid in cash (as derived today), plus admission paid by
  check, plus admission paid by card.
- **FR-021**: Each check MUST carry a **deposit separately** mark, which only someone who may record
  gate money may set.
- **FR-022**: The evening MUST have one main deposit — counted cash less the float, the cash paid
  out and the cash paid to performers, plus the checks not marked — and one further deposit for each
  check that is marked; both pages MUST list every deposit with what makes it up.
- **FR-023**: A check MUST be added, corrected and removed on its own; the gate's Save MUST NOT
  replace the checks.

#### Sales, at the door and the gate

- **FR-024**: Every sale — named or not — MUST be recorded through one dialog, **Add a sale**,
  opened from the check-in page and the gate page. It chooses how it was paid (cash, check or card),
  finds or creates the **payer** (required for a check and for a membership, donation or future
  event, optional otherwise), and takes the category, the level for a membership, an optional
  quantity, the amount and a note. Admission is offered only when **check** is chosen.
- **FR-025**: Chosen as **check**, the same dialog MUST record a check received, with its lines
  (FR-016); cash and card record one line.
- **FR-026**: Every sale and every check MUST be saved one at a time, as soon as it is recorded; the
  gate's Save MUST cover only the money figures, the door's counts and the evening's note.
- **FR-027**: Someone with the door's authority MUST be able to add a sale or a check, and correct
  what they recorded, but MUST NOT be able to change the evening's money figures or anyone else's
  lines. Someone who may record gate money MUST be able to correct or remove any of them.
- **FR-028**: Every sale and every check line MUST take an optional note, shown wherever the sale is
  shown and never shown as an empty label.
- **FR-029**: The gate page MUST show who recorded each sale and each check.
- **FR-030**: The evening MUST take one free-text note of its own.

#### The gate report

- **FR-031**: The treasurer page MUST be the evening's gate report, laid out as: a header (event
  date and time; the event's label, or else the series name; the venue; the band, or the musicians'
  last names with the lead first; the caller; the sound tech — then who recorded it and the
  attendance breakdown and total); **receipts** on the left (each sale line with its quantity, name,
  and cash, check and card amounts, then admission, then total receipts); **expenses** on the right
  (each performer payment with role, name, check number or "cash" and amount, voided checks with
  their reason in the same list, the other cash paid out, the totals, and the rent marked unpaid and
  left out of the totals); then deposits and the card fee on the left and the evening's notes on the
  right. A line's note, a check's further bookings and a booked-versus-paid difference each go on a
  line directly beneath it. The QuickBooks class and customer are not shown.
- **FR-032**: The report MUST list each deposit and what makes it up; bookings paid at another
  evening go in the notes.
- **FR-033**: The report MUST name who recorded the gate money and who recorded the performer
  payments.
- **FR-034**: Recording or changing gate money, a named sale, a check or a performer payment MUST
  record the signed-in person durably, so FR-033 can name them.
- **FR-035**: The report MUST be laid out in two columns for a laptop and MUST print on landscape
  letter paper without cut-off columns, with no page headers or footers.
- **FR-036**: A section with nothing in it MUST say so rather than show an empty table.
- **FR-037**: (Nice to have) The report SHOULD fit a phone held sideways (844 × 390), its columns
  stacked, with smaller type and no sideways scrolling.

#### Paying confirms a booking

- **FR-039**: Recording a payment for a booking that is proposed, requested or tentative MUST set it
  to confirmed, on every path that records a payment.
- **FR-040**: A declined booking MUST stay declined when it is paid, and a booking confirmed this
  way MUST stay confirmed if its payment is later voided or deleted.

#### Keeping the record

- **FR-038**: Gate records — the money, the sales, the checks and their notes — MUST be kept, not
  purged.

### Key Entities *(include if data involved)*

- **Door record**: the evening's money — counted cash (bills and coins), the float, cash paid out
  and its reason, card gross and its transaction count, the door's counts, the evening's note, and
  the deposits worked out from them.
- **Gate sale**: one sale against the evening — its category, amount, how it was paid, the person
  for a named sale, the level for a membership, an optional note, and who recorded it.
- **Check received**: a check handed in — its writer (a contact), an optional note, whether it is
  deposited separately, who recorded it, and its lines. Its amount is the sum of its lines.
- **Check line**: one thing a check pays for — category, amount, an optional note, the number of
  people for admission, the member and level for a membership, the payer for a donation or future
  event.
- **Deposit**: money going to the bank as one slip — the evening's main deposit, or one separately
  deposited check.
- **Cash count**: the denomination counts kept while Mary is counting, dropped when the gate is
  saved.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Mary can record an evening's money — counting the cash, two checks, and the other
  sales — on a phone without sideways scrolling or leaving the page.
- **SC-002**: For every check received, the Treasurer can see whose it was and what it paid for,
  without asking.
- **SC-003**: The deposits the report lists add up to the money the evening took in cash and checks,
  less the float, the cash paid out and the cash paid to performers.
- **SC-004**: Admission always equals what was paid for it in cash, by check and by card.
- **SC-005**: A sale recorded at the door is never lost by a later save of the gate money.
- **SC-006**: Every evening's report names who recorded its money and its performer payments.
- **SC-007**: The report prints on one landscape letter page per section, with nothing cut off.
- **SC-008**: An evening's record, checks included, is still readable two years later.
- **SC-009**: No performer who was paid for an evening is still listed as unconfirmed for it.

## Assumptions

- The check-in page keeps its own purpose; this feature adds a named-sale button and dialog to it,
  nothing else.
- A check's admission line may say how many people it covers, to read the writer's intent; the
  evening's attendance still comes from check-ins, and this count does not change it.
- The main deposit assumes the checks not marked go to the bank with the cash, on one slip, as they
  do today.
- The card fee and the float keep the rules they have now.
- "Who recorded it" means the signed-in volunteer, and the report shows the last person to record
  each of the gate money and the performer payments.
- The evening's note and each check's note are free text; structuring what a note says (choosing the
  future event, adding household members) is not in this feature.
- The performer-pay summary at the top of the gate page, and the performers' cash line, are already
  there from feature 081.

## Out of Scope

- Warnings about unconfirmed bookings on the gate, payments and treasurer pages (BK-C5, the booker's
  work).
- A home for unmatched online membership payments (backlog B52).
- Any change to how performers are paid (feature 081) beyond recording who did it and confirming the
  booking it settles.
- Recording the check numbers of checks received, or images of them.
- Exporting the report to QuickBooks; the Treasurer enters it by hand, from the report.
- Keeping scans of the paper gate reports.
