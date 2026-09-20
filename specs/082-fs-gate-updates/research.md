# Research: The gate evening, and the report the Treasurer reads

Decisions come from reading the code this feature changes. No `NEEDS CLARIFICATION` remained after
the requirements review; the Treasurer's answer settled the one open question (checks, MARY-R20).

## What exists today

- `door_records`: one row per event — counted cash, seed float, cash paid out and its reason, card
  gross and its transaction count, the POS fee, the stored deposit, comp / gift-card / open-band
  counts. No note, and nothing about who recorded it. `door_record_audit` rows carry a free-text
  actor, which every page leaves as "door" (the `x-actor` header is never sent).
- `gate_sales`: category (`admission`, `merchandise`, `donation`, `future_event`, `membership`,
  `gift_card`, `misc_sales`), `payment_method` (`cash` | `card`), amount, `contact_id` for a named
  sale, one `note` (used for the anonymous-sales comment), `membership_level`. The old
  `(door_record_id, category, payment_method)` unique constraint was dropped in 0007, so several
  named sales in a category already work. `admission` is in the enum but the route's schema refuses
  it — admission has always been derived.
- `putGateSales` is **replace-all**: it deletes an event's sales and re-inserts what the page sends,
  then `enrollDoorMemberships` creates or renews a membership for each named membership line.
- `computeEventGate` derives admission: cash = gross cash − float − non-admission cash; card = card
  gross − non-admission card. The organizer report and the treasurer report both read it, so its
  shape is load-bearing.
- `depositCents(gross, float, otherPaidOut, performerCash)` and `refreshDeposit` (081) keep the
  stored deposit in step with performer cash.
- The treasurer page renders the report and has a Print button that prints the whole page. The
  printable calendar shows the house pattern for print CSS (`@page` plus hiding everything but one
  region).
- `/checkin` has the door's contact search and Add contact dialog (079); the door attendant holds
  `attendance.write`, `contact.write` and `contact.pii.read`, not `gate.write`.
- A payment records no one; only a deletion (081) writes a durable audit row naming the signed-in
  person.

## R1 — Where a received check lives

**Decision**: a new `gate_checks` row per check (writer, note, deposit-separately, who recorded it)
with its lines as **`gate_sales` rows** carrying `check_id` and `payment_method = 'check'`.

**Rationale**: a check's lines *are* gate sales — a membership, a donation, a T-shirt, admission —
and every reader already understands gate sales: `computeEventGate`, the treasurer and organizer
reports, the membership enrolment, the mailing-list exports. A separate "check line" table would
need each of them taught twice.

**Alternatives**: checks as their own table with their own line table — duplicates the sale rules
and the membership path; a single `gate_sales` row per check with a JSON breakdown — unqueryable for
the report the Treasurer reads.

## R2 — `payment_method` gains `check`

**Decision**: add `check` to the existing `payment_method` enum. Postgres cannot use a value added
to an enum in the same transaction, and the migration runner wraps each file in one, so the value is
added in its own migration (**0052**) and used by the next (**0053**).

**Alternatives**: a separate `gate_payment_method` enum and a column type change — more migration
risk for the same result; a boolean `is_check` — leaves the method in two places.

## R3 — Admission by check, and what changes in the money

**Decision**: a check may carry an `admission` line with `people_count`. `computeEventGate` becomes:

- `admissionCashCents` = gross cash − seed float − non-admission **cash** (unchanged);
- `admissionCardCents` = card gross − non-admission **card** (unchanged);
- `admissionCheckCents` = the checks' `admission` lines (new);
- `admissionCents` = the three added (was two).
- `checksCents` = every check's lines (new), so the page can show the checks total.

Gross cash stays "the cash counted", which now excludes checks because they are not counted with it.

**Rationale**: FR-019 and FR-020. Keeping the two derived figures untouched means the organizer
report's takings and average ticket follow without further change.

**Note**: `people_count` is for the books (FR-016); the evening's attendance still comes from
check-ins (spec Assumptions), so no attendance figure reads it.

## R4 — Deposits

**Decision**: deposits are derived, never stored as rows.

- **Main deposit** = counted cash − seed float − other cash paid out − performers' cash + the checks
  **not** marked deposit-separately. `door_records.deposit_cents` keeps this figure, refreshed as
  081 refreshes it.
