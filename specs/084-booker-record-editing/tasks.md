---

description: "Task list for feature 084 — the Booker's records"
---

# Tasks: The Booker's records — edit anything, find it by name, archive it

**Input**: Design documents from `/specs/084-booker-record-editing/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/records.md](./contracts/records.md),
[quickstart.md](./quickstart.md)

**Tests**: MANDATORY. Constitution Principle I (Test-First): each test task below is written and seen to
FAIL before the implementation task that follows it.

**Organization**: by user story, in priority order. US1 alone is a shippable MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 — from [spec.md](./spec.md)

## Path Conventions

One Next.js app: `src/app` (pages, modals, routes), `src/server` (schema, domain, auth), `tests/integration`
(real Postgres), `tests/component` (jsdom), `tests/unit`.

**Never run the suite or a migration while a dev server is running.**

---

## Phase 1: Setup

- [X] T001 Confirm the tree is on `084-booker-record-editing`, clean, and `pnpm vitest run` is green before
      any change — the baseline this feature must not break
- [X] T002 Re-read the four claims the plan rests on, and stop to correct [research.md](./research.md) if
      any has changed: `archiveBand` has no restore (`src/server/domain/bands/bandService.ts`);
      `/api/venue-rents` has GET and POST only; `searchPerformers` already exists
      (`src/server/domain/performers/performerService.ts`, feature 020) and `GET /api/performers` serves
      it; `EventModal` already edits label, description, start time, date and venue

---

## Phase 2: Foundational (blocking)

**Purpose**: the archived column every later story reads. US1 can start in parallel with this; US3, US4
and the search's "include archived" cannot.

- [X] T003 Write `tests/integration/migration.archiveColumns.test.ts` FIRST: `venues.archived_at` and
      `performers.archived_at` exist and are nullable, both default null for existing rows, and the
      migration re-runs without error. Confirm it fails against the current schema
- [X] T004 Create `src/server/db/migrations/0056_archive_venues_performers.sql` adding the two nullable
      `timestamptz` columns, and add `archivedAt` to `src/server/db/schema/venues.ts` and
      `src/server/db/schema/performers.ts`, matching `bands.archivedAt`. Run `pnpm db:migrate`; T003 passes

**Checkpoint**: the column exists; stories may proceed.

---

## Phase 3: User Story 1 — Change anything the record holds (Priority: P1) 🎯 MVP

**Goal**: every field a venue, performer or event holds is editable after creation, in the form that
created it, sending only what changed.

**Independent Test**: create a venue, a performer and an event; reopen each; change every field; confirm
each is kept.

### Tests for User Story 1 ⚠️ write first, see them fail

- [X] T005 [P] [US1] Write `tests/component/venueForm.test.tsx`: one form serves create and edit; every
      field the record holds is present in both; saving after changing one field sends ONLY that field
      (FR-028); a field the viewer may not change is rendered disabled and not sent (FR-003)
- [X] T006 [P] [US1] Write `tests/component/performerForm.test.tsx`: the same three rules; plus email and
      telephone shown read-only with a link to the linked contact, and absent rather than empty when there
      is no contact (FR-018, FR-019)
- [X] T007 [P] [US1] Extend `tests/component/eventModal.test.tsx`: label, description and start time are
      editable and sent; a change to one field sends only that field
- [X] T008 [P] [US1] Extend `tests/integration/venues.test.ts` and `tests/integration/performers.contact.test.ts`:
      a PATCH carrying one field leaves the others untouched, for venues and performers

### Implementation for User Story 1

- [X] T009 [US1] Rebuild `src/app/(admin)/venues/page.tsx` around one venue form — name, short name,
      address, directions, landlord — used for create and edit, replacing the per-field PATCH buttons.
      Send only dirty fields; T005 passes
- [X] T010 [US1] Rebuild `src/app/(admin)/manage/performers/page.tsx` around one performer form — display
      name, biography, public and caller flags, styles, promo links — with the contact's email and
      telephone read-only beside a link to that contact. T006 passes
- [X] T011 [US1] Open `EventModal` from `src/app/(admin)/events/page.tsx` for editing an existing event,
      retiring the page's single-field controls; keep the create path. T007 passes
- [X] T012 [US1] Run the three component files and the two integration files; all green

**Checkpoint**: nothing is write-once. Shippable on its own.

---

## Phase 4: User Story 2 — Find a performer or a band by name (Priority: P2)

**Goal**: the performers and bands pages are search-led, like the contact directory.

**Independent Test**: with many performers present, open the page, type part of a name, confirm sorted
matches and no roster before typing.

### Tests for User Story 2 ⚠️ write first, see them fail

- [X] T013 [P] [US2] Extend `tests/integration/performerSearch.test.ts`: with `q`, `GET /api/performers`
      returns matches ordered by name and `{ items, truncated }`, `truncated: true` past the limit
      (FR-007). **With no `q` it still returns the roster** — three pages depend on that (`bookings`,
      `bands`, `bookings-report`), so assert it explicitly as a guard rather than changing it. FR-005 is a
      rule about the PAGE, not the endpoint (analysis F1)
- [X] T014 [P] [US2] Write `tests/integration/bandSearch.test.ts`: the same contract for `GET /api/bands`,
      including that a request with no `q` still returns the roster its existing callers read
- [X] T015 [P] [US2] Write `tests/component/performersPage.search.test.tsx`: the search box has focus on
      open, no roster is listed, typing lists matches, a truncated result says so, and no match offers to
      create that performer carrying the typed name (FR-008, FR-009)

### Implementation for User Story 2

- [X] T016 [US2] Extend `searchPerformers` in `src/server/domain/performers/performerService.ts` to return
      `{ items, truncated }` — fetching one past the limit, as `withTruncation` does in
      `src/server/domain/contacts/contactService.ts`. Keep the existing `bookedAs` behaviour the booking
      typeahead depends on, and keep browse-on-empty. **Archived filtering is not done here** — T026 owns
      it, for every read at once (analysis F2)
- [X] T017 [US2] Add the equivalent search to `src/server/domain/bands/bandService.ts`
- [X] T018 [US2] Update `src/app/api/performers/route.ts` and `src/app/api/bands/route.ts` to carry
      `truncated` alongside `items`, and to accept `?archived=1`. **Do NOT change what a request with no
      `q` returns**: `bookings/page.tsx`, `bands/page.tsx` and `bookings-report/page.tsx` all fetch the
      roster that way (analysis F1). Adding a field to the answer is safe — every caller already reads
      `.items`. Run `tests/component/bookingModal.addPerformer.test.tsx` and
      `tests/integration/performerSearch.test.ts` before moving on, rather than waiting for T046
- [X] T019 [US2] Make `src/app/(admin)/manage/performers/page.tsx` and `src/app/(admin)/bands/page.tsx`
      search-led: they stop fetching the roster on open and fetch only once a query is typed. This is where
      FR-005 is satisfied — on the page, leaving every other caller of the endpoint untouched. T015 passes

**Checkpoint**: neither page lists a roster; both find by name.

---

## Phase 5: User Story 3 — Retire what is no longer used (Priority: P3)

**Goal**: venues, performers and bands can be archived and restored; history keeps naming them.

**Independent Test**: archive a venue, confirm it is no longer offered, and confirm a past event still
names it.

### Tests for User Story 3 ⚠️ write first, see them fail

- [X] T020 [P] [US3] Write `tests/integration/archive.venues.test.ts`: archiving removes the venue from
      `listVenues` and from `publicVenues`, leaves a past event naming it (FR-011), is a no-op when already
      archived, and is undone by restore. Archiving a venue with future events answers **409** without
      `confirm` — naming how many and the next date — and succeeds with it (FR-014)
- [X] T021 [P] [US3] Write `tests/integration/archive.performers.test.ts`: the same for performers —
      absent from `listPerformers`, from `searchPerformers`, from `matchPerformers`' unlinked queue and
      from the public roster **whatever `is_public` says** (FR-031); still named by a past booking; the
      public flag is untouched, so restoring restores the listing
- [X] T022 [P] [US3] Extend `tests/integration/bands.delete.test.ts` for the restore bands never had
      (research R1, correcting FR-020)
- [X] T023 [P] [US3] Extend `tests/integration/treasurer.report.test.ts` (or the venue-rent report test):
      a report naming an archived venue is unchanged — the rule that history is never gated. In the same
      file, assert FR-004: a venue RENAMED after an event still reads with its new name in that event's
      report (analysis C3)
- [X] T023a [P] [US3] Extend `tests/integration/bands.crud.test.ts`: a band whose member has been archived
      still lists that member in its roster, while the member picker no longer offers them — gating
      `listPerformers` must not blank an existing roster (analysis C2, FR-011)

### Implementation for User Story 3

- [X] T024 [US3] Add archive and restore to `src/server/domain/venues/venueService.ts` and
      `src/server/domain/performers/performerService.ts`, and restore to
      `src/server/domain/bands/bandService.ts`, each following `archiveBand`: no-op when already in that
      state, an audit entry either way, never touching bookings or events
- [X] T025 [US3] Add the "in use" count each archive warns with — future events for a venue, future
      bookings for a performer or band — and the `confirm` gate that 409s without it
- [X] T026 [US3] Gate the reads that OFFER a record, per [data-model.md](./data-model.md): `listVenues`,
      `listPerformers`, `searchPerformers` (the `archived` flag lands here, not in T016 — analysis F2),
      `matchPerformers`, `publicVenues`, `publicPerformers`, `performerDisplay`. **Leave every read that
      REPORTS one alone** — treasurer and organizer reports, a past event's venue, a past booking's
      performer, and a band's existing roster (T023a)
- [X] T027 [US3] Add the routes: `POST /api/venues/[id]/archive` and `/restore`,
      `POST /api/performers/[id]/archive` and `/restore`, `POST /api/bands/[id]/restore`
- [X] T027a [US3] Extend `tests/integration/authz.routes.test.ts` (or the nearest authz file) for the new
      routes: archive and restore refuse a volunteer without `venue.write` / `performer.write`, as does
      `DELETE /api/venue-rents/{id}`, and `GET /api/performers/{id}/link-suggestions` refuses one without
      `performer.write`. Every new route declares `withAuth` — `auth.routeInventory.test.ts` fails
      otherwise (analysis C1)
- [X] T028 [US3] Add the archive and restore controls to the venue, performer and band forms, with the
      warning dialog; T020–T023a and T027a pass

**Checkpoint**: retiring works and history is intact.

---

## Phase 6: User Story 4 — A performer with no contact gets resolved (Priority: P4)

**Goal**: opening an unlinked performer settles it — link, create, or archive — with suggestions that
survive a misspelling.

**Independent Test**: open Clara Reidlinger; confirm Clara Riedlinger is offered first; link her.

### Tests for User Story 4 ⚠️ write first, see them fail

- [X] T029 [P] [US4] Write `tests/integration/performerLinkSuggestions.test.ts`: for a performer named
      "Clara Reidlinger" and a contact "Clara Riedlinger", the contact is offered FIRST — the transposition
      the exact matcher misses (research R5) — scored with `similarity()` over `contacts.dedup_normalized`
      at the duplicate queue's threshold; a merged or archived contact is never offered; no candidate is a
      valid empty answer
- [X] T030 [P] [US4] Write `tests/component/performerLinkQuestion.test.tsx`: an unlinked performer shows
      the three choices before the rest of the form (FR-021, FR-024); suggestions appear first; creating a
      contact carries the performer's name and returns to the form (FR-023); a linked performer is never
      asked (FR-025); where the names differ, the contact's spelling is offered and can be declined
      (FR-027)
- [X] T031 [P] [US4] Extend `tests/integration/performers.contact.test.ts`: creating a contact from the
      question links it, subscribes the person to no mailing list, and is refused the chance to create a
      near-duplicate silently — the near-match is returned for the Booker to judge (FR-026)

### Implementation for User Story 4

- [X] T032 [US4] Create `src/server/domain/performers/linkSuggestions.ts` — candidates by
      `similarity(contacts.dedup_normalized, normalizeName(performer.displayName))`, best first, excluding
      merged and archived contacts, reusing the threshold in
      `src/server/domain/dedup/suggestionService.ts` rather than inventing a second one
- [X] T033 [US4] Add `GET /api/performers/[id]/link-suggestions`
- [X] T034 [US4] Build the three-choice question into the performer form, blocking the rest of it, with the
      "did you mean…?" guard on the create path using the SAME scoring — not the substring search
      `AddContactDialog` uses, which would miss Riedlinger exactly as the old matcher does
- [X] T035 [US4] Offer the contact's spelling for the performer's display name when they differ, declinable;
      T029–T031 pass

**Checkpoint**: the queue deferred since feature 072 drains as records are opened.

---

## Phase 7: User Story 5 — Rents live with the venue (Priority: P5)

**Goal**: a venue's rents are managed on the venue; the separate page and its menu entry go.

**Independent Test**: open a venue, add a rent from a date, confirm events resolve it and older events do
not change.

### Tests for User Story 5 ⚠️ write first, see them fail

- [X] T036 [P] [US5] Write `tests/integration/venueRent.delete.test.ts`: `DELETE /api/venue-rents/{id}`
      removes a rent no event has used; refuses with **409** naming what uses it when an event at that
      venue falls on or after its effective date (FR-030); the audit records the removal
- [X] T037 [P] [US5] Extend `tests/integration/venueRent.precedence.test.ts`: adding a rent from a date
      changes what later events resolve and leaves earlier events resolving exactly what they did (FR-029,
      SC-006)
- [X] T038 [P] [US5] Write `tests/component/venueRents.section.test.tsx`: the venue form lists rents —
      series, amount, effective date, newest first — says "none set" where there is none, adds a rent from
      a chosen date, and offers delete only while unused
- [X] T039 [P] [US5] Extend `tests/integration/authz.nav.test.ts`: the volunteer menu no longer offers a
      venue-rents destination (FR-017)

### Implementation for User Story 5

- [X] T040 [US5] Add the "used by an event" check and the delete to the venue-rent domain code, with its
      audit entry
- [X] T041 [US5] Add `DELETE /api/venue-rents/[id]`; T036 passes
- [X] T042 [US5] Add the rents section to the venue form in `src/app/(admin)/venues/page.tsx`; T038 passes
- [X] T043 [US5] Delete `src/app/(admin)/venue-rents/page.tsx` and remove its entry from
      `src/server/auth/nav.ts`; T039 passes. Check nothing links to `/venue-rents` before deleting it

**Checkpoint**: one page fewer, one menu entry fewer, no rent figure changed.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T044 [P] Run `pnpm exec eslint` and `pnpm exec prettier --check` on the changed files only
- [X] T045 [P] Add a backlog row to `specs/BACKLOG.md` for anything found and deliberately not fixed —
      and name the new audit entries `venue.archived` / `performer.archived` / `*.restored`, leaving
      `band.deleted`'s existing name alone rather than rewriting history's vocabulary (analysis I1)
- [X] T046 Run `pnpm tsc --noEmit`, then the full `pnpm vitest run` with **no dev server running**, then
      `pnpm build` and `pnpm lint:md`
- [X] T047 Walk [quickstart.md](./quickstart.md) §1–§3 and §5 in the browser, at laptop width and at
      390 × 844
- [X] T048 Walk quickstart §4 — **Clara**: open the performer, confirm the contact is offered first,
      link her, accept the spelling correction, and confirm all 9 bookings read correctly afterwards. This
      is the feature's live test, so record what actually happened in **Deviations**
- [X] T049 Record any departure from the design documents in **Deviations** below, and correct the document
      it departs from
- [X] T050 Commit as one commit on `084-booker-record-editing` and open the PR (ask first)

---

## Dependencies

```text
Setup (T001–T002)
        │
        ▼
