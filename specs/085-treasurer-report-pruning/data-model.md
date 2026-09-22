# Data model: the gate report answers with what it shows

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Migration 0057 — drop `series_qbo_map`

```sql
DROP TABLE IF EXISTS series_qbo_map;
```

The sequel to migration `0032`, which dropped this table's sibling and recorded that `series_qbo_map` was
unaffected "because the report keeps its class/customer columns" — the sentence this feature falsifies.
Its four live rows and two audit entries are written out in [research.md](./research.md) R3 before they go
(FR-010).

`mapping_audit` goes with it: it is the change history of a table that will no longer exist. Nothing else
writes to it.

No other schema change. The report reads the same tables it always did — it simply stops reading some.

## The report's shape

### Kept — the ten parts the page shows

| Part | What the Treasurer reads |
|---|---|
| `header` | the evening: date and time, label or series, venue, band or musicians, caller, sound tech |
| `attendance` | who came, the same breakdown the door and the gate page show |
| `recordedBy` | who saved the money, and who recorded the payments |
| `receipts` | every sale line with its note, admission as worked out, and the totals |
| `expenses` | each payment with its role, check number and notes; other cash paid out; the totals; rent, unpaid |
| `card` | gross, transactions, fee |
| `deposits` | the main deposit with its make-up, and each check banked on its own |
| `eveningNote` | the freehand note of the paper report |
| `paidElsewhere` | this evening's bookings paid at another |
| `paidTonightForEarlier` | another evening's bookings paid at this one |

### Added — the eleventh, inside `expenses`

| Part | What it answers |
|---|---|
| `expenses.reconciliation` | **did we pay everyone?** — what the evening's bookings came to, what was paid, and what is outstanding (FR-008) |

Already computed today as `performerReconciliation`; it moves inside `expenses`, where the page shows it.

### Removed — the fourteen nobody shows

| Part | What it was answering | Who answers now |
|---|---|---|
| `event` | id, date, series key | `header` |
| `gateSalesSummary` | the QuickBooks-shaped table: category × cash/card/check, with class and customer | `receipts.lines` |
| `namedCustomerReceipts` | named sales grouped by buyer and category | `receipts.lines` — each sale on its own line, with its buyer |
| `checksReceived` | each check as a receipt to its writer | `receipts.lines` — a check's lines under its payer |
| `bills` | rent as a QuickBooks bill | `expenses.rent` |
| `performerPayments` | live checks, QBO-shaped | `expenses.payments` |
| `voidedPerformerPayments` | voided checks, listed apart | `expenses.payments`, marked `voided` and out of the totals |
| `checks` | every check in number order, with allocation lines | `expenses.payments` |
| `cashPayments` | cash paid to performers | `expenses.payments`, marked `cash` |
| `otherCashPaidOut` | the gate's other cash payouts | `expenses.otherPaidOut` |
| `deposit` | one deposit figure | `deposits` — one per slip, with its make-up |
| `fees` | door fee, online fee, total | `card.fee` (the online fee has been 0 since feature 007 was deferred) |
| `compCount` | free admissions | `attendance.comps` |
| `giftCardRedemptionCount` | gift cards redeemed | `attendance.giftCards` |

The QuickBooks **class** and **customer** that `gateSalesSummary`, `namedCustomerReceipts`,
`checksReceived`, `bills` and `performerPayments` each carried are not re-homed. Feature 082 took them off
the page deliberately; this takes them out of the answer.

## What goes with them

- **Queries and helpers that fed only a removed part** (FR-006) — the named-customer grouping, the
  gate-sales category sums, the QBO mapping lookup. The report should do no work whose result nobody sees.
- **The mapping's own machinery**: its page, its API route, its service, its validation schema, its seed,
  and its menu entry.

## What must not change

Every figure the page shows (SC-002). The same evening, fetched before and after, reads identically —
which is what the quickstart's manual pass exists to prove, and why the rewritten tests assert the same
numbers they always did.
