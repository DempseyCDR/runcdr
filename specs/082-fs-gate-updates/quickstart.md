# Quickstart: The gate evening, and the report the Treasurer reads

**Feature**: 082-fs-gate-updates | **Spec**: [spec.md](./spec.md) | **Contract**:
[contracts/gate.md](./contracts/gate.md)

## Prerequisites

- **Nothing running against the development database** while migrating or running the suite.
- Sign-ins for a **door attendant** (Meg), a **Financial Secretary** (Mary) and a **Treasurer** — or
  the super-user for all three, plus one door-attendant sign-in to prove what the door may not do.

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

Use a medium phone for §1–§4 — 390 × 844 in the browser's device mode — and a laptop for §5.

Setup: a throwaway **Thursday Night Contra** event **Gatecheck Test** today, with a caller booked
and paid so the performer-pay summary has something in it. Throwaway contacts **Chuck Writer** and
**Dee Member**; leave **Newt Payer** *not* created, to be added while recording a check.

### 1. The evening's money on a phone (US1)

1. Open `/gate`, choose Gatecheck Test. *Expect*: the event confirmed as "Thursday Night Contra · …
   · 7:30 PM"; no sideways scrolling; the sections in order — summary, Door counts, Cash, Card,
   Sales, Checks — and the deposit visible without scrolling.
2. Enter gross cash **500**, cash box seed **15**, other cash paid out **20** with reason "ice", card
   gross **180** and card transactions **9**. *Expect*: admission, the card fee, the checks total and
   the deposit all change as you type.
3. **Add a sale**: merchandise, cash, $25, **How many?** 3, noted "T-shirts", no payer. *Expect*: it
   is listed under Sales at once, and admission by cash drops by $25. Save the money. *Expect*: the
   T-shirts are still listed — the Save sends no sales.
4. Clear the payout reason and save. *Expect*: a warning that cash was paid out with no reason; the
   save still went through. Put the reason back, save again. *Expect*: no warnings.
5. Enter card gross with the transaction count cleared, save. *Expect*: the card-gross-without-count
   warning. Restore the count.
6. Change the event without saving a change. *Expect*: a warning first.

### 2. Counting the cash (US2)

1. In Cash, tap **Count**. *Expect*: $100 to $1 and coins, an on-screen keypad with a delete key,
   and no place for checks.
2. Key 2 × $100, 4 × $20, 6 × $5, coins 4.35. *Expect*: a running total of $314.35.
3. Close the dialog, reload the page, reopen it. *Expect*: the counts are still there.
4. **Use as gross cash**. *Expect*: gross cash 314.35 and the dialog closed. Save the money, reopen
   the dialog. *Expect*: it is empty.

### 3. Checks received (US3)

1. **Add a sale**, choose **Check**. *Expect*: Admission is now offered. Payer **Chuck Writer**: an
   admission line $30, **How many?** 2, a merchandise line $25 noted "T-shirt, L", and a donation
   line $40 for **Dee Member** noted "for the sound fund". *Expect*: the check totals $95; the checks
   total and admission-by-check follow; gross cash is unchanged.
2. **Add a sale** by check for **Newt Payer**, who is not a contact yet. *Expect*: the dialog creates
   the contact first, then records the check.
3. Give Newt's check a membership line at **family**, and **Add a member** twice: Dee Member and
   Chuck Writer. *Expect*: the line reads "Members: Newt Payer, Dee Member, Chuck Writer"; Newt's
   membership is opened or renewed with all three as members — check Newt's record. At
   **individual**, adding a member is refused, saying the level covers the payer alone.
4. Try a check with no lines. *Expect*: refused, saying why. An admission line with no **How many?**
   is recorded — the count is optional.
5. Add a third check for $500 and tick **deposit separately**. *Expect*: the deposits list shows the
   main deposit and a $500 deposit of its own, each with what makes it up.
6. Remove a line from Chuck's check and save the evening's money. *Expect*: the change stuck and no
   check or sale was lost.

### 4. The shared dialog, at the door (US4)

1. Sign in as the **door attendant**, open `/checkin`, and **Add a sale**: payer Dee Member, a
   membership at **individual**, cash, noted "renewed at the door". *Expect*: it is saved at once.
2. **Add a sale** of merchandise with no payer, then one by **Check**. *Expect*: the same dialog,
   without the deposit-separately tick; **Your sales and checks tonight** lists all three.
3. *Expect*: the door sees no cash, card or deposit figures, and cannot open `/gate`'s Save.
4. Back as Mary on `/gate`: *expect* both of the door's entries listed with their notes and
   "recorded by" the door attendant. Correct the note on one. Save the evening's money. *Expect*:
   nothing the door recorded is lost.

### 5. The gate report (US5, US6)

On a **laptop**:

1. Open `/treasurer` for Gatecheck Test. *Expect*: a heading — the date and time, the label,
   venue, band (or the musicians' last names, lead first), caller and sound tech; then who recorded
   it and the attendance with its total.
2. *Expect*, on the left: **Receipts** — qty, name, cash, check, card — every sale and each check's
   lines under its payer, each note directly beneath its line; admission; the totals. Then
   **Deposits** and the card's gross, transactions and fee.
3. *Expect*, on the right: **Expenses** — role, name, check # or "cash", amount — a voided check
   with its reason, a check's further bookings and booked-versus-paid as notes beneath it; other cash
   paid out; the totals; the rent marked **unpaid**, outside the totals. Then **Notes**: the evening's
   note and bookings paid at another evening. No QuickBooks class or customer anywhere.
4. Print it (or use the browser's print preview). *Expect*: landscape letter, the two columns side
   by side, the report only — no site or volunteer navigation — and no cut-off columns.
5. Open an evening with no payments. *Expect*: "None" under Expenses rather than an empty table.
6. *(Nice to have)* Open the report at 844 × 390. *Expect*: the columns stack, with smaller type.

### 6. Paying confirms the booking (US5 of the spec)

1. On the bookings report, set a musician's booking on Gatecheck Test to **requested**.
2. On `/payments`, pay that booking. *Expect*: the booking now reads **confirmed**.
3. Void that payment. *Expect*: the booking stays confirmed.

## Cleanup

```sql
BEGIN;
DELETE FROM events WHERE label = 'Gatecheck Test';
DELETE FROM membership_accounts
  WHERE payer_contact_id IN (SELECT id FROM contacts WHERE display_name IN ('Chuck Writer', 'Dee Member', 'Newt Payer'));
DELETE FROM contacts WHERE display_name IN ('Chuck Writer', 'Dee Member', 'Newt Payer');
COMMIT;
```
