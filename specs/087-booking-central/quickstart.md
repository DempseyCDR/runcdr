# Quickstart: Booking Central

**Feature**: 087-booking-central | **Spec**: [spec.md](./spec.md) | **Contract**:
[contracts/hub.md](./contracts/hub.md)

## Prerequisites

- **Nothing running against the development database** while migrating or running the suite.
- Sign-ins: a **Booker** (Peggy Dempsey holds ecd, PeggyTBD holds tnc), a **Financial Secretary**,
  and the **Treasurer**. The Booker sign-ins are the point — a Super-user sees everything and proves
  nothing about what the Booker was given.
- Sean's spreadsheet to hand, or a printout of it, for §1.

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

### 1. The season on one page (US1)

1. Sign in as a **Booker** and open Booking Central.
2. *Expect*: one row per dance, newest first, starting four months out, the series named at the
   head.
3. Compare a month against the spreadsheet. *Expect*: the same dances, the same people, the same
   gaps.
4. *Expect*: above the table, **four things and no more** — the series, the horizon, the search, and
   the count of performers needing a contact.
5. Find a dance with nobody booked to call. *Expect*: the empty slot is as loud as a filled one.
6. Find a dance in the **English** series. *Expect*: **no** sound-tech mark — that series uses none,
   and a permanent warning is a warning nobody reads.
7. Find a cancelled dance. *Expect*: it says so **in words**, not only in colour.
8. Push the horizon out a year. *Expect*: dances beyond four months appear, the table otherwise
   unchanged.
9. Scroll to the foot. *Expect*: more history loads, and keeps loading, with **no dance repeated or
   skipped** — check especially a date carrying two dances.

### 2. Work the row (US2)

1. Click a label. *Expect*: the dance opens. Click a venue's short code. *Expect*: the venue opens.
2. Click a caller's name. *Expect*: **that booking** — pay, note, and the way to decline.
3. Click a band's name. *Expect*: **that dance's band bookings**, every member with their own state.
4. Click a status button repeatedly. *Expect*: proposed → requested → tentative → confirmed, and
   **it stops**. Keep clicking. *Expect*: nobody is ever declined.
5. Click a **band's** status. *Expect*: the lead advances and the rest of the band follows.
6. Click the mark in an empty caller cell. *Expect*: a caller booking for that dance begins, without
   leaving the row.
7. Look for a way to create a new dance. *Expect*: there isn't one — that is the events page.

### 3. Performers and bands (US3)

1. Type a name in the search. *Expect*: performers **and** bands, each saying which it is.
2. *Expect*: archived ones are absent until you ask for them.
3. Open a performer. *Expect*: their dances, played and booked. Open their bands. *Expect*: each
   leads to that band.
4. In a band, untick a member. *Expect*: they leave the band. Search and add one. *Expect*: they
   join.
5. Untick the **lead**. *Expect*: the band says it has no lead, and offers the members with an email
   address to contact.
6. **Then check the bookings.** *Expect*: every past and future booking is exactly as it was — this
   is the property the whole undated-membership decision rests on.

### 4. The evening's lineup (US4)

1. Open a booked band's lineup for a dance. Decline one member. *Expect*: only their booking
   changes.
2. Substitute another performer. *Expect*: they are booked for that dance and **the band's
   membership is unchanged**.
3. Read that dance again. *Expect*: it shows who actually played.

### 5. The performers who need a contact (US5)

1. *Expect*: the count above the table reads **18**.
2. Open one — **Evan DeSmitt** is a good case. *Expect*: link, create, or archive. Settle it.
3. *Expect*: the count falls to 17.
4. Open **Catherine Sloboda**, whose contact is archived. *Expect*: the same question, worded for a
   retired link, and choosing **Catherine McCallen** re-points it (B58).
5. *Expect*: no booking of hers changed.

## The guard that is easy to skip

Four pages are being deleted. This feature nearly lost four capabilities with them during
specification alone, so check each one as the person who would notice:

1. As the **Financial Secretary**, open `/payments` and correct a performer's name. *Expect*: it
   works, and there is **no performers page** in her menu.
2. As the **Treasurer**, the same, and `/venues` still in his menu.
3. As the **Webmaster**, `/events` still in the menu, and the public blurb still editable.
4. As the **Booker**, `/events` still in the menu — that is where new dances come from.
5. *Expect*: the menu has lost **four** entries and gained one.

## Cleanup

Undo the band membership change from §3.4 and the substitution from §4.2 if they were only for the
test. The performer settled in §5.2 is real work — leave it done.
