# Quickstart: Mobile door check-in

**Feature**: 079-mobile-door-checkin | **Spec**: [spec.md](./spec.md) | **Contract**: [contracts/door-checkin.md](./contracts/door-checkin.md)

How to prove the feature end to end. Automated gates first, then a manual pass on throwaway contacts and a
throwaway event.

## Prerequisites

- `runcdr_dev` migrated through `0050`.
- Sign-ins for a **door attendant** (Meg), a **treasurer** and a **Financial Secretary** — or the
  super-user for all three.
- Nothing else running against the dev database while the test suite runs.

## Automated gates

```bash
pnpm db:migrate
pnpm vitest run
pnpm tsc --noEmit
pnpm build
pnpm lint:md
```

Plus `pnpm exec eslint` and `pnpm exec prettier --check` on the changed files only.

## Manual pass

Use a medium phone for §1–§4 — 390 × 844 portrait in the browser's device mode, or a real phone such as a
base-model iPhone 12–16. In device mode, remember a real phone's browser bars hide roughly 100–180 points of
that height: the top region should fit in about 700.

Setup: create today's event **Doorcheck Test** in **Thursday Night Contra or English Country Dance** — not
the Community Dance, whose series has no sound-tech slot, so a sound-tech booking there is refused — and
throwaway contacts **Doory One** (personal email `doory.one@example.com`), **Doory Two** and **Doory
Performer**. Book Doory Performer on the event twice — as **musician** and as **sound tech** — and book any
other existing performer as **caller**.

### 1. The page on a phone (User Story 1)

1. Open `/checkin`. **Expect**: Doorcheck Test shown large, no "not today" warning; the search box focused;
   the extras row, **Check in anonymously**, **Add contact** and **Show checked in** all visible without
   scrolling.
2. **Change** to an event on another date. **Expect**: the warning. Change back.
3. Search `doory`. **Expect**: results beneath, names by the 076 rule, Doory One's address shown.
4. Set **children 2** in the extras row, then **Check in** on Doory One. **Expect**: a confirmation, the
   search and extras row cleared.
5. Search `doory` again. **Expect**: Doory One shows a checkmark and no Check in.
6. Type `doory two` and press **Enter**. **Expect**: Doory Two checked in.
7. Tick **comp**, then **Check in anonymously**. **Expect**: recorded; comp cleared.

### 2. Add contact (User Story 2)

1. **Add contact**; type first name `Doory`. **Expect**: Doory One and Doory Two suggested, Doory One
   checkmarked.
2. Enter first `Doory`, last `Three`, email `doory.one@example.com`, and submit. **Expect**: asked whether
   it is Doory One, someone sharing it, or a mistake — and no contact created yet.
3. Choose **Fix the email**. **Expect**: back to the form, email ready to edit.
4. Submit again and choose **Different person sharing it**. **Expect**: Doory Three created and checked in;
   in the contacts page, Doory Three is reached via Doory One and owns no address, and is flagged for
   review.

### 3. Checked-in dialog (User Story 3)

1. Check Doory Performer in. **Show checked in**. **Expect**: the list sorted by display name; sorting by
   first and last name works.
2. **Expect** at the top: paying and children; caller **0** (the caller is booked but not checked in); band
   **1**; sound tech absent; door attendant 1; comps 1; gift cards 0 — and a warning that Doory Performer is
   booked as musician and sound tech.
3. Correct Doory One's children to 1. **Expect**: children and paying update.

### 4. The same figures everywhere (User Story 4)

1. Open `/gate` and `/treasurer` for Doorcheck Test. **Expect**: the same breakdown at the top of each, with
   the double-booking warning.
2. Run the organizer report for the series. **Expect**: Doorcheck Test's paying dancers equal the
   breakdown's paying.
3. Check in the booked caller. **Expect**: caller 1 and paying one lower, on all three screens.

### 5. After the purge

Covered by the automated suite (`attendance.purge` tests): an event's breakdown is identical before and
after its check-ins are purged. Not walked by hand — it needs check-ins older than 90 days.

## Cleanup

Delete the bookings on Doorcheck Test, then Doory Performer's performer record, then the event (its
check-ins, door record and rollup go with it), then the throwaway contacts. None of them pays for a
membership account.

```sql
BEGIN;
DELETE FROM bookings WHERE event_id IN (SELECT id FROM events WHERE label = 'Doorcheck Test');
DELETE FROM performers WHERE display_name = 'Doory Performer';
DELETE FROM events WHERE label = 'Doorcheck Test';
DELETE FROM contacts WHERE display_name ILIKE 'Doory %';
COMMIT;
```
