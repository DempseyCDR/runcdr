# Quickstart: the Booker's records

**Feature**: 084-booker-record-editing | **Spec**: [spec.md](./spec.md) | **Contract**:
[contracts/records.md](./contracts/records.md)

## Prerequisites

- **Nothing running against the development database** while migrating or running the suite.
- A sign-in holding `venue.write` and `performer.write` — the Booker, or the super-user.
- The development database still holds the live test case: the performer **Clara Reidlinger** (9 bookings,
  3 upcoming, no contact) and the contact **Clara Riedlinger**. Leave them as they are until §4.

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

### 1. Nothing is write-once (US1)

1. Create an event, then reopen it. *Expect*: the same form, and a label, start time and public
   description you can set and save.
2. Create a venue, then reopen it. *Expect*: name, short name, address, directions and landlord all
   editable.
3. Create a performer, then reopen it. *Expect*: display name, biography, public and caller flags, styles
   and links all editable — and email and telephone shown but not editable, with a link to the contact.
4. As a **Webmaster**, open an event. *Expect*: the date is visible but not editable; the advertised price
   is. As the **Booker**, the reverse.
5. Change one field and save. *Expect*: only that field is sent (check the network panel) — the rest of
   the record is untouched.

### 2. Finding by name (US2)

1. Open `/manage/performers`. *Expect*: the search box has focus and no roster is listed.
2. Type two letters of a surname. *Expect*: matches ordered by name; each opens the form.
3. Search something matching many. *Expect*: "more matched — narrow the search", not a wall of names.
4. Search a name nobody has. *Expect*: an offer to create that performer, with the name carried in.
5. Repeat on `/bands`. *Expect*: the same behaviour.

### 3. Retiring what is not used (US3)

1. Archive a venue with no future events. *Expect*: gone from the venue list and from the event form's
   picker; a past event that used it still names it.
2. Archive a venue that HAS future events. *Expect*: a warning saying how many and when the next one is;
   archiving proceeds on confirmation, and those events still name it.
3. Archive a performer who is on the public roster. *Expect*: they leave `/performers` at once.
4. Search with **include archived** on. *Expect*: they are found, shown as archived, and can be restored —
   and restoring puts the performer back on the public roster.

### 4. Clara — the live test case (US4)

1. Open the performer **Clara Reidlinger**. *Expect*: the three choices, before the rest of the form.
2. *Expect*: **Clara Riedlinger** offered as the likely contact, ahead of anything else, despite the
   transposed letters.
3. Link her. *Expect*: the offer to correct the performer's spelling to the contact's — accept it, and all
   9 bookings read correctly afterwards.
4. Open a seed leftover (**Sample Caller**, no bookings). *Expect*: the same three choices; archive it, and
   it leaves the roster.
5. Open a performer who already has a contact. *Expect*: no question at all.
6. Try creating a contact for a performer whose name nearly matches an existing contact. *Expect*: "did you
   mean…?" before a second contact is created.

### 5. Rents live with the venue (US5)

1. Open a venue. *Expect*: its rents listed — series, amount, effective date — newest first, and "none set"
   where there is none.
2. Add a rent from today. *Expect*: events from today resolve the new figure; **open an older event's
   treasurer report and confirm its rent is exactly what it was before**.
3. Delete the rent you just added, before any event uses it. *Expect*: it goes, and the previous rent
   applies again.
4. Try deleting a rent an event has used. *Expect*: refused, naming what uses it.
5. *Expect*: the volunteer menu no longer offers **Venue rents**, and `/venue-rents` is gone.

## Cleanup

Nothing to undo if §4 step 3 was taken as intended — linking Clara and correcting the spelling is the fix,
not test litter. Archive any throwaway venue or performer created in §1 and §3, or delete them if nothing
used them.
