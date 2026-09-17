# Data Model: Performer payments, rebuilt for Mary

One migration, **`0051_payment_integrity.sql`**. See [research.md](./research.md) for the reasons.

## Migration 0051

In order, in one transaction:

1. **Refuse duplicate check numbers.** If any trimmed, upper-cased `check_number` appears on more
   than one payment, raise an exception listing the numbers and payment ids (R3). Nothing else runs.
2. **Refuse double-settled bookings.** If any booking has lines on more than one non-voided payment,
   raise an exception listing them (R2).
3. `CREATE TYPE performer_payment_method AS ENUM ('check', 'cash')` — the name `payment_method` is
   already the gate's cash/card enum (0004).
4. `performer_payments`:
   - `ADD COLUMN method performer_payment_method NOT NULL DEFAULT 'check'`;
   - `UPDATE … SET method = 'cash' WHERE check_number IS NULL` (spec Assumptions);
   - `UPDATE … SET check_number = upper(btrim(check_number))`;
   - **refuse malformed numbers**: if any `check_number !~ '^[0-9]+[A-Z]?$'`, raise an exception
     listing them (R3a);
   - `ADD CONSTRAINT performer_payments_check_number_form CHECK (check_number ~ '^[0-9]+[A-Z]?$')`;
   - `ADD CONSTRAINT performer_payments_method_number CHECK ((method = 'check') = (check_number IS
     NOT NULL))`;
   - `CREATE UNIQUE INDEX performer_payments_check_number ON performer_payments (check_number) WHERE
     check_number IS NOT NULL`.
5. `payment_bookings`:
   - `ADD COLUMN live boolean NOT NULL DEFAULT true`;
   - `UPDATE payment_bookings pb SET live = false FROM performer_payments p WHERE p.id =
     pb.payment_id AND p.voided_at IS NOT NULL`;
   - `CREATE UNIQUE INDEX payment_bookings_one_live ON payment_bookings (booking_id) WHERE live`.
6. `bookings`: `UPDATE bookings SET requires_check = (pay_cents > 0 AND NOT is_donated)` — the rule
   of R11 (a no-op for today's data except any paid instructor or open-band row).

## Entities

### Payment (`performer_payments`)

| Field | Change | Rule |
|---|---|---|
| `event_id` | — | The event where the money was paid (the paying evening). |
| `payee_performer_id` | — | Editable (FR-015); a change is subject to the second-payment rule. |
| `method` | **new** | `check` or `cash`. |
| `check_number` | now unique, formed | Required for a check, absent for cash; digits plus an optional letter (`1500`, `1500A`), trimmed and upper-cased; unique club-wide, live or voided. |
| `amount_cents` | — | Always Σ of its lines. |
| `override_reason` | — | The optional note (FR-008). |
| `voided_at`, `void_reason` | — | Set once; a check only; reason required. |
| `replaces_payment_id` | now set | By the service, from the most recently voided, unreplaced payment of a line's booking. |

**States**: *live* → *voided* (checks only, terminal). Any live payment may be *deleted* (audited).
A voided check cannot be edited, deleted or voided again.

**Rules**: cash has exactly one line; a check has one or more. A payee with a live payment at the
same event needs `confirmSecondPayment` for another.

### Payment line (`payment_bookings`)

| Field | Change | Rule |
|---|---|---|
| `payment_id`, `booking_id`, `amount_cents` | — | A line may settle a booking at another (earlier) event. |
| `live` | **new** | `false` once its payment is voided. At most one live line per booking. |

### Booking (`bookings`)

| Field | Change | Rule |
|---|---|---|
| `pay_cents` | rule change | Instructor and open-band musician: $0 unless a pay is given (R11). Set by the Add dialog's rate; copied on substitution (R13). |
| `requires_check` | rule change | `pay_cents > 0 AND NOT is_donated`, for every type. Read as "has a booked amount". |

Unchanged: `is_donated`, `status`, `is_overridden`.

### Door record (`door_records`)

| Field | Change | Rule |
|---|---|---|
| `cash_paid_out_cents`, `cash_paid_out_reason` | meaning narrowed | Other payouts only; reason required when > 0 (as today). |
| `deposit_cents` | recomputed more often | gross cash − seed float − other paid out − live cash payments recorded at the event; refreshed on every door-record update and every cash-affecting payment write (R7). |

### Treasurer report generation (`treasurer_report_audit`)

Unchanged. Its latest `created_at` for an event drives the delete warning (R17).

## Derived views

- **Payment summary** (R10): `booked`, `paid`, `stillToPay`, `stillToPayCount`, `difference`,
  `earlierPaidHere`, `performerCash[]`. Invariant: `booked = paid + stillToPay − difference`.
- **Row state** on `/payments`, per counted booking, in `orderBookings()` order:
  - *paid here* — a live line on a payment recorded at this event;
  - *paid at {date}* — a live line on a payment recorded at another event;
  - *to pay* — `pay_cents > 0`, no live line;
  - *free* — `pay_cents = 0`, no live line (offers **Pay**);
  - plus any quiet *voided* lines for the booking.