Foundational (T003–T004)  ── archived_at; blocks US3, US4's archive choice, US2's archived filter
        │
        ├─────────────► US1 (T005–T012)  ── can start before the migration lands
        │
        ▼
US2 (T013–T019) ──► US3 (T020–T028) ──► US4 (T029–T035)
        │
        ▼
US5 (T036–T043)  ── independent of US2–US4; needs US1's venue form for T042
        │
        ▼
Polish (T044–T050)
```

- **US1 is independent of the migration** — it can be built while T003/T004 are in flight.
- **US4 needs US3**, because "archive the performer" is one of its three answers.
- **US5 needs only US1**, for the form its rents section sits in.
- **T018 is the risky one**: `/api/performers` serves the booking modal's typeahead AND the roster that
  `bookings`, `bands` and `bookings-report` fetch with no `q`. Add to its answer; never take away.
- **Archived filtering has one owner, T026** — US2 lands search and truncation, US3 lands the gating for
  every read at once (analysis F2).

## Parallel execution examples

```text
US1 tests:   T005 (venue form) ║ T006 (performer form) ║ T007 (event modal) ║ T008 (integration)
US2 tests:   T013 (performers) ║ T014 (bands) ║ T015 (page)
US3 tests:   T020 (venues) ║ T021 (performers) ║ T022 (bands) ║ T023 (reports)
US4 tests:   T029 (suggestions) ║ T030 (the question) ║ T031 (creating a contact)
US5 tests:   T036 (delete) ║ T037 (precedence) ║ T038 (section) ║ T039 (nav)
```

## Implementation strategy

**MVP = Phase 1 + Phase 3 (US1).** Eight tasks make every field editable, which is the complaint that
started this. Each later story is a self-contained increment on the same forms.

Two rules hold throughout: **history is never gated** — if a read reports what happened, an archived record
must still appear in it — and **no rent figure any report resolves may change** for unchanged data
(SC-006). A task that seems to require either is a task that has misread the plan.

## Deviations

- **FR-018 cannot be met as written — the form LINKS to the contact instead of showing the email and
  telephone.** Those belong to the contact record, and feature 016 keeps contact email and telephone
  behind `contact.pii.read` while the performer payload is `base`-readable; putting them on the performer
  would leak PII to every volunteer. The spec is corrected, and the honest fix if the Booker really needs
  the number in front of them is backlog **B56** (a PII-gated read on the performer detail, as the
  existing `mailto` route already does for email).
- **Truncation is computed at the route, not inside `searchPerformers` (T016).** Only the route and one
  test call that function, and the test calls it directly expecting an array; the `{ items, truncated }`
  shape is the ENDPOINT's contract. `listPerformers` also gained ordering by name — the roster was
  returning insertion order, which FR-006 asks not to.
- **`EventModal` now sends only what changed, and an existing assertion was rewritten.** That test
  asserted an unchanged `startTime` is re-sent as "19:30" — the normalisation that fixed a live 422.
  With partial saves the field is not sent at all, so the 422 is impossible rather than handled; the test
  now asserts no PATCH is made when nothing changed. `performersPage.nameCapture.test.tsx` likewise opens
  the create form from "Add a performer" first; its assertion (the POST body's structured name) is
  unchanged.
- **The performer form's CREATE mode keeps the contact fields** (first name, last name, display name,
  email, telephone), because creating a performer creates the contact behind them (feature 026). FR-002
  holds for every *performer* field; those four are contact fields, and afterwards they are edited on the
  contact (FR-018).
- **"Include archived" was built, not deferred.** It was briefly filed as a backlog row, which understated
  it: without the switch, archiving a venue is a ONE-WAY DOOR in the app — the hall leaves the list and
  nothing can restore it. FR-012 says otherwise, so `/api/venues` gained `?archived=1` alongside the
  performers and bands endpoints, and all three pages have the switch.
- **`venue-rents` stays in `content.ts`'s reserved slugs** even though the page is gone: freeing it would
  let a content page answer an old bookmark, which is worse than a 404.
- **Hooks hoisted to file level in `performers.contact.test.ts`** — a second `describe` with its own
  `afterAll(closeDb)` closes the pool before the first block runs (the CONNECTION_ENDED trap from 082).
- **Deleting a page leaves stale `.next` type files** that fail `tsc` until `.next/types` and
  `.next/dev/types` are removed. Worth knowing the next time a route goes.
- **New backlog rows**: **B55** (the volunteer menu's stylesheet, from 083's research) and **B56** above.
- **The browser walk (T047) found a bug the component tests could not.** The search endpoint answers with
  SUMMARIES — id and display name — and the page passed that row straight into the form. With no
  `contactId` and no `archivedAt` on it, every performer looked unlinked (the link question appeared for
  all of them) and archived ("Archived. Restore" on a live record). The tests missed it because they
  passed whole objects. The page now loads the record with `GET /api/performers/{id}` before opening the
  form, `getPerformer` carries the linked contact's display NAME for the link-out (never the PII), and
  `performersPage.search.test.tsx` asserts the detail fetch.
- **T048 — Clara is settled.** Opening the performer "Clara Reidlinger" offered the contact "Clara
  Riedlinger" first, exactly as research R5 predicted from the 0.619 / 0.240 scores; linking her and
  accepting the spelling left one performer, one contact, the correct name and all 9 bookings. The
  unlinked queue is 19 → 18.