- **One further deposit per marked check**, listed with its writer and amount.
- One function, `eventDeposits(db, eventId)`, returns the list; `/gate` and the report both read it.

**Alternatives**: a `deposits` table — nothing chooses which check goes in which deposit beyond the
mark, so rows would only duplicate what the mark already says.

## R5 — Saving: the money in one Save, each sale on its own

**Decision**: `putGateSales` narrows to the **anonymous** categories (`merchandise`, `gift_card`,
`misc_sales`) — the only ones the page's Save still owns. Named sales and checks get their own
routes (create, patch, delete), so a sale the door records is never replaced by Mary's Save (FR-026,
MARY-R8 Q3).

**Rationale**: replace-all is what would wipe the door's sale. Narrowing it keeps the anonymous
section's simple "these are the totals" save, which has no identity to preserve.

**Superseded 2026-09-18 by R16**: the Save no longer carries sales at all.

## R6 — Who may record what

**Decision**: no new capability.

- Creating a named sale or a check, and correcting or removing **one you recorded**:
  `attendance.write` **or** `gate.write` in the event's scope (`assertEventScopeAny`, as
  substitution does).
- Correcting or removing **someone else's**, and setting **deposit separately**: `gate.write`.
- The money figures, the counting dialog and the anonymous sales: `gate.write`, as today.

**Rationale**: MARY-R8 Q1 — the door records the fact of a sale; the evening's money stays Mary's.
`recorded_by` (R7) is what makes "one you recorded" answerable.

## R7 — Who recorded it

**Decision**: a `recorded_by_contact_id` column on each thing the report names:

- `gate_sales` and `gate_checks` — set on create, and updated when someone else corrects the row;
- `door_records.money_recorded_by_contact_id` — the last person to save the evening's money;
- `performer_payments.recorded_by_contact_id` — the last person to record or change that payment.

The report names the door record's money recorder and, for the payments, the most recent payment's
recorder. Writes also keep their audit events, now with the signed-in contact (`recordAudit`) rather
than a placeholder.

**Rationale**: FR-033, FR-034. A column is what the report can read in one query; audit rows are the
trail, not a lookup. Reading "who" out of `audit_events` would mean scanning history per evening.

**Alternatives**: audit-only (no columns) — the report would have to reconstruct the answer; a
single `recorded_by` on the door record — cannot say who recorded an individual sale (FR-029).

## R8 — The cash count while counting

**Decision**: `door_records.cash_count` (JSON: bill faces → counts, plus coins) holds the count in
progress, written as Mary keys it and **cleared when the money is saved** (MARY-R16 Q17).

**Rationale**: FR-012. The door record is already the evening's row and is already saved by the same
page; a separate table for something deliberately thrown away would outlive its purpose.

## R9 — The counting keypad

**Decision**: one dialog with its own on-screen keypad: the bill faces ($100, $50, $20, $10, $5, $1)
and coins as one amount, a delete key, next/previous denomination, a running total, and **Use as
gross cash**. No checks (R1). The keys are buttons, so they work without a hardware keyboard and
need no focus trickery.

## R10 — Live figures and warnings

**Decision**: the page computes admission, the card fee, the checks total and the deposit **on the
client** from what is typed, using the same pure functions the server uses (`posFeeCents`,
`depositCents` and a new pure `deriveGateMoney`), and shows the server's figures after a save.
Warnings (negative admission, payout with no reason, card gross with no count) come back **from the
save** and are shown then (FR-007).

**Rationale**: MARY-R15 Q10 and Q11: figures follow the typing, warnings do not nag. One shared pure
module keeps the preview and the saved record from disagreeing.

## R11 — The gate report's layout and print

**Decision**: the treasurer page keeps its screen layout for a laptop and gains a CSS module with
`@media print { @page { size: letter landscape; margin: 0.4in } … }`, hiding everything but the
report region, following `PrintableCalendar.module.css`. The phone layout (FR-037) is one media
query at the end, last in the task list so it can be dropped.

## R12 — Paying confirms the booking

**Decision**: in the payment service, after a payment's lines are written, set each settled booking
whose status is `proposed`, `requested` or `tentative` to `confirmed` — a direct update in the same
transaction, not a lifecycle transition (`proposed → confirmed` is not an allowed step, and this is
a settlement fact). `declined` is left alone; voiding or deleting the payment does not put the
status back (FR-039, FR-040).

