---
description: "Task list for feature 079 — mobile door check-in"
---

# Tasks: Mobile door check-in

**Input**: Design documents from `/specs/079-mobile-door-checkin/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/door-checkin.md](./contracts/door-checkin.md)

**Tests are NOT optional here.** Constitution Principle I (Test-First) is NON-NEGOTIABLE: every behaviour
lands as a failing test before its implementation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: may run in parallel (different files, no dependency on an incomplete task)
- **[US1]** etc.: the user story the task serves

## Path Conventions

Single Next.js app. Server code under `src/server/`, the door UI under `src/app/(door)/`, shared client
components under `src/app/_components/`, integration tests under `tests/integration/`, component tests under
`tests/component/`.

---

## Phase 1: Setup

- [X] T001 Create migration `src/server/db/migrations/0050_event_attendance_rollups.sql`: table
  `event_attendance_rollups` with `event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE`,
  `children_count`, `caller_count`, `band_count`, `sound_tech_count`, `instructor_count` (all
  `integer NOT NULL DEFAULT 0`, each `CHECK (… >= 0)`), and `updated_at timestamptz NOT NULL DEFAULT now()`.
  Comment that only the attendance purge writes it, adding what it deletes (research R2). Apply it with
  `pnpm db:migrate`.
- [X] T002 [P] Add `eventAttendanceRollups` to `src/server/db/schema/attendance.ts`, matching
  [data-model.md](./data-model.md), and export its row type.
- [X] T003 [P] Move `src/app/(admin)/contacts/_components/PairContactName.tsx` to
  `src/app/_components/ContactName.tsx` (default export `ContactName`), moving the `dupName` /
  `dupStructuredName` styles it uses into `src/app/_components/ContactName.module.css`. Update the imports in
  `DuplicatePair.tsx` and `MergeCompare.tsx`. Keep its prop type structural (`displayName`, `firstName`,
  `lastName`, `displayNameOverride`) and its 076 comment. `tests/component/contacts.duplicatePair.test.tsx`
  and `contacts.mergeCompare.test.tsx` must still pass unchanged (research R5).

---

## Phase 2: Foundational (blocking prerequisites)

The event-aware search serves US1 and US2; the breakdown serves US3 and US4.

- [X] T004 [P] Extend `tests/integration/door.checkin-search.test.ts` (contract §1, research R4):
  - With `eventId`, a contact checked in to that event has `checkedIn: true`, and one checked in to another
    event has `checkedIn: false`; without `eventId`, `checkedIn` is absent.
  - Items carry `firstName`, `lastName` and `displayNameOverride`.
  - `emails` lists only reachable addresses — `active` or `transition`, never `inactive` — with
    `personal`-purpose addresses first.
  - A contact riding a household address (`message_recipient_email_id`) has
    `reachedVia: { ownerDisplayName, address }`; others have `reachedVia: null`.
  - An actor without `contact.pii.read` gets `emails: []` and `reachedVia.address: null`, but still the
    names and `checkedIn`.
- [X] T005 [P] Write `tests/integration/attendance.breakdown.test.ts` against `getAttendanceBreakdown` and
  `GET /api/events/{id}/attendance-breakdown` (data-model "Derived", contract §3):
  - Attendance is `events.attendance_count`; children sums check-ins' children; comps is comp count plus
    open-band count; gift cards is the redemption count; door attendant is 1; with no door record, comps and
    gift cards are 0.
  - A booked caller **not** checked in is not subtracted; once checked in, caller is 1 and paying drops by
    one (FR-023).
  - Band counts lead musician, musician and open-band musician bookings; sound tech and instructor count
    separately.
  - A booking on **another** event — including a sibling in the same group — does not count; a booking in
    any status (`proposed`, `tentative`, `confirmed`) does (FR-024).
  - One contact booked as musician and sound tech, checked in: counted once, under band, and listed in
    `doubleBookings` with both kinds; not checked in: not listed (FR-033).
  - Paying never goes below zero; whenever it is above zero, paying + performers + 1 + comps = attendance
    (SC-005).
  - Removing a checked-in performer's booking, or adding one for someone already checked in, changes the
    next breakdown (FR-030).
  - A rollup row's counts are added to the figures derived from present check-ins.
  - The route: any signed-in volunteer may read it (`base`); an unknown event is `404 EVENT_NOT_FOUND`.
- [X] T006 [P] Write `tests/component/attendanceBreakdown.test.tsx` for `AttendanceBreakdownView` (contract §6):
  paying and children first, then caller, band, door attendant, comps and gift cards; sound tech and
  instructor shown only when non-zero; one warning line per double booking naming the performer and each
  kind; the list is a wrapping horizontal list with the break after children.
- [X] T007 Extend `src/app/api/attendance/search/route.ts` to pass T004: accept `eventId`; add the structured
  names; attach active and transition addresses ordered personal first; attach `reachedVia` from
  `contacts.message_recipient_email_id`; compute `checkedIn` from `attendance` for the event. Keep the PII
  gate and the single disclosure record per request.
- [X] T008 Create `src/server/domain/attendance/breakdownService.ts` exporting `AttendanceBreakdown` (type)
  and `getAttendanceBreakdown(db, eventId)`, to pass T005's service tests: read the event, door record,
  rollup and present check-ins; match check-ins to performers booked for the event by contact; assign one
  kind per contact (caller → band → sound tech → instructor); collect double bookings; compute paying with
  `payingDancers` from `src/server/domain/organizer/danceResult.ts`. **Export the check-in → performer-kind
  matching as its own function**, taking a set of check-in rows, so the purge (T035) reuses it rather than
  copying it. Throw `errors.eventNotFound()` for an
  unknown event.
- [X] T009 Create `src/app/api/events/[id]/attendance-breakdown/route.ts` — `GET`,
  `withAuth({ requires: "base" })`, returning `getAttendanceBreakdown` — to pass T005's route tests. Confirm
  `tests/integration/auth.routeInventory.test.ts` still passes with the new route.
- [X] T010 Create `src/app/_components/AttendanceBreakdownView.tsx` (with a CSS module beside it), taking
  the `AttendanceBreakdown` type as its prop through `import type`, to pass T006. The component is named
  `AttendanceBreakdownView` so it never shadows the type.

**Checkpoint**: search knows the event, and one breakdown exists to show.

---

## Phase 3: User Story 1 — Check a dancer in quickly on a phone (Priority: P1) 🎯 MVP

**Goal**: the top region, event confirmation, results with the name rule and checkmark, the extras row,
Enter, and Check in anonymously.

**Independent test**: on a medium phone (390 × 844), confirm the event, find a contact, set children in the
extras row, check in with one tap; the extras row resets, a second search shows a checkmark, and anonymous
check-in is reachable without scrolling.

- [X] T011 [P] [US1] Write `tests/component/checkin.page.test.tsx` for the rebuilt `/checkin`:
  - DOM order: event, search box, extras row, Check in anonymously, Add contact and Show checked in, then
    results; the search box has focus on load.
  - The event is shown with date, series and start time and a **Change** control; a "not today" warning
    appears when the event's date differs from the device's local date and not otherwise.
  - Results render through `ContactName` (a custom display name shows first and last beneath), show
    addresses or "reached via …", and a `checkedIn` result shows a checkmark and no Check in button.
  - The extras row is sent with a result's check-in and reset after a 201; after a refused check-in it is
    kept.
  - Open band appears only for a community-dance event.
  - Enter checks in the top result; does nothing when it is checked in or there are no results.
  - Check in anonymously sends `unmatched` with the extras row's children, comp and gift card; it is
    disabled while open band is ticked.
  - After any check-in the search clears, a confirmation names who was checked in, and the search box
    regains focus.
  - With no event selected, Check in, Enter, Check in anonymously and Add contact record nothing, and the
    event area offers Change.
  - A truncated search still says more matched than are shown.
  - A refused check-in (for example `409 ALREADY_CHECKED_IN` from another attendant) shows its message and
    keeps the extras row.
- [X] T012 [P] [US1] Update `tests/component/eventSelector.test.tsx` (and `checkin.selector.test.tsx` and
  `gate.eventSelector.test.tsx`, which share the default) so the default is the most recent event on
  or before the **device's local date**, with a case where the UTC date is already tomorrow
  (research R9).
- [X] T013 [P] [US1] Add to `tests/integration/door.attendance-match.test.ts`: two check-ins of the same
  contact reaching the database together (bypassing the service's pre-check) are refused as
  `ALREADY_CHECKED_IN`, not a raw database error (research R12).
- [X] T014 [US1] In `src/server/domain/attendance/attendanceService.ts`, map a unique violation on
  `attendance_event_contact` to `errors.alreadyCheckedIn()`, to pass T013.
- [X] T015 [US1] Add a `localToday()` helper (the device's local date as `YYYY-MM-DD`) beside
  `src/app/EventSelector.tsx` and use it for the selector's default, to pass T012.
- [X] T016 [P] [US1] Create `src/app/(door)/checkin/EventConfirm.tsx`: the selected event large, **Change**
  revealing `EventSelector`, and the not-today warning using `localToday()`. The selector's event row carries
  only `seriesId`, so resolve the series **name** from the `/api/series` list the page already loads.
- [X] T017 [P] [US1] Create `src/app/(door)/checkin/checkin.module.css`, mobile-first: a compact top region,
  a wrapping extras row, large tap targets, result rows that keep name and Check in on one line (FR-008), and
  backdrop/panel classes for the dialogs of US2 and US3 (research R12).
- [X] T018 [US1] Rebuild the top of `src/app/(door)/checkin/page.tsx` to pass T011: `EventConfirm`; the
  search box calling `/api/attendance/search` with `eventId`; one extras-row state applied to the next
  check-in and reset on success only; results with `ContactName`, addresses or "reached via …", and Check in
  or a checkmark; Enter; Check in anonymously; Add contact and Show checked in buttons. **Keep the existing
  inline new-contact form and inline roster below the results**, untouched, until US2 and US3 replace them,
  so the page stays usable.
- [X] T019 [US1] Update the component tests the rebuild supersedes: `tests/component/checkin.inlineRow.test.tsx`
  (per-row controls are gone — cover children via the extras row, or retire what T011 now covers) and
  `tests/component/checkin.giftCard.test.tsx` (gift card via the extras row). Record in this file which
  tests were retired and where their coverage now lives.

**Checkpoint**: Meg can check dancers in on a phone; the old form and roster still sit below.

---

## Phase 4: User Story 2 — Add a walk-in without a duplicate or a lost email (Priority: P1)

**Goal**: the Add contact dialog with suggestions, and the three answers to an email that belongs to
someone else.

**Independent test**: open Add contact, check an existing contact in from the suggestions; add a new contact
whose email belongs to someone else and exercise each of the three answers.

- [X] T020 [P] [US2] Extend `tests/integration/door.attendance-new.test.ts` (contract §2, research R6):
  - A new contact whose email is `active` on another contact is refused `409 EMAIL_ACTIVE_ELSEWHERE` with
    `details.other` naming that contact and the email id — and **no contact and no check-in are created**.
  - The same for an address in `transition`.
  - An address that is `inactive` on another contact does not collide: the contact is created owning it.
  - With `shareEmail: true`, the contact is created owning **no** address, its `message_recipient_email_id`
    is the owner's email, it is checked in and flagged `needs_review`, and `contact.reference.linked` is
    audited. It has no sign-in address: the shared email stays the owner's alone (FR-017).
  - If the check-in then fails (for example open band at a non-community dance), nothing is left behind —
    no contact, no link.
  - Email and phone left blank still create and check in the contact.
  - The old behaviour is gone: no path creates the contact and silently drops its email.
- [X] T021 [P] [US2] Write `tests/component/checkin.addContact.test.tsx` for `AddContactDialog`:
  - Opens from Add contact with first name, last name, display name, email and phone, and no pronouns
    field; shows a "With: …" summary of the extras row.
  - Typing a name or an email calls the search with `eventId` and lists at most five suggestions through
    `ContactName`, each with Check in (or a checkmark); checking one in posts its `contactId` with the
    extras row.
  - A `409 EMAIL_ACTIVE_ELSEWHERE` shows three choices naming the owner. **It's {owner}** posts the owner's
    `contactId`; **Different person sharing it** resubmits with `shareEmail: true`; **Fix the email**
    returns to the form with the email field focused and posts nothing.
  - When **It's {owner}** is refused `409 ALREADY_CHECKED_IN`, the dialog says the owner is already checked
    in and offers to close; the extras row is kept.
  - A successful check-in closes the dialog, resets the extras row, and returns focus to the search box.
- [X] T022 [US2] Add optional `shareEmail: z.literal(true)` to `newContact` in
  `src/server/validation/attendance.ts`.
- [X] T023 [US2] Make the linking in `src/server/domain/contacts/referenceService.ts` callable inside an
  existing transaction (accept `DbOrTx`, or extract the body into a function taking a transaction), keeping
  every rule and the audit, and keeping `linkMessageRecipient`'s own behaviour and tests unchanged.
- [X] T024 [US2] Rework the new-contact path of `recordAttendance` in
  `src/server/domain/attendance/attendanceService.ts` to pass T020: run it in one transaction; before
  inserting, look for an `active`/`transition` owner of the email; with no `shareEmail`, throw
  `errors.emailActiveElsewhere({ contactId, displayName, emailId })`; with `shareEmail`, create the contact
  without the email and link it (T023); otherwise insert the email as today. Delete the unique-violation
  swallow; a race on the email index is refused the same way.
- [X] T025 [US2] Create `src/app/(door)/checkin/AddContactDialog.tsx` to pass T021, and in `page.tsx` open it
  from Add contact and **remove the inline new-contact form**.

**Checkpoint**: no door-created contact loses its email, and duplicates are caught before they are made.

---

## Phase 5: User Story 3 — See who is in, and correct mistakes (Priority: P2)

**Goal**: the checked-in dialog — breakdown at the top, three sort orders, corrections from a row.

**Independent test**: check in several dancers, a performer and an anonymous guest; open Show checked in;
confirm the sorts, the counts, and that a correction updates both list and counts.

- [X] T026 [P] [US3] Extend `tests/integration/checkin.sort.test.ts`: `sort=display` orders by display name,
  then first, then last, anonymous check-ins last; attendees carry `displayNameOverride`; the route's
  default stays `last`.
- [X] T027 [P] [US3] Write `tests/component/checkin.checkedInDialog.test.tsx` for `CheckedInDialog`: opens
  from Show checked in; requests `sort=display` by default and switches to first and last; shows
  `AttendanceBreakdownView` from `/attendance-breakdown` at the top; each attendee uses `ContactName`; tapping an
  attendee opens the correction dialog; after a correction both the list and the breakdown are fetched
  again; reopening the dialog fetches fresh data (FR-021).
- [X] T028 [US3] Add the `display` sort and `displayNameOverride` to `listEventAttendance` in
  `src/server/domain/attendance/attendanceService.ts`, and accept `sort=display` in
  `src/app/api/events/[id]/attendance/route.ts` without changing its default, to pass T026.
- [X] T029 [US3] Move `CorrectionModal` out of `page.tsx` into `src/app/(door)/checkin/CorrectionModal.tsx`
  with its behaviour unchanged, restyled with `checkin.module.css`; update
  `tests/component/checkin.correctionModal.test.tsx`'s import.
- [X] T030 [US3] Create `src/app/(door)/checkin/CheckedInDialog.tsx` to pass T027, and in `page.tsx` open it
  from Show checked in and **remove the inline roster**.

**Checkpoint**: the page matches MEG-R8 in full — nothing below the results but more results.

---

## Phase 6: User Story 4 — A paying count everyone can trust (Priority: P2)

**Goal**: the purge keeps the breakdown true; the organizer report, treasurer report and gate page all use
it.

**Independent test**: for an event with a booked caller and sound tech where only the caller is checked in,
the four surfaces agree and subtract only the caller; purge the check-ins and nothing changes.

- [X] T031 [P] [US4] Extend `tests/integration/attendance.purge.test.ts` (FR-029, SC-006): for an event with
  children, a checked-in caller, band member and sound tech, the breakdown is **identical** before and after
  `purgeOldAttendance`; a purge that removes only part of an event's check-ins in one run and the rest in a
  later run leaves the same figures (counts are added, not overwritten); a re-run is a no-op; deleting the
  event deletes its rollup.
- [X] T032 [P] [US4] Update `tests/integration/organizer.report.test.ts` (research R3): performers booked but
  not checked in are no longer subtracted; checked-in performers are; each event's paying dancers equal
  `getAttendanceBreakdown(...).paying`; average ticket follows. Change existing expectations, do not drop
  cases.
- [X] T033 [P] [US4] Extend `tests/integration/treasurer.report.test.ts`: the report carries `attendance`
  equal to `getAttendanceBreakdown` for the event; existing fields unchanged.
- [X] T034 [P] [US4] Extend `tests/component/treasurer.page.test.tsx` and add to a gate component test (for
  example `tests/component/gate.reload.test.tsx`): `AttendanceBreakdownView` renders at the top of each page for
  the selected event, and on `/gate` it is fetched again after the door record is saved.
- [X] T035 [US4] In `src/server/domain/attendance/retentionService.ts`, before deleting purge-eligible rows
  and inside the same transaction, compute per event the children and performers-by-kind among those rows
  (the same matching as T008 — share it, do not copy it) and upsert-add them into `event_attendance_rollups`,
  to pass T031.
- [X] T036 [US4] In `src/server/domain/organizer/reportService.ts`, take each event's paying dancers from
  `getAttendanceBreakdown` instead of counting all booked performers, to pass T032. Correct the doc comment
  on `payingDancers` in `danceResult.ts` ("distinct performers" → performers checked in).
- [X] T037 [US4] Add `attendance: AttendanceBreakdown` to `assembleTreasurerReport` in
  `src/server/domain/treasurer/reportService.ts`, to pass T033.
- [X] T038 [US4] Render `AttendanceBreakdownView` at the top of `src/app/(admin)/treasurer/page.tsx` (replacing
  the "Comp admissions · Gift-card redemptions" line) and of `src/app/(door)/gate/page.tsx` (fetched from
  `/attendance-breakdown` on event selection and after save), to pass T034.

**Checkpoint**: all four user stories complete.

---

## Phase 7: Polish & Cross-Cutting

- [X] T039 [P] Update `specs/DATA_MODEL.md`: the `event_attendance_rollups` table, and the organizer report's
  paying rule (performers checked in, not all booked).
- [X] T040 [P] Update `specs/phase-8-requirements/meg-door-checkin.md` §4: mark MEG-R1–R5, R8–R10, C4 and C6
  built by 079.
- [X] T041 Verify the phone layout in the browser preview on a medium phone, 390 × 844: the top region
  through Add contact and Show checked in fits without scrolling within about 700 points of height — what
  the page sees with the browser's bars showing — (FR-002, SC-002); results scroll beneath; both dialogs
  scroll within the viewport. Then check 360 wide and 375 × 667 for no horizontal scrolling and Check in
  anonymously still above the results. Record the result and a screenshot reference in `plan.md`.
- [X] T042 Run the full gate suite, with nothing else on the dev database: `pnpm db:migrate`,
  `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm eslint` and `pnpm exec prettier --check` on the changed
  files only, `pnpm build`, and `pnpm lint:md`. Single-contributor mode: no gate may be skipped.
- [X] T043 Walk [quickstart.md](./quickstart.md) §1–§4 by hand on the throwaway event and contacts (Rich:
  needs door attendant, treasurer and Financial Secretary sign-ins, or the super-user), then run its cleanup.
  Record the result in a Verification section of `plan.md`.

---

## Dependencies

```text
Phase 1 (T001–T003)
   └── Phase 2 Foundational (T004–T010): event-aware search, the breakdown and its component
          ├── Phase 3 US1 (T011–T019): the top region and results          ← MVP
          │      ├── Phase 4 US2 (T020–T025): Add contact dialog, email ownership
          │      └── Phase 5 US3 (T026–T030): checked-in dialog
          └── Phase 6 US4 (T031–T038): purge rollup, organizer / treasurer / gate
                 └── Phase 7 Polish (T039–T043)
