# Quickstart: the gate report answers with what it shows

**Feature**: 085-treasurer-report-pruning | **Spec**: [spec.md](./spec.md) | **Contract**:
[contracts/report.md](./contracts/report.md)

## Prerequisites

- **Nothing running against the development database** while migrating or running the suite.
- A sign-in that can open `/treasurer` — any volunteer can read it.
- An evening with something on it: sales, a check received, a performer payment, a deposit, and a venue
  with rent. The Gatecheck evenings from feature 082 will do, or any real evening.

## Before you change anything — take the baseline

This feature's whole safety property is that **no figure moves** (SC-002). That cannot be checked
afterwards from memory:

```bash
curl -s "http://localhost:3000/api/events/<EVENT_ID>/treasurer-report" > /tmp/report-before.json
```

Take it for two evenings — one busy, one bare — and keep both. Print the page, or screenshot it, for the
same two.

## Automated gates

```bash
pnpm db:migrate
pnpm tsc --noEmit
pnpm vitest run
pnpm build
pnpm lint:md
```

Plus `pnpm exec eslint` and `pnpm exec prettier --check` on the changed files only.

## Manual pass

### 1. The same evening, unchanged (US1, SC-002)

1. Fetch the same evening again and compare against the baseline:

   ```bash
   curl -s "http://localhost:3000/api/events/<EVENT_ID>/treasurer-report" > /tmp/report-after.json
   diff <(jq -S 'del(.event,.gateSalesSummary,.namedCustomerReceipts,.checksReceived,.bills,.performerPayments,.voidedPerformerPayments,.checks,.cashPayments,.otherCashPaidOut,.deposit,.fees,.compCount,.giftCardRedemptionCount,.performerReconciliation)' /tmp/report-before.json) <(jq -S 'del(.expenses.reconciliation)' /tmp/report-after.json)
   ```

   *Expect*: **no output**. Every part the page shows is byte-identical; the only differences are the
   parts that were removed and the reconciliation that moved.
2. Open `/treasurer` for that evening. *Expect*: every figure reads as it did in your printout — receipts,
   admission, totals, expenses, deposits, card, notes.
3. Repeat for the bare evening. *Expect*: the same, and the same "None" wording where a part is empty.

### 2. The reconciliation (US1, FR-008)

1. Find or make an evening where a performer was booked and never paid.
2. Open `/treasurer`. *Expect*: under the expenses, one line — booked, paid, and what is outstanding —
   with the outstanding figure matching the unpaid booking.
3. Pay that performer, reload. *Expect*: outstanding falls to `$0.00`, and the line is still shown.

### 3. The QuickBooks mapping is gone (US3)

1. *Expect*: the volunteer menu offers no **QBO mapping**.
2. Open `/qbo-mapping` directly. *Expect*: not found.
3. *Expect*: nowhere on the report — page or payload — mentions a class or a customer.
4. The four mappings the club had recorded are in [research.md](./research.md) R3, should anyone ask what
   they were.

### 4. Nothing else moved (US2)

1. Open the organizer report and the gate page for the same evening. *Expect*: unchanged — this feature
   touched the treasurer report alone.
2. Print the treasurer report. *Expect*: landscape letter, two columns, exactly as feature 082 left it,
   with the reconciliation line among the expenses.

## Cleanup

Nothing to undo. Delete the baseline files when you are satisfied:

```bash
rm /tmp/report-before.json /tmp/report-after.json
```