**Rationale**: MARY-R22. Doing it in the service covers every path — a row, the several-performers
dialog, an earlier booking, an added line.

## R13 — Membership from a check line

**Decision**: the named-sale and check-line paths both go through the existing
`enrollDoorMemberships` logic, which keys on the payer and the target boundary rather than the sale
id, so a corrected or re-saved line does not double-enrol.

## R14 — What the door's dialog is

**Decision**: one dialog component in `src/app/_components/`, opened by `/checkin` and `/gate`, with
two shapes behind one chooser: **a sale** (category, level for a membership, amount, cash or card,
note) and **a check** (writer, lines, note, and — for `gate.write` only — deposit separately). It
reuses 079's contact search and Add contact dialog for the person, and 081's `PerformerPicker`
pattern for its own list handling.

## R15 — Retention

**Decision**: nothing to do. The 90-day purge (079) deletes check-ins only; door records, gate sales
and now checks are never purged (FR-038). A test pins it.

## Decisions from the P1 review (2026-09-18)

### R16 — Every sale is its own line

**Decision**: retire the gate's replace-all sales Save (`putGateSales`, `PUT
/api/door-records/{id}/gate-sales`). Every sale — named or anonymous — is a `gate_sales` row written
one at a time through `gateSaleService`, from the door or the gate, and corrected or removed one at
a time. The Save keeps the money figures, the door's counts and the evening's note.

**Rationale**: the door needs to record an anonymous sale (a T-shirt, no name) and the FS to correct
it. Replace-all is what would wipe it; R5 narrowed replace-all to the anonymous totals, which only
moved the problem. Lines also carry who recorded them and a note each, and they are exactly the rows
of the report's itemized receipts (R19). One write path instead of two — less code.

**Alternatives**: an "Anonymous" pseudo-contact — the named path would protect it, but it would be a
person to deduplication, merging, deleting, the mailing-list exports and the books; every reader of
contacts would need to be taught it is not one. Rejected.

**Migration**: none needed for data. Existing evenings' anonymous totals are already one row per
category and payment method, and simply read as lines.

### R17 — A quantity on any line; "How many?" optional

**Decision**: replace `gate_sales.people_count` with a general `quantity` (integer, null, > 0 when
set) on any line: "How many?" on admission, the number sold on merchandise, gift cards and other
items. Optional everywhere. Admission still exists only on a check's line (FR-020). Migration
**0055** renames the column, drops `gate_sales_people_on_admission` and
`gate_sales_admission_needs_people`, and adds `gate_sales_quantity_positive`.
`ADMISSION_NEEDS_PEOPLE` is retired.

### R18 — One dialog: Add a sale

**Decision**: the shared dialog opens as **Add a sale** on both pages, choosing **cash, check or
card**. Cash and card take one line; a check takes several, a note of its own, and — for whoever may
record gate money — deposit separately. The **Payer** (formerly Writer) is required for a check and
for a membership, donation or future event, and optional for merchandise, gift cards and other
items. A named line may be for someone other than the payer ("For"), which is whose membership or
donation it is. Admission is offered only when **check** is chosen. Editing keeps the way it was
paid.

For cash and card there is no separate payer column: the line's contact is whose it is (the member,
the donor), defaulting to the payer.

### R19 — The gate report, laid out as the paper one

**Decision**: the report's API gains what the layout needs and keeps the fields it has:

- `header`: event date and start time, the label or else the series name, the venue's name, the band
  name — or the booked musicians' last names, lead first — the caller and the sound tech;
- `receipts`: every sale line, a check's lines included (quantity, name, the amount in its cash,
  check or card column, note, and "for" when the line is not the payer's), then admission in cash
  and by card as derived, then the totals;
- `expenses`: each performer payment — live and voided — with its role, payee, check number or
  "cash", amount, and note lines (further bookings, booked versus paid, the void reason); the other
  cash paid out with its reason; the totals (live payments and payouts); and the rent, marked
  unpaid, out of the totals;
- the deposits (R4), the card gross, count and fee; the evening's note and the bookings paid at
  another evening, both ways, for the notes block.

The page renders a header, then two columns — receipts and expenses, then deposits and notes — for a
laptop and for print, and stacks them on a phone. The QuickBooks class and customer, and page
headers and footers, are not shown.

**Rent paid on the night** (a one-off venue) is backlog B54.
