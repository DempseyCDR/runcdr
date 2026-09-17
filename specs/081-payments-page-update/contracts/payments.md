# Contract: performer payments

Money in and out is in dollars (two decimals); storage is cents. Every error uses the existing
envelope `{ error: { code, message, details? } }`. Routes marked **changed** keep their existing
fields unless noted.

## New error codes

| Code | Status | When | `details` |
|---|---|---|---|
| `BOOKING_ALREADY_PAID` | 409 | A line's booking already has a live line | `{ bookingId, paymentId, checkNumber, method }` |
| `CHECK_NUMBER_TAKEN` | 409 | The number is on another payment | `{ paymentId, eventId, eventDate, payee, voided, sameEvent }` — `sameEvent`: the holder was recorded at the request's `eventId` (the event being paid from), whatever event the booking is at |
| `SECOND_PAYMENT_TO_PAYEE` | 409 | Payee has a live payment at this event and `confirmSecondPayment` is not true | `{ paymentId, checkNumber, method, amount }` |
| `INVALID_CHECK_NUMBER` | 422 | Not digits with an optional letter | — |
| `CASH_SINGLE_BOOKING` | 422 | Cash with more than one line | — |
| `CASH_NOT_VOIDABLE` | 422 | Void of a cash payment | — |
| `ALREADY_VOIDED` | 409 | Void, edit, delete or add-line on a voided check | — |
| `ALREADY_BOOKED` | 409 | Adding a performer already booked on the event | `{ bookingId, performerType }` |

## Payments

### `POST /api/performer-payments` — changed, `performer_payment.write` (event scope)

```json
{ "eventId": "…", "payeePerformerId": "…", "method": "check", "checkNumber": "1453",
  "overrideReason": "agreed $100", "confirmSecondPayment": false,
  "lines": [{ "bookingId": "…", "amount": 100 }] }
```

- `method` required. `check` ⇒ `checkNumber` required — digits with an optional letter, trimmed and
  upper-cased (`"1500a"` → `"1500A"`); `cash` ⇒ no `checkNumber`, exactly one line.
- `overrideReason` optional in every case (the old "no number needs a note" rule is gone).
- `replacesPaymentId` is no longer accepted; the server sets it.
- 201 → the payment view (below). Errors: the new codes above; 404s as today.
- A cash payment refreshes the event's deposit (creating the door record if missing).

### `PATCH /api/performer-payments/{id}` — changed

Any subset of `checkNumber`, `payeePerformerId`, `overrideReason`, `lines`, `method`,
`confirmSecondPayment`. `lines` replaces the allocation (min 1). Same rules as create. Refused on a
voided check. Refreshes the deposit when the payment is or was cash.

### `POST /api/performer-payments/{id}/lines` — new, `performer_payment.write`

