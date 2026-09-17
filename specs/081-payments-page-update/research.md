# Research: Performer payments, rebuilt for Mary

Each decision below comes from reading the code the feature touches. No `NEEDS CLARIFICATION`
remained after `/speckit-clarify`.

## What exists today

- `performer_payments` (019/023): `event_id` (recorded at), payee, `amount_cents` (Σ lines),
  nullable `check_number`, `override_reason`, `voided_at`/`void_reason`, `replaces_payment_id`
  (never set). `payment_bookings` (payment, booking, `amount_cents`) settles bookings at **any**
  event (023).
- No uniqueness anywhere: not on `check_number`, not on a booking's live settlement. Void overwrites
  a previous void. `deletePerformerPayment` and `DELETE /api/performer-payments/{id}` exist, unused.
- `bookings.requires_check` = the type's rule ∧ pay > 0; instructor and open-band musician are
  forced to $0 in `createBooking` and `patchBooking`, and their rule says no check.
- `substitutePerformer`: unpaid → re-point in place **at the slot's standard rate**; live-paid →
  declined no-show + new booking **at the standard rate**. Neither copies the booked amount.
- `addSettlementPerformer` always uses the standard rate and silently returns an existing booking.
- The door record stores `cash_paid_out_cents` (+ reason) and a **stored** `deposit_cents`,
  recomputed only when the door record is patched. The club counts gross cash **before** paying out:
  admission cash = gross − float − other cash sales; deposit = gross − float − paid out (`calc.ts`,
  `eventMoney.ts`).
- `treasurer_report_audit` records every generation of the treasurer report (040).
- The treasurer report returns live and voided checks separately; the page shows only live ones.
- Feature 079's `EventConfirm` lives in `(door)/checkin/` with that page's CSS module.

## R1 — Payment method

**Decision**: add `performer_payments.method` (`check` | `cash`), with a table check: a check has a
number, cash has none. Migration backfills `cash` for today's number-less payments (spec
Assumptions).

**Rationale**: FR-031. The method is a fact the gate and the treasurer report need; inferring it
from a null number is what made "a payment with no number and a note" ambiguous.

**Alternatives**: keep inferring from `check_number IS NULL` — rejected; a check whose number is not
yet known is no longer allowed, and the report needs an explicit cash line.

## R2 — One live payment per booking, enforced by the database