```

- US2 and US3 each depend on US1's rebuilt page, and each removes one of the inline sections US1 left in
  place. They touch `page.tsx` in separate places, so do them one after the other.
- US4 depends only on Phase 2; it can run before, after or alongside US1–US3.
- Within `attendanceService.ts`, T014, T024 and T028 edit different functions but the same file — sequence
  them.

## Parallel opportunities

- **Phase 1**: T002 and T003.
- **Phase 2**: tests T004, T005 and T006 together; then T007, T008 and T010 (different files); T009 after
  T008.
- **US1**: T011, T012 and T013; then T016 and T017 while T014 and T015 land.
- **US2**: T020 and T021.
- **US3**: T026 and T027.
- **US4**: T031, T032, T033 and T034 together.
- **Polish**: T039 and T040.

## Implementation strategy

**MVP = Phases 1–3.** Meg checks dancers in on a phone, sees who is already in, and checks in an anonymous
guest without scrolling. The old inline form and roster still work beneath the results.

**Then US2**, P1: it fixes a live defect (the silently dropped email) as well as adding the dialog.

**Then US3 and US4**, P2, in either order. US4 is the only part that changes a report's figures, and its
purge test (T031) must pass before the phase is called done.

## Deviations recorded during implementation

- **T019 — retired and moved tests.** `tests/component/checkin.inlineRow.test.tsx` is deleted: its two cases
  (children on a result, children on an anonymous check-in) now live in `checkin.page.test.tsx` as the extras
  row. The matched-path case in `checkin.giftCard.test.tsx` is removed for the same reason (gift card via the
  extras row, in `checkin.page.test.tsx`); its new-contact case stayed until US2 replaced the inline form, and
  the file was then deleted in T025 — gift card and comp on a new contact are covered by
  `checkin.addContact.test.tsx`.
  `checkin.selector.test.tsx` asks for the event `combobox` by role, since the page now also has an "Event"
  region.
- **T012 — no change needed to `checkin.selector.test.tsx` or `gate.eventSelector.test.tsx`.** Both use dates
  far in the past, so switching "today" from UTC to the device's date does not move their defaults. The new
  case lives in `eventSelector.test.tsx`, with the time zone set to Eastern and the clock at 9:30 pm.
- **T013 — the race is made deterministic** by holding the first check-in in an uncommitted transaction, so the
  second passes the pre-check and waits on the unique index.
- **T020/T024 — the email-owner refusal's payload is `error.other`, not `error.details.other`.** That is where
  `ApiError` already puts feature 066's colliding contact, and the contract (§2) is corrected to match. A race
  that reaches the email index after the owner check is refused `409 EMAIL_DUPLICATE` without naming the
  owner: the transaction has already aborted, so the owner cannot be looked up — Meg's retry is then asked
  about them.
- **T024 — `recordAttendance` now runs in one transaction for every path**, not only the new-contact one, and
  takes the acting staff contact so the shared-address link's audit names who made it.
- **T027/T029 — shared test fixture and the correction test's route.** `BREAKDOWN` lives in
  `tests/component/fixtures/attendanceBreakdown.ts`, so the dialog test imports it without re-running the
  breakdown component's own tests. `checkin.correctionModal.test.tsx` now opens **Show checked in** before
  tapping a row, and stubs the breakdown route.
- **T030 — the correction dialog also refreshes the list and counts when it is closed**, not only after a
  change that closes it: its comp and gift-card nudges change the breakdown while leaving the dialog open.
- **T032 — kept the existing organizer and comp-count figures by checking the booked performers in**, rather
  than changing their expected numbers: `organizer.report.test.ts`'s first two cases and `doorCompCount.test.ts`'s
  helper now check the caller (and band) in as one of the attendees. A new case covers a booked sound tech who
  never came through the door, and that the report's paying equals the breakdown's.
- **T034/T038 — every gate component test stubs the breakdown route.** `gate.anonComment`, `gate.cashCounting`,
  `gate.eventSelector` and `gate.noSubstitute` answered any unknown `/api/events` URL with unrelated data,
  which the page now reads as a breakdown.
- **T038 — the treasurer page's "Comp admissions · Gift-card redemptions" line is replaced** by the breakdown,
  which shows the same two counts; its component test now asserts them there.
- **T041 — two fixes from the browser check**: the active sort button in the checked-in dialog is now styled
  (`[aria-pressed="true"]`), and the Add contact suggestions have a visible label. Details in `plan.md`,
  Verification.
