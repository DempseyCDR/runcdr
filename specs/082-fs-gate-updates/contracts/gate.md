# Contract: the gate evening and the gate report

Money in and out is in dollars; storage is cents. Errors use the existing envelope `{ error: { code,
message, details? } }`.

*Revised 2026-09-18 after the P1 review (research R16–R19): every sale is its own line, one dialog
records a sale or a check, "How many?" is optional, and the report is laid out as the paper one.*

## New error codes

| Code | Status | When |
|---|---|---|
| `CHECK_NEEDS_LINES` | 422 | A check with no lines, or its last line removed by a patch |
| `ADMISSION_NEEDS_CHECK` | 422 | An `admission` line sent outside a check |
| `NOT_YOUR_ENTRY` | 403 | Correcting or removing someone else's sale or check without `gate.write` |

## Sales — every one its own line (R16)

### `POST /api/door-records/{id}/sales` — new

`attendance.write` **or** `gate.write` in the event's scope (research R6).

```json
{ "category": "merchandise", "paymentMethod": "cash", "amount": 75, "quantity": 3,
  "note": "T-shirts, 2 M and 1 L" }
```

- Categories: `donation`, `future_event`, `membership` — `contactId` required — or `merchandise`,
  `gift_card`, `misc_sales`, where `contactId` is optional. `admission` is accepted by the schema
  and refused by the service with `ADMISSION_NEEDS_CHECK`: admission in cash and by card is worked
  out, never entered.
- `membershipLevel` required for `membership`, refused elsewhere (080).
- `quantity` optional, a whole number above zero (R17).
- 201 → the sale view (below), with `enrolled` when a membership was created or renewed.

### `PATCH /api/gate-sales/{id}` — new

Any of `amount`, `paymentMethod`, `contactId`, `membershipLevel`, `note`, `quantity`. `gate.write`,
or `attendance.write` when the caller recorded it (`NOT_YOUR_ENTRY` otherwise). 200 → the sale view.

### `DELETE /api/gate-sales/{id}` — new

Same authority as PATCH. 204. Removing a check's last line removes the check.

### `PUT /api/door-records/{id}/gate-sales` — retired

The gate's Save no longer carries sales (R16). The route is removed.

### Sale view

```json
{ "id": "…", "category": "membership", "paymentMethod": "cash", "amount": 40, "contactId": "…",
  "contactName": "Ann Able", "membershipLevel": "family", "note": "Ann and Bo", "quantity": null,
  "checkId": null, "recordedBy": { "contactId": "…", "displayName": "Meg Door" } }
```

## Checks received

### `POST /api/door-records/{id}/checks` — new

`attendance.write` or `gate.write`.

```json
{ "writerContactId": "…", "note": "covers Jo too", "depositSeparately": false,
  "lines": [ { "category": "admission", "amount": 30, "quantity": 2 },
             { "category": "merchandise", "amount": 25, "note": "T-shirt, L" },
             { "category": "donation", "amount": 40, "contactId": "…" } ] }
```

- `writerContactId` is the **payer**, shown so on every page.
- `depositSeparately` requires `gate.write`: a request that would **set** it on a new check or
  **change** it on an existing one is **refused 403**, never silently ignored. Sending the value a
  check already has is not a refusal. The door's dialog does not offer the tick, so this answers
  only a malformed or stale client.
- Lines follow the sale rules; `admission` is allowed here, its `quantity` ("How many?") optional;
  at least one line.
- 201 → the check view, with `enrolled` for any membership line.

### `PATCH /api/gate-checks/{id}` — new