**Decision**: add `payment_bookings.live boolean NOT NULL DEFAULT true`, set to `false` for all of a
payment's lines in the same transaction that voids it, and a partial unique index `payment_bookings
(booking_id) WHERE live`. The service also checks first, to return a clear `BOOKING_ALREADY_PAID`
(409) naming the payment, and maps the unique violation to the same error for races.

**Rationale**: FR-011 and SC-002 ("directly against the server"). A cross-table rule (line ∧ payment
not voided) cannot be a plain constraint; the denormalised flag makes it one. Void is terminal, so
the flag never flips back.

**Alternatives**: a row lock on the booking in the service — correct but only as good as every write
path remembering it; a trigger — more machinery than one flag.

## R3 — Check numbers unique club-wide

**Decision**: a unique index on `performer_payments (check_number) WHERE check_number IS NOT NULL`,
live or voided. Numbers are trimmed on the way in. A clash returns `CHECK_NUMBER_TAKEN` (409) with
details `{ paymentId, eventId, eventDate, payee, voided, sameEvent }`, so the page can offer "Add
this booking to check #N" only when `!voided && sameEvent` (FR-013), else only "Change the number".
`sameEvent` compares the holder's event with the request's `eventId` — the event being paid from —
so an earlier booking can join tonight's check.

**Migration and existing duplicates**: the migration first looks for duplicate numbers and, if any
exist, **stops with an error listing them** rather than guessing which to keep. The quickstart gives
the query and the one-off fix for the development database (delete the extras, or reset the
database). Production has no data yet.

**Alternatives**: renumber duplicates automatically (`1500-2`) — rejected, it invents check numbers
the bank never saw.

## R3a — The form of a check number

**Decision**: a check number is digits optionally followed by one letter — `^[0-9]+[A-Z]?$` — kept
as text. Input is trimmed and upper-cased before validation, so "1500a" is stored as "1500A". A
malformed number is refused with `INVALID_CHECK_NUMBER` (422) by Zod, and a table check guards the
column. Sorting uses the digits as a number, then the letter (none first): 1500, 1500A, 1500B, 1501.
The number-taken choice's **Change the number** carries the hint "From a duplicate check book? Add a
letter, e.g. 1500A."

**Rationale**: the club has been sent duplicate check books; a letter tells the two apart while the
uniqueness rule (R3) stays exact. Restricting the form catches typos ("#1500", "15OO") before they
become a second, different number.

**Alternatives**: free text (today) — lets typos through as distinct numbers; an integer column plus
a separate suffix column — more change for the same effect; case-insensitive comparison without
upper-casing — two spellings of one number would still be stored.

**Migration**: existing numbers are trimmed and upper-cased; if any then fails the pattern, the
migration stops and lists them, as it does for duplicates.

## R4 — Adding a booking to an existing check

**Decision**: `POST /api/performer-payments/{id}/lines` adds one line (event paid from, booking,
amount); the check's total grows by it. Same rules as creating (R2, R8), refused for a voided check,
a cash payment (R6), or a check recorded at an event other than the one Mary is paying from. The
booking itself may be at an earlier event (R14) — the rule compares the **check's** event with the
**paying** event, never with the booking's.

**Rationale**: FR-013's "Add this booking to check #N" is a different action from creating a
payment; a dedicated route keeps the create path simple.

## R5 — The "second payment to this performer" confirmation, enforced by the server

**Decision**: create, and a patch that changes the payee, refuse with `SECOND_PAYMENT_TO_PAYEE`
(409, with the existing payment's number/method and amount) when the payee already has a **live**
payment recorded at the **same event**, unless the request carries `confirmSecondPayment: true`.
Adding a line to an existing check is not a second payment.

**Rationale**: FR-014 says "on every path"; putting the rule in the service makes every page path —
row, several-performers dialog, earlier-booking dialog, edit — ask the same way.

## R6 — Cash settles one booking; the several-performers dialog is checks only

**Decision**: the service refuses `method = cash` with more than one line (create, patch lines, add
line) with `CASH_SINGLE_BOOKING` (422). Cash payments cannot be voided (`CASH_NOT_VOIDABLE`, 422);
they are corrected or deleted. The several-performers dialog offers no method choice and requires a
number.

## R7 — Cash to performers in the gate's cash paid out and the deposit

**Decision**:

- `door_records.cash_paid_out_cents` keeps its meaning of **other** payouts (with its reason); the
  gate page relabels it "Other cash paid out".
- A new `performerCashCents(db, eventId)` sums live cash payments recorded at the event.
- `depositCents(gross, float, otherPaidOut, performerCash)` subtracts both.
- One function, `refreshDeposit(tx, eventId)`, recomputes and stores `deposit_cents`;
  `updateDoorRecord` uses it, and so does every payment write that touches cash (create, patch, add
  line, delete) and a patch that changes method, in the same transaction. A cash payment at an event
  with no door record creates it (`ensureDoorRecord`), since the money came out of that evening's
  box. Until that gate is saved its deposit reads negative (0 − float − cash); that is expected, and
  the gate page shows it as it is.
- The door-record GET and the new summary (R10) return the performers' cash lines for display.

**Rationale**: FR-033 and clarification Q1. Recomputing the stored deposit on every relevant write
keeps every reader (treasurer report, organizer report, `eventMoney`) unchanged and correct.

**Alternatives**: compute the deposit on read everywhere — more readers to change and easy to miss
one; pre-fill the gate field — rejected in clarification.

## R8 — Replacement link

**Decision**: on create, if a line's booking has a voided payment not yet replaced, set
`replaces_payment_id` to the most recently voided such payment (the client no longer sends it).

## R9 — Voiding

**Decision**: the void route requires a non-blank reason (already), refuses a voided payment
(`ALREADY_VOIDED`, 409 — the update also filters `voided_at IS NULL`) and a cash payment (R6), and
sets the lines' `live = false` (R2).

## R10 — The summary, one computation for both pages

**Decision**: `getPaymentSummary(db, eventId)` in the payments domain, returned by a new `GET
/api/events/{id}/payment-summary` (`base`, like the attendance breakdown) and embedded in the
performer-payments list response. It returns cents-exact dollars:

- `booked` — booked amounts of the event's counted bookings;
- `paid` — live line amounts settling them, wherever recorded;
- `stillToPay`, `stillToPayCount` — counted bookings with `pay > 0` and no live line;
- `difference` — Σ (paid − booked) over bookings with a live line;
- `earlierPaidHere` — live line amounts recorded at this event for other events' bookings;
- `performerCash` — live cash payments recorded here: payee, amount (for the gate's line).

**Counted bookings** exclude declined bookings with no live line (a performer who declined is
neither owed nor listed); a declined booking that was paid (the 024 no-show) is counted as paid.

Invariant (SC-006): `booked = paid + stillToPay − difference`, asserted in a test.

## R11 — Free unless a booked amount is set

**Decision**: in `createBooking` and `patchBooking`, instructor and open-band musician are $0
**unless `pay` is given**. `requires_check` becomes "has a booked amount" for every type (`pay > 0`,
not donated); the performer rule's `requiresCheck` for those two types changes to `true` so a paid
one is payable. The column name stays (renaming it touches every reader for no behaviour).

A payment may settle any booking, including a $0 one (FR-007): the page's "Pay" on a free row
records a payment with the amount entered; the booked amount is untouched.

## R12 — Adding a performer

**Decision**:

- `GET /api/events/{id}/roles` returns the roles the event's series allows (sound tech only when
  `has_sound_tech`) with each role's standard rate on the event's date (`resolveParameterCents`; $0
  for the free-unless-set roles). `base`.
- `GET /api/performers?q=&eventId=` adds `bookedAs` (role) for performers already booked on that
  event.
- `settlementPerformerSchema` gains optional `pay`; `addSettlementPerformer` passes it to
  `createBooking` and **refuses** an already-booked performer with `ALREADY_BOOKED` (409) instead of
  returning the existing booking.
- Creating a performer uses the existing `POST /api/performers` (`performer.write`, which the FS
  holds), either with `contactId` (a contact found by the door's contact search) or with names and
  an optional email (the service creates the contact first, in one transaction). No new creation
  path (X-P1).

## R13 — Substituting

**Decision**: `substitutePerformer` copies the replaced booking's `pay_cents`, `is_overridden` and
`requires_check` onto the substitute, on both the unpaid (re-point) and live-paid (new booking)
paths. A donated booking's substitute is booked at $0, not donated. The Booker's re-point through
`patchBooking` (the bookings report) is unchanged.

## R14 — Paying an earlier booking

**Decision**: `GET /api/performers/{id}/unpaid-bookings?forEvent={eventId}` lists that performer's
bookings at events dated in the 90 days before the given event (exclusive of it), with `pay > 0`,
not donated, not declined, no live line, and in a series where the actor holds
`performer_payment.write`. Paying uses the ordinary create with `eventId` = the event Mary is on
(023 already allows the booking to be elsewhere).

`listPerformerPayments` adds, per booking of the event, `paidElsewhere: { eventId, eventDate }` when
its live line was recorded at another event, and each payment line carries its booking's event date,
role and performer so the paying page can list "earlier bookings paid tonight" apart.

## R15 — Treasurer report

**Decision**: the report gains:

- `checks`: every check recorded at the event, live and voided, sorted by number (R3a), each with
  `voided`, `voidReason`, `replacedBy` (number); lines carry `booked`, `paid`, the event date when
  the booking is at another event;
- `cashPayments`: live cash payments recorded at the event (payee, amount, lines as above), shown
  under cash paid out with `otherCashPaidOut` and its reason;
- `paidElsewhere`: this event's bookings settled at another event (performer, amount, that event's
  date);
- payment `note` on any payment that differs from its bookings.

`performerPayments` and `voidedPerformerPayments` stay in the response for existing readers and
tests until the page stops using them; the page switches to `checks`.

## R16 — Page structure and shared pieces

**Decision**:

- `EventConfirm` moves to `src/app/_components/` with its own CSS module; `/checkin` imports it from
  there; `/payments` uses it.
- `PaymentSummaryView` in `src/app/_components/` (like `AttendanceBreakdownView`), used by
  `/payments` and `/gate`.
- `/payments` is split into a page plus components beside it: `PerformerRow`, `PerformerPicker`
  (search, "already booked as", create — shared by Add and Substitute), and one dialog each for Add,
  Substitute, several performers, earlier booking, edit, void and delete, plus a small
  `ConfirmDialog` for the second-payment and check-number choices. A `payments.module.css`,
  mobile-first, following `checkin.module.css`.
- Performer order is a pure `orderBookings()` (caller, lead musician, musician, sound tech, then
  instructor, open-band musician; by name) used by the page.
- Void/Delete explanations are visible text under the two buttons ("Void: the check was written.
  Delete: it was never written."), not a tooltip.

## R17 — The treasurer-report warning on delete

**Decision**: the performer-payments list response carries `treasurerReportGeneratedAt` (latest
`treasurer_report_audit.created_at` for the event, or null). The delete confirmation shows the
warning only when that time, on the device's local date, is after the event's date — the Treasurer
works from the report the next day, and a report printed on the night means nothing is in the ledger
yet (manual pass, 2026-09-17). The server does not refuse (FR-017).

**R16 amendment (manual pass)**: the Void/Delete explanation is shown once above the list, not under
every paid row — tooltips need hover, which phones lack.

## R18 — Unmatched online payments

**Decision**: remove the section and its loading from `/payments`. `/api/membership-captures/parked`
and its link route stay as they are (FR-029; home decided in B52).
