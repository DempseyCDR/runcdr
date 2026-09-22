# Contract: the gate report, after the pruning

**Feature**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md)

## `GET /api/events/{id}/treasurer-report` — narrowed

| Aspect | Contract |
|---|---|
| Requires | `base`, unchanged |
| Answers with | `header`, `attendance`, `recordedBy`, `receipts`, `expenses`, `card`, `deposits`, `eveningNote`, `paidElsewhere`, `paidTonightForEarlier` — **and nothing else** |
| `expenses` gains | `reconciliation: { booked, paid, outstanding }` — what the evening's bookings came to, what was paid, and the difference (FR-008) |
| No longer answers with | `event`, `gateSalesSummary`, `namedCustomerReceipts`, `checksReceived`, `bills`, `performerPayments`, `voidedPerformerPayments`, `checks`, `cashPayments`, `otherCashPaidOut`, `deposit`, `fees`, `compCount`, `giftCardRedemptionCount` |
| QuickBooks | No part carries a class or a customer. Nothing in the answer refers to QuickBooks |
| Figures | **Identical** to before for the same evening (SC-002) |
| An evening with no door record | Still 404, unchanged |
| An evening recorded before feature 082 | Still answers: no evening note, no recorded-by, no cash count |

## Routes removed

| Route | Contract |
|---|---|
| `GET /api/qbo-mapping` | Gone with the mapping it read |
| `PUT /api/qbo-mapping/series` | Gone |

## `/treasurer` — one addition

| Element | Contract |
|---|---|
| Expenses | After the totals and the rent, one line: **"Booked $520.00 · paid $460.00 · outstanding $60.00"** |
| Outstanding zero | Still shown, reading `outstanding $0.00` — a zero is an answer, and the same rule the comp counts follow |
| Everything else | Unchanged. The layout, the figures, the print rules and the phone stacking are feature 082's |

## `/qbo-mapping` — removed

The page, its menu entry and its data. A volunteer who bookmarked it gets a 404; nothing in the app links
to it.

## What a test may rely on

- The report's answer has exactly the ten named parts, and `expenses.reconciliation` inside one of them.
- Asking the report type for a removed part does not compile.
- For an evening with sales, checks, payments, a deposit and a rent, **every figure equals what the same
  evening reported before this feature** — the assertion that protects SC-002.
- A booked-but-unpaid performer appears in `expenses.reconciliation` as outstanding, and the page shows it.
- `series_qbo_map` does not exist after migration 0057, and the migration re-runs without error.
- Nothing in `src/` refers to a QuickBooks class, customer or mapping.