Any of `writerContactId`, `note`, `depositSeparately`, `lines` (replacing the check's lines).
Authority as for a sale patch; `depositSeparately` needs `gate.write`. 200 → the check view.

### `DELETE /api/gate-checks/{id}` — new

Removes the check and its lines. Authority as for a sale patch. 204.

### Check view

```json
{ "id": "…", "writerContactId": "…", "writer": "Jo Payer", "amount": 95, "note": "covers Jo too",
  "depositSeparately": false, "recordedBy": { "contactId": "…", "displayName": "Mary FS" },
  "lines": [ /* sale views, each with checkId set */ ] }
```

## The evening's money

### `PATCH /api/door-records/{id}` — changed, `gate.write`

The gate's Save: the money figures, the door's counts and the evening's note — no sales (R16).

Adds `eveningNote` (string, nullable; blank clears it) and `cashCount` (`{ "100": 3, …, "coins":
4.35 }` or `{}`). Saving the money **clears** `cashCount` unless the request sets it, and records
the caller as the money recorder. A request carrying **only** `cashCount` is the count in progress:
it sets the count and nothing else — no recorder, no audit row. `cashPaidOutReason` takes `null` to
clear a reason saved earlier. Cash paid out with no reason is saved and warned about, never refused
(migration 0054).

Response gains:

```json
{ "admission": { "cash": 420, "card": 180, "check": 30, "total": 630 },
  "checksTotal": 95, "cardFee": 4.21,
  "deposits": [ { "kind": "main", "amount": 512.35,
                  "makeUp": { "countedCash": 500, "seedFloat": 15, "otherPaidOut": 20,
                              "performerCash": 60, "checks": 67.35 } },
                { "kind": "check", "checkId": "…", "writer": "Big Donor", "amount": 500 } ],
  "warnings": [ { "code": "NEGATIVE_ADMISSION", "message": "…" } ],
  "eveningNote": "…", "cashCount": {},
  "moneyRecordedBy": { "contactId": "…", "displayName": "Mary FS" } }
```

Warning codes: `NEGATIVE_ADMISSION`, `PAYOUT_WITHOUT_REASON`, `CARD_GROSS_WITHOUT_COUNT`. Warnings
never fail the save (FR-007).

### `GET`/`POST /api/events/{id}/door-record` — changed

`doorRecord` gains everything the PATCH response adds; the payload gains `checks` (check views)
beside `gateSales`, which holds every sale that is not a check's line — anonymous and named.
`cardFee` is present **only** for a caller who may record gate money in the event's scope: the door
opens this payload too, to post a sale, and never sees the fee (feature 002 FR-007).

### `GET /api/me/capabilities` — changed

Gains `contactId` (who is asking, so a page can tell the viewer's own entries), `gateWrite` and
`attendanceWrite`.

## The gate report

### `GET /api/events/{id}/treasurer-report` — changed

Keeps its fields and adds:

```json
{ "header": { "date": "2026-09-18", "startTime": "19:30:00", "title": "Gatecheck Test",
              "venue": "Faith Lutheran", "band": "The Trio", "musicians": [],
              "caller": "Cal Caller", "soundTech": "Sam Sound" },
  "receipts": {
    "lines": [ { "category": "merchandise", "quantity": 3, "level": null, "members": [], "name": null,
                 "for": null, "cash": 75, "check": 0, "card": 0, "notes": [ "T-shirts" ] },
               { "category": "admission", "quantity": 2, "level": null, "members": [],
                 "name": "Chuck Writer",
                 "for": null, "cash": 0, "check": 30, "card": 0, "notes": [] } ],
    "admission": { "cash": 420, "card": 180 },
    "totals": { "cash": 495, "check": 30, "card": 180, "total": 705 } },
  "expenses": {
    "payments": [ { "role": "caller", "payee": "Cal Caller", "checkNumber": "1501", "cash": false,
                    "amount": 150, "voided": false,
                    "notes": [ "booked $175.00 · paid $150.00 — left early" ] } ],
    "otherPaidOut": { "amount": 20, "reason": "ice" },
    "totals": { "check": 150, "cash": 20, "total": 170 },
    "rent": { "vendor": "Faith Lutheran Church", "amount": 250, "unpaid": true } },
  "card": { "gross": 180, "transactions": 9, "fee": 4.21 },
  "paidTonightForEarlier": [ { "performer": "Eve Later", "amount": 90,
                               "eventDate": "2026-09-10" } ],
  "checksReceived": [ … ], "deposits": [ … ], "eveningNote": "…",
  "recordedBy": { "gateMoney": "Mary FS", "performerPayments": "Mary FS" } }
```

- `receipts.lines`: every sale line — a check's lines included, with the payer as `name` and `for`
  when the line is someone else's — each in its cash, check or card column. `notes` are the line's own
  note and, after a check's last line, the note on the check. `members` on a membership line names who
  else the payer's account covers, read from the account rather than stored on the sale — so it is who
  it covers now. `receipts.admission` is admission in cash and by card as worked out; admission paid by
  check is among the lines.
- `expenses.payments`: live and voided, in check-number order then cash; a voided payment carries
  its reason as a note and is out of the totals. A check's further bookings and a booked-versus-paid
  difference are notes. `rent` is out of the totals.
- Bookings paid at another evening, for the notes: `paidElsewhere` (tonight's bookings paid at
  another evening, as 081) and `paidTonightForEarlier` (earlier evenings' bookings paid tonight).
- `header.band` is the booked band's name; when there is none, `header.musicians` lists the booked
  musicians' last names, the lead first.

## Page contracts

### The shared dialog — **Add a sale**

| Element | Contract |
|---|---|
| Paid by | **Cash**, **Check** or **Card**; fixed once recorded |
| Payer | Found or added as a new contact; required for a check and for membership, donation and future event |
| Lines | Cash and card: one line. Check: several, with **Add a line** |
| Line | What it pays for · Quantity ("How many?") · Amount · Level (membership) · Members (membership: the payer always, plus any added with **Add a member**) · For (donation and future event, default the payer) · Line note |
| Admission | Offered only when **Check** is chosen |
| Check extras | Note on the check; **Deposit separately** (whoever may record gate money only) |

### `/gate`

| Element | Contract |
|---|---|
| Top | `EventConfirm`, then the performer-pay summary (081) and the evening's money: admission (cash / card / check), card fee, checks total, **deposit** — all above the fold |
| Sections, in order | Door counts · Cash · Card · Sales · Checks |
| Door counts | Comps and gift cards editable beside "the door recorded N"; open band read-only |
| Cash | Gross cash (bills and coins) with **Count**, the cash box seed, other cash paid out and its reason; performers' cash line (081) |
| Live figures | Admission, card fee, checks total and deposit update as Mary types |
| Save | Writes the money figures, the door's counts and the evening's note; then shows the server's warnings |
| Unsaved work | Changing the event or leaving the page warns first |
| Counting dialog | Bill faces $100–$1 and coins, on-screen keypad with delete and next/previous, running total, **Use as gross cash**; no checks; the count survives a reload and is cleared by Save |
| Sales | Every sale that is not a check's line — quantity, category, name if any, amount, how it was paid, note, who recorded it; **Add a sale** opens the shared dialog; Edit / Remove save on their own |
| Checks | Each with its payer, amount, lines, note, **deposit separately**, and who recorded it; Edit / Remove save on their own |
| Deposits | The main deposit and each separately deposited check, with what makes them up |
| Evening note | One free-text box, saved with the money |

### `/checkin` — addition only

| Element | Contract |
|---|---|
| Action | **Add a sale** opens the shared dialog; a sale or check is saved as soon as it is recorded |
| Own entries | **Your sales and checks tonight** lists the sales and checks the viewer recorded, each with Edit |
| Scope | The door may add, and correct what it recorded; it never sees or changes the evening's money figures |

### `/treasurer` — the gate report

| Element | Contract |
|---|---|
| Header | Line 1: date and time · label or series · venue · band, or musicians' last names (lead first) · caller · sound tech. Line 2: recorded by · attendance breakdown and total |
| Left column | **Receipts**: qty, name, cash, check, card per line, a note directly beneath; then admission; then total receipts. Then **Deposits** and the card gross, transactions and fee |
| Right column | **Expenses**: role, name, check # or "cash", amount per payment; voided checks with their reason; further bookings and booked-versus-paid as notes beneath; other cash paid out; totals; rent marked unpaid, out of the totals. Then **Notes**: the evening's note and bookings paid at another evening |
| Not shown | The QuickBooks class and customer; page headers and footers |
| Print | Landscape letter (`@page`), the report region only, no section split across two sheets |
| Empty | Each empty part says so ("None") — never an empty table |
| Phone (nice to have) | The columns stack; smaller type; no sideways scrolling at 844 × 390 |