`{ "eventId": "…", "bookingId": "…", "amount": 120 }` → 200 with the payment view, total grown by
`amount`. `eventId` is the event Mary is paying from (the page's event); the booking may be at that
event or an earlier one. Refused for a voided check, cash, a check recorded at an event other than
`eventId` (422), and by `BOOKING_ALREADY_PAID`.

### `POST /api/performer-payments/{id}/void` — changed

`{ "reason": "wrong amount" }` (non-blank). Refused: `ALREADY_VOIDED`, `CASH_NOT_VOIDABLE`. Marks
lines not live.

### `DELETE /api/performer-payments/{id}` — existing, now used

Returns 204 with no body. Refused for a voided check (`ALREADY_VOIDED`). Audited
`performer_payment.deleted` with the payment's number, method, amount and lines. Refreshes the
deposit when cash.

### Payment view

```json
{ "id": "…", "eventId": "…", "payeePerformerId": "…", "payee": "Pat Fiddler",
  "method": "check", "checkNumber": "1453", "amount": 100, "overrideReason": null,
  "voided": false, "voidReason": null, "voidedAt": null,
  "replacesPaymentId": null, "replacedByCheckNumber": null,
  "lines": [{ "bookingId": "…", "amount": 100, "booked": 120,
              "eventId": "…", "eventDate": "2026-09-04", "performer": "Pat Fiddler",
              "performerType": "musician" }] }
```

### `GET /api/events/{id}/performer-payments` — changed, `base`

```json
{ "payments": [ /* payment views recorded at this event, live and voided */ ],
  "voidedByBooking": { "<bookingId>": [{ "checkNumber": "1453", "reason": "wrong amount" }] },
  "paidElsewhere": { "<bookingId>": { "eventId": "…", "eventDate": "2026-09-18", "paymentId": "…" } },
  "summary": { /* as below */ },
  "treasurerReportGeneratedAt": "2026-09-19T20:14:00Z" }
```

`settledByBooking` and `reconciliation` remain for existing readers.

### `GET /api/events/{id}/payment-summary` — new, `base`

```json
{ "booked": 350, "paid": 270, "stillToPay": 100, "stillToPayCount": 2, "difference": 20,
  "earlierPaidHere": 60,
  "performerCash": [{ "paymentId": "…", "payee": "Sam Sound", "amount": 60 }] }
```

## Performers and bookings

### `GET /api/events/{id}/roles` — new, `base`

`{ "roles": [{ "performerType": "caller", "rate": 120 }, …] }` — only the series' allowed roles;
instructor and open-band musician at 0.

### `GET /api/performers?q=…&eventId=…` — changed

Each item gains `bookedAs: "musician" | null` when `eventId` is given.

### `POST /api/events/{id}/settlement-performer` — changed

`{ "performerId": "…", "performerType": "instructor", "pay": 50 }` — `pay` optional (standard rate
when absent). 201 with the booking. `ALREADY_BOOKED` when the performer is already on the event.

### `POST /api/bookings/{id}/substitute` — behaviour changed

Same request. The substitute's booking carries the replaced booking's booked amount on both paths.

### `GET /api/performers/{id}/unpaid-bookings?forEvent={eventId}` — new, `performer_payment.write`

`{ "bookings": [{ "bookingId": "…", "eventId": "…", "eventDate": "2026-09-04", "performerType":
"musician", "booked": 120 }] }` — events in the 90 days before `forEvent`, with a booked amount, not
donated, not declined, no live line, within the actor's payment scope; newest first.

### `POST /api/performers` — unchanged

Used by the dialogs with `{ contactId }` or `{ firstName, lastName?, email? }` (X-P1).

## Gate

### `GET /api/events/{id}/door-record` / `POST` open — changed

`doorRecord` gains `performerCash` (as in the summary) and `deposit` now reflects it. `cashPaidOut`
is the **other** cash paid out.

### `PATCH /api/door-records/{id}` — behaviour changed

The returned `deposit` subtracts the performers' cash too.

## Treasurer report

### `GET /api/events/{id}/treasurer-report` — changed

Adds:

```json
{ "checks": [{ "checkNumber": "1450", "payee": "…", "amount": 100, "class": "…",
               "voided": false, "voidReason": null, "replacedBy": null, "note": "agreed $100",
               "lines": [{ "performer": "…", "booked": 120, "paid": 100, "eventDate": null }] }],
  "cashPayments": [{ "payee": "…", "amount": 60, "note": null, "lines": [ /* as above */ ] }],
  "otherCashPaidOut": { "amount": 20, "reason": "ice" },
  "paidElsewhere": [{ "performer": "…", "amount": 120, "eventDate": "2026-09-18" }] }
```

`checks` is sorted by number: the digits as a number, then the letter (1500, 1500A, 1501). A line's
`eventDate` is set only when its booking is at another event. `booked` and `note` are shown by the
page only when a line's paid amount differs from its booked amount.

## Page contract (`/payments`)

| Element | Contract |
|---|---|
| Top | `EventConfirm` (as `/checkin`: "{series} · {label} · {date} · {h:mm AM/PM}"), then `PaymentSummaryView`: "Booked $X · Paid $Y · Still to pay $Z (N)" or "… · All paid"; "Difference ±$D" line only when ≠ 0; "Earlier bookings paid tonight $E" only when > 0 |
| Order | caller, lead musician, musician, sound tech, instructor, open-band musician; by name |
| To-pay row | name, role, booked amount; a check-number field; **Cash** option; amount (blank = booked); a notes box that appears only when the amount differs; **Record** |
| Free row | name, role, "free"; **Pay** reveals the same controls; **Donated** as today on a to-pay row |
| Paid row | "Check #N $A" or "Cash $A" — for a check paying several bookings, "Check #N $A · check total $T" on each of its rows; the note only if written, then any quiet voided lines, then **Edit**, **Void** (checks only), **Delete** |
| Reminder | "Void: the check was written. Delete: it was never written." once, above the list, only for those who may record payments |
| Paid elsewhere | "Paid at {date}" |
| Voided | quiet line "Voided #N — {reason}" under each booking it settled, directly under the payment line and note |
| Actions | **Add a performer**, **Substitute a performer**, **One check, several performers**, **Pay an earlier booking** |
| Earlier bookings paid here | a separate short list with each booking's event date |
| Number taken | dialog: "Check #N is already used (payee, date)." — **Add this booking to check #N** (only live, same event) · **Change the number**, with the hint "From a duplicate check book? Add a letter, e.g. 1500A." |
| Second payment | dialog: "{payee} already has check #N / cash $A tonight. Pay again?" — **Pay again** · **Cancel** |
| Delete | "This erases check #N as never written. If you wrote it, void it instead." — **Delete** · **Void** · Cancel; for cash "This erases the cash payment of $A to {payee}."; plus "The treasurer report for this event has been generated. It may already be in the ledger." when it was generated after the event's day (the device's local date) |
| Void | names the check, lists its bookings, reason required |
| Unmatched online payments | absent |

## Page contract (`/gate`) — additions only

| Element | Contract |
|---|---|
| Top | `PaymentSummaryView` for the event, under the attendance breakdown |
| Cash paid out | read-only "Paid to performers in cash: {payee} $A, …" line; the editable field is labelled "Other cash paid out" |
