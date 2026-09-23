# Quickstart: Everyone can reach their own work

**Feature**: 086-access-signposting | **Spec**: [spec.md](./spec.md) | **Contract**:
[contracts/access.md](./contracts/access.md)

## Prerequisites

- **Nothing running against the development database** while the suite runs.
- No migration — `pnpm db:migrate` has nothing to apply for this feature.
- Sign-ins to hand: a **Booker**, a **Financial Secretary**, a **Door Attendant**, and a **President
  or VP** (the access screen needs `role.assign`). Rich's Super-user can stand in for the permitted
  cases, but never for the refused ones — a Super-user is refused nothing, so only a real Door
  Attendant proves §2.5, and only a series-scoped volunteer proves §3.

## Automated gates

```bash
pnpm tsc --noEmit
pnpm vitest run
pnpm build
pnpm lint:md
```

Plus `pnpm exec eslint` and `pnpm exec prettier --check` on the changed files only.

## Manual pass

### 1. The Booker can create the contact a performer needs (US1, SC-001)

1. Sign in as a **Booker**. Open **Performers** and search for a performer with no contact behind
   it. There is **no queue of them** — the page is search-led, so you must know a name. As of
   2026-09-23 the club has 18; **Evan DeSmitt** (3 bookings) and **Jim Sloboda** are good ones.
   Opening the record raises feature 084's question.
2. Choose to create the contact. *Expect*: it is created and the performer is linked to it. **No
   refusal, no 403, at any step.**
3. Correct something on a contact. *Expect*: accepted.
4. *Expect*: the Booker is still offered no way to delete a contact.

### 2. The gate report reaches the right people (US2, SC-002, SC-002a, SC-002b)

1. Sign in as a **Financial Secretary**. Open the volunteer menu.
2. *Expect*: **Treasurer report** is listed. Follow it and read an evening.
3. *Expect*: the report reads exactly as it did — this feature decides who opens it, not what it
   says.
4. Open an evening of the **other** series, as though covering for the other Financial Secretary.
   *Expect*: it opens. **No refusal** — reading is not confined by series.
5. Sign in as a **Door Attendant**. *Expect*: no Treasurer report in the menu, and **refused** when
   requested directly by address. This is the step that distinguishes this feature from hiding a
   link, so do not skip it.

### 3. The evening list starts where the volunteer works (US3, SC-006)

**The grants are already right** (set 2026-09-23): Peggy Dempsey holds Booker and Financial
Secretary for **ecd**; PeggyTBD holds both for **tnc**; the Treasurer and Super-user are club-wide.
Each Financial Secretary's roles therefore name exactly one series, which is what makes the default
visible. If someone later holds roles in two series, the list correctly starts unnarrowed (FR-010) —
that is the rule, not a regression.

1. Sign in as **Peggy Dempsey** (ecd) or **PeggyTBD** (tnc). Open the **gate report**. *Expect*: the
   series filter already shows her series, and the evenings listed are hers — without touching
   anything.
2. Open **gate money** and **payments**. *Expect*: the same.
3. Change the series filter to another series. *Expect*: its evenings list, and opening one works.
   **One step, no refusal.**
4. Open **check-in**. *Expect*: unchanged — it starts at "any series", exactly as before.
5. Sign in as **Michael Pallischeck** (Treasurer, club-wide). *Expect*: no narrowing anywhere; the
   lists start as they always did.

### 4. A link to a contact opens that contact (US4, SC-003)

1. As the **Booker**, open a performer that has a contact.
2. **Type a change into the form but do not save it.**
3. Follow the link to the contact. *Expect*: the contact opens **in a new tab**, showing that
   contact's own record.
4. Return to the performer tab. *Expect*: the form is still there and **the unsaved change is still
   in it**.
5. Find the performer whose contact is **archived** (one exists in the club's data). Follow its
   link. *Expect*: the record opens, and that it is archived is plain.
6. Type a made-up contact id into the address bar yourself —
   `http://localhost:3000/contacts?contactId=nope`. *Expect*: the directory says **"That contact
   could not be opened — it may have been merged or removed"**, and the search box still works. The
   point is that a stale link or a typo never silently shows the whole directory as though nothing
   had been asked for.

### 5. The access screen tells the truth about series (US5, SC-004)

1. Sign in as **President, VP or Super-user**. Open the access screen.
2. *Expect*: each volunteer's roles name **the series each covers** — "booker · Thursday Night
   Contra", never the bare words "series-scoped". A club-wide role reads as covering every series.
3. Grant that same volunteer the **same role for a second series**, choosing the series **from a
   list** rather than typing a key.
4. *Expect*: both grants are now listed, each naming its series, and the first was not disturbed.
5. Revoke the second. *Expect*: the first is still there.

## The guard that is easy to skip

SC-005 says every other capability is unchanged. That is a test over the whole map, not something to
eyeball — but confirm by hand once, as the volunteer whose access this feature narrows:

1. Sign in as a **Door Attendant**.
2. *Expect*: `/gate` and `/access` are still not offered — reversing nothing, as before.
3. *Expect*: `/checkin` still is, and their own work is untouched.

## Cleanup

Undo the second grant from §5.3, and restore the club-wide grant changed in §3, if those were only
for the test. Nothing else to undo — no migration, no stored state.
