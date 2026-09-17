# Quickstart: Performer payments, rebuilt for Mary

**Feature**: 081-payments-page-update | **Spec**: [spec.md](./spec.md) | **Contract**:
[contracts/payments.md](./contracts/payments.md)

## Prerequisites

- **Nothing running against the development database** while migrating or running the suite.
- Sign-ins for a **Financial Secretary** and a **Treasurer**, or the super-user for both.

### Before migrating: clear duplicate check numbers

Migration 0051 stops if a check number is used twice or is not digits with an optional letter, or if
a booking is settled by two live payments ([data-model.md](./data-model.md)). List them:

```sql
SELECT upper(btrim(check_number)) AS number, count(*), array_agg(id) AS payment_ids
FROM performer_payments WHERE check_number IS NOT NULL
GROUP BY upper(btrim(check_number)) HAVING count(*) > 1;

SELECT id, check_number FROM performer_payments
WHERE check_number IS NOT NULL AND upper(btrim(check_number)) !~ '^[0-9]+[A-Z]?$';

SELECT pb.booking_id, array_agg(p.id) AS payment_ids
FROM payment_bookings pb JOIN performer_payments p ON p.id = pb.payment_id
WHERE p.voided_at IS NULL
GROUP BY pb.booking_id HAVING count(*) > 1;
```

For each duplicate, keep one payment and delete the others (their lines go with them), after
checking which is right — or reset the development database with `pnpm db:seed`, which wipes it (see
the demo-database notes before doing that).

```sql
DELETE FROM performer_payments WHERE id IN ('…', '…');
```

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

On a medium phone — 390 × 844 in the browser's device mode — unless noted.

Setup: two throwaway **Thursday Night Contra** events, **Paycheck Early** (about three weeks ago)
and **Paycheck Test** (today), each with a door record. Throwaway performers **Payee Caller**,
**Payee Fiddle** and **Payee Piano**, each linked to a contact. On Paycheck Test book Payee Caller
(caller **and** sound tech), Payee Fiddle (musician), Payee Piano (musician) and any existing
performer as instructor. On Paycheck Early book Payee Fiddle (musician) and leave it unpaid. Use
check numbers from **9001** upward, which nothing else uses.

### 1. The page on a phone (US1)

1. Open `/payments`, choose Paycheck Test. *Expect*: the event large with date, series and time,
   **Change**, no not-today warning; the summary "Booked … · Paid $0 · Still to pay … (4)"; rows in
   the order caller, musicians by name, sound tech, instructor; no sideways scrolling; no
   unmatched-online-payments section (US8).
2. Pay Payee Caller with check **9001**, amount left blank. *Expect*: "Check #9001" at the booked
   amount; the summary updates; no note label.
3. On Payee Fiddle, change the amount to $10 less. *Expect*: a notes box appears. Write "left early"
   and record with **9002**. *Expect*: the note shows; the summary gains "Difference −$10".
4. On the instructor, tap **Pay**, enter $25, choose **Cash**, record. *Expect*: "Cash $25".
5. Open `/gate` for Paycheck Test. *Expect*: the same summary at the top; "Paid to performers in
   cash: {instructor} $25"; the editable field reads "Other cash paid out". Enter gross cash 300,
   seed float 15, save. *Expect*: deposit $260 (300 − 15 − 25).

### 2. One check per booking, one number per check (US2)

1. On Payee Piano, enter check **9001**. *Expect*: "Check #9001 is already used" with **Add this
   booking to check #9001** and **Change the number**. Choose Add. *Expect*: check #9001 now settles
   both — each of the two rows shows its own amount and "check total $…". On a full keyboard, also
   try **9001a** on another row: *Expect*: a new check "#9001A" (delete it afterwards); and
   **#9001**: *Expect*: refused as not digits with an optional letter. (A phone's number keypad has
   no letters; that is by design.)
2. Open **One check, several performers**. *Expect*: no cash option; a number is required.
3. On Payee Caller's **sound tech** row, record check **9099**. *Expect*: "Payee Caller already has
   check #9001 tonight. Pay again?"; **Cancel** — nothing is recorded. The several-performers
   dialog, where Payee Caller is listed because the sound-tech booking is unpaid, asks the same way.

### 3. Correct, delete, void (US3)

1. On either row check #9001 pays, choose **Edit**; the dialog lists every booking the check pays.
   Remove Payee Piano's line. *Expect*: the total drops; Payee Piano is to pay again.
2. Pay Payee Piano with **9003**, then **Delete** it. *Expect*: the explanation under the buttons;
   the confirmation "This erases check #9003 as never written. If you wrote it, void it instead."
   with Delete and Void; delete it. *Expect*: Payee Piano is to pay again.
3. Pay Payee Piano with **9004**, then **Void** it with reason "wrong amount". *Expect*: the
   confirmation lists the booking; afterwards "Voided #9004 — wrong amount" under the row. Try
   voiding again — the action is gone.
4. Pay Payee Piano with **9005**. *Expect*: the voided line stays; the new check replaces #9004
   (shown on the treasurer report, §5).
5. Delete the instructor's cash payment. *Expect*: "This erases the cash payment of $25 to …"; on
   `/gate` the performers' cash line is gone and the deposit is $285.

### 4. Add, substitute, earlier booking (US4, US5, US7)

1. **Add a performer**: search "Payee". *Expect*: the three marked "already booked as …". Create a
   new performer **Payee Banjo** (new contact) and add as instructor at $40. *Expect*: a to-pay row
   at $40.
2. **Substitute a performer**: replace Payee Banjo with a new performer **Payee Guitar**. *Expect*:
   the dialog shows $40 and no amount field; Payee Guitar's row is at $40.
3. **Pay an earlier booking**: find Payee Fiddle. *Expect*: Paycheck Early's booking with its date,
   role and amount. Pay it in cash. *Expect*: the second-payment question (Payee Fiddle already has
   #9002 tonight) — choose **Pay again**; then a separate "earlier bookings paid tonight" line; the
   summary's "Earlier bookings paid tonight $…"; on `/gate`, the performers' cash line includes it.
   Open Paycheck Early: *Expect*: "Paid at {today}" and **All paid**.

### 5. Treasurer report (US6)

Generate the report for Paycheck Test. *Expect*: checks #9001, #9002, #9004 (voided — "wrong
amount", replaced by #9005) and #9005 in number order; #9002 shows booked and paid and "left early";
the cash payment to Payee Fiddle under cash paid out, naming Paycheck Early. Then delete check #9005
on `/payments`: *Expect*: no treasurer-report warning, since the report was generated on the event's
own day; cancel. (The warning — "It may already be in the ledger." — appears only for a report
generated after the event's day.)

## Cleanup

```sql
BEGIN;
DELETE FROM events WHERE label IN ('Paycheck Test', 'Paycheck Early');
DELETE FROM performer_payments WHERE payee_performer_id IN
  (SELECT id FROM performers WHERE display_name LIKE 'Payee %');
DELETE FROM performers WHERE display_name LIKE 'Payee %';
DELETE FROM contacts WHERE display_name LIKE 'Payee %';
COMMIT;
```
