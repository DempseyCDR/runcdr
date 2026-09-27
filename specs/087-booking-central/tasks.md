# Tasks: Booking Central — the Booker's hub

**Feature**: 087-booking-central | **Branch**: `087-booking-central`

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/hub.md](./contracts/hub.md),
[quickstart.md](./quickstart.md)

**Tests**: included — Test-First is a constitution principle, and this feature deletes four pages.
Two guarantees are **properties, not examples**, and are tested as such: the status control can
never decline anyone however many times it is clicked, and a band's membership change never touches
a booking.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 from [spec.md](./spec.md)

---

## Phase 1: Setup

**Purpose**: the migration, and the guard that this feature moves work without moving authority.

- [X] T001 Write `src/server/db/migrations/0058_booking_notes.sql` adding a nullable `note` to `events` only — `bookings.note` **already exists** and is already edited in `BookingModal`, so a second booking column would give a booking two notes. Comment why it is NOT `events.description` (the public blurb)
- [X] T002 Run `pnpm db:migrate`, then confirm `tests/integration/authz.capabilityMap.test.ts` (from feature 086) still passes — it pins the whole role → capability map, and SC-007 says this feature changes none of it
- [X] T003 [P] Record today's menu entries in `tests/integration/authz.nav.test.ts` as the baseline for SC-004: the Booker is offered bookings, the bookings report, bands, performers, events and venues

**Checkpoint**: the notes exist, the capability map is pinned, and the menu's starting shape is
written down so losing four entries is provable.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the hub's read. Every story renders it, so it lands once, first, and correctly.

- [X] T004 Add failing cases to `tests/integration/bookings.report.test.ts` for the row's new fields: `startTime`, `label`, `venueId`, the event's `note`, each booking's **existing** `note`, and the `instructor` (FR-003a)
- [X] T005 Add a failing case to `tests/integration/bookings.report.test.ts` asserting an **open-band musician is absent** from a row's musicians (FR-007) — they appear today and never should have, so a row losing a name here is a defect being corrected
- [X] T006 [P] Add a failing case in `tests/integration/events.publicPayload.test.ts` asserting the public event read carries `description` and **never** `note` — separating them is the only reason the column exists (FR-016)
- [X] T007 Add failing cases for the cursor in `tests/integration/bookings.report.test.ts`: paging back returns every dance exactly once, **including two dances on one date**, and **two dances at the same date AND start time** told apart only by venue (research R2)
- [X] T008 Extend `BookingsReportRow` and `assembleBookingsReport` in `src/server/domain/bookings/reportService.ts` with the new fields, and drop `open_band_musician` from `MUSICIAN_TYPES`
- [X] T009 Replace the report's filters in `src/server/domain/bookings/reportService.ts`: remove `caller`, `band`, `musician` and `sort`; keep `series`, and take a horizon plus a cursor instead (FR-001b)
- [X] T010 Implement keyset paging in `src/server/domain/bookings/reportService.ts` ordered by `(event_date, start_time, id)` descending, nulls last on the time — **the same order `listEvents` uses**, so two screens cannot disagree about which dance is first
- [X] T011 Update `src/app/api/bookings/report/route.ts` to take the horizon and cursor and answer with a page plus the next cursor
- [X] T012 Run `pnpm vitest run tests/integration/bookings` — green. Any existing report test that expected an open-band musician among the musicians is asserting the defect and must be corrected, with the reason in its comment

**Checkpoint**: one read answers the hub's row, pages without losing a dance, and no longer pretends
open-band players are booked.

---

## Phase 3: User Story 1 — The season on one page (P1)

**Goal**: the Booker reads his season in the app instead of the spreadsheet.

**Independent test**: open the hub as a Booker and compare a month against the spreadsheet — same
dances, same people, same gaps, same order.

- [X] T013 [P] [US1] Add failing component cases in `tests/component/bookingCentral.table.test.tsx`: one row per dance, newest first, date · time · label · venue, the series named at the head
- [X] T014 [P] [US1] Add failing cases in the same file for the gaps (FR-004, FR-004a): an unbooked caller and unbooked music are marked; a sound tech is marked **only** where `hasSoundTech`; an instructor **never** marks a gap
- [X] T015 [P] [US1] Add failing cases in `tests/component/bookingCentral.table.test.tsx`: a cancelled dance says so **in words**, not by colour alone (FR-005), and one asserting the dance's note renders beneath its row
- [X] T016 [P] [US1] Add a failing case in `tests/component/bookingCentral.table.test.tsx` asserting the instructor is named in the caller's cell, and that the caller comes first when both are booked (FR-003a)
- [X] T017 [US1] Build the hub's table at `src/app/(admin)/bookings/page.tsx`, replacing the thin booking list
- [X] T018 [US1] Give `src/app/(admin)/bookings/page.tsx` the four things above the table and no more (FR-001c): the series name, the horizon control, the search box, the count of performers needing a contact
- [X] T019 [US1] Implement the horizon control in `src/app/(admin)/bookings/page.tsx` — default today + 4 months, pushable further out (FR-001a)
- [X] T020 [US1] Implement infinite scroll in `src/app/(admin)/bookings/page.tsx` against the cursor from T009, loading older dances as the Booker reaches the foot
- [X] T021 [US1] Establish the administrative identity in `src/app/(admin)/_components/AdminPage.module.css` from the tokens already in `src/app/globals.css` — defined once so other admin pages can adopt it later (FR-032, FR-033, research R7)
- [X] T022 [US1] Apply it to `src/app/(admin)/bookings/page.tsx`, the first page to use it — today's bookings report has no admin shell at all
- [X] T023 [US1] Run `pnpm vitest run tests/component/bookingCentral` — green

**Checkpoint**: the spreadsheet is readable in the app. US1 ships even with nothing clickable.

---

## Phase 4: User Story 2 — Work the row (P2)

**Goal**: the Booker acts from the row he is looking at.

**Independent test**: from one row reach the dance, the venue and each booking, advance a status,
and fill a gap — without leaving the hub.

- [X] T024 [P] [US2] Add a failing component case in `tests/component/bookingCentral.row.test.tsx`: clicking the label opens the dance; clicking the venue's short code opens the venue
- [X] T025 [P] [US2] Add a failing case in `tests/component/bookingCentral.row.test.tsx`: clicking a caller's or loose musician's name opens **that booking**; clicking a band's name opens **that dance's band bookings** (FR-009, FR-010)
- [X] T026 [US2] Add the **property** test for FR-011 in `tests/component/bookingCentral.row.test.tsx`: click a status control twenty times and assert it reaches confirmed and **never** declined. Assert the final status, not the click count — the guarantee is that no sequence of ordinary clicks can decline a performer
- [X] T027 [P] [US2] Add a failing case for FR-013a in `tests/component/bookingCentral.row.test.tsx`: clicking the mark in an empty caller cell begins a caller booking for that dance, without navigation
- [X] T028 [P] [US2] Add a case in `tests/component/bookingCentral.booking.test.tsx` confirming the booking editor the hub opens is the existing `BookingModal`, whose **Notes** box already writes `bookings.note` (FR-015) — this verifies reuse; it is not new behaviour
- [X] T029 [P] [US2] Add a failing case in `tests/component/bookingCentral.event.test.tsx`: the dance's editor shows a notes box, saving it keeps the note, and the note is **absent** from the events page's form (FR-014 — the blurb is shared, the note is the Booker's)
- [X] T030 [US2] Implement the row's click targets in `src/app/(admin)/bookings/page.tsx`, opening the existing event, venue and booking editors
- [X] T031 [US2] Open caller and band bookings from the hub in the existing `src/app/(admin)/_modals/BookingModal.tsx`, whose Notes box already satisfies FR-015 — **no new notes box is built**. Treat an empty string as no note when reading, since 51 bookings carry `''` today
- [X] T032 [US2] Add a note box to `src/app/(admin)/_modals/EventModal.tsx` and persist it through the existing event write (FR-014), shown in the hub's editor and **not** on the events page's form — without this the event note has a column, a row and a place to be read, and nowhere to be written
- [X] T033 [US2] Implement the status control, advancing proposed → requested → tentative → confirmed via `PATCH /api/bookings/{id}` and stopping there (the service can still set any status; the stop is the control's — research R9)
- [X] T034 [US2] Wire a band's status control to the lead's booking, relying on `patchBooking`'s **existing** cascade rather than looping in the client (FR-012)
- [X] T035 [US2] Make the gap mark open a new booking for that dance and role via `POST /api/events/{id}/bookings`, pre-filled (FR-013a)
- [X] T036 [US2] Confirm the hub offers **no** way to create a dance, and that `/events` remains in the Booker's menu for that (FR-013b)
- [X] T037 [US2] Run `pnpm vitest run tests/component/bookingCentral`

**Checkpoint**: a view has become a workplace, and a stray click cannot decline anyone.

---

## Phase 5: User Story 3 — Performers and bands live here (P3)

**Goal**: the hub absorbs performers and bands. Three pages are deleted.

**Independent test**: from the hub, find a performer, read their history, reach a band, change its
membership — visiting no other page — and confirm no booking moved.

- [X] T038 [P] [US3] Add failing cases in `tests/integration/performerHistory.test.ts`: a performer's dances, played and booked, newest first
- [X] T039 [US3] Add `src/server/domain/bookings/performerHistory.ts` — the read US3 and the phone surface will share
- [X] T040 [P] [US3] Add failing component cases in `tests/component/bookingCentral.search.test.tsx`: one box returns performers **and** bands, each tagged with its kind; archived are absent until asked for (FR-017, FR-018)
- [X] T041 [US3] Implement the combined search in the hub as a merge of `GET /api/performers?q=` and `GET /api/bands?q=` — both already search and browse (research R6)
- [X] T042 [P] [US3] Add failing component cases in `tests/component/bandRoster.test.tsx`: members shown with **checkboxes**, the lead with a **radio**; unticking a member removes them; searching adds one
- [X] T043 [US3] Add the failing case for FR-023 in `tests/component/bandRoster.test.tsx`: unticking the **lead** leaves the band with no lead, stated plainly — never a lead who is not a member
- [X] T044 [US3] Add the failing case for FR-024 in `tests/component/bandRoster.test.tsx`: a band with no lead offers the members **who have an email address** to contact, and says so plainly when none has one
- [X] T045 [US3] Add the **property** test for FR-025 in `tests/integration/bands.membership.test.ts`: record every booking's performer and status, change a band's membership, and assert **every** booking is byte-identical — past and future. This is what the undated-membership decision rests on (research R4)
- [X] T046 [US3] Extract the band roster editor from `src/app/(admin)/bands/page.tsx` into a component the hub mounts, keeping its existing add/remove/set-lead logic and adding the clear-lead-on-removal rule
- [X] T046a [US3] Offer **New band “…”** from the hub search when nothing matches, opening the roster editor on an empty band carrying the typed name — `/bands` was the only place a band could be created, and deleting it must not take that with it (FR-031). The server rule becomes **at most one** lead (FR-022): `tests/unit/bands.roster.test.ts` is flipped to accept a lead-less roster, deliberately
- [X] T047 [US3] Mount `PerformerForm` from the hub — it already takes `{performer, readOnly, initialName, onSaved, onClose}` and needs no change to be hosted (research R5)
- [X] T047a [US3] Port what `tests/component/performersPage.search.test.tsx` and `performersPage.nameCapture.test.tsx` prove onto the hub — the full record is loaded before the form opens, **New performer “…”** carries the typed name, the truncated notice, and the structured name capture — then retire both files with the page (T053)
- [X] T048 [P] [US3] Add failing component cases in `tests/component/performerCard.test.tsx`: a performer's history button lists their dances, and their bands button lists each band and leads to it (FR-019, FR-020)
- [X] T049 [US3] Add the performer's history and bands buttons to the hub's host of that form in `src/app/(admin)/bookings/page.tsx`, each band leading to the roster editor (FR-019, FR-020)
- [X] T050 [P] [US3] Add a failing case in `tests/component/payments.performerEditor.test.tsx` asserting a volunteer **without** performer-editing is refused from BOTH hosts — the editor moving pages widened nothing (FR-030b)
- [X] T051 [US3] Add a failing-then-passing case in `tests/component/payments.performerEditor.test.tsx`: a Financial Secretary can open and save a performer from the payments page
- [X] T052 [US3] Mount the **same** `PerformerForm` on `src/app/(admin)/payments/page.tsx` so the Financial Secretary and Treasurer keep the editing they hold today (FR-030a)
- [X] T053 [US3] Delete `src/app/(admin)/bookings-report/`, `src/app/(admin)/bands/` and `src/app/(admin)/manage/performers/`, and remove their entries from `src/server/auth/nav.ts`
- [X] T054 [US3] Run `pnpm vitest run tests/integration/authz.nav.test.ts tests/integration/auth.navCompleteness.test.ts` — a deleted page with a lingering entry fails, and so does a surviving page with none, so this proves the absorption is complete rather than half-done

**Checkpoint**: four menu entries have become one, and nobody has lost a capability.

---

## Phase 6: User Story 4 — The evening's lineup changes (P4)

**Goal**: a fiddler drops out on the Tuesday and the Booker fixes that evening without touching the
band.

**Independent test**: decline one member of a booked band, substitute another performer, and confirm
the band's membership and the other members' bookings are untouched.

- [X] T055 [P] [US4] Add failing component cases in `tests/component/bandLineup.test.tsx`: a dance's band bookings list every member separately with their own status and pay
- [X] T056 [US4] Add the failing case in `tests/component/bandLineup.test.tsx`: declining one member changes **only** that booking (FR-025 adjacent — the cascade must not fire for a non-lead)
- [X] T057 [US4] Add the failing case in `tests/component/bandLineup.test.tsx`: substituting a performer books them for that dance and leaves the band's membership **unchanged**
- [X] T058 [US4] Build the band-lineup surface, reading `GET /api/events/{id}/bookings` and writing through the existing `substitutePerformer` and `patchBooking` (research R9 — no new service)
- [X] T058a [US4] Carry the **band re-point** (feature 024 US2, `POST /api/events/{id}/repoint-band`) and **add a musician** beside a booked band into the lineup panel — both lived only on the bookings report. Port `tests/component/bookingsReport.bandRepoint.test.tsx` to the hub and retire `bookingsReport.test.tsx` once each case is covered by `bookingCentral.*` or deliberately dropped (the sort toggle, FR-001b)
- [X] T059 [US4] Add an integration case in `tests/integration/bookings.report.test.ts` asserting a past dance, read after a substitution, reports **who actually played** (FR's history property)
- [X] T060 [US4] Run `pnpm vitest run tests/component/bandLineup.test.tsx tests/integration/bookings`

**Checkpoint**: the case the status control deliberately cannot do now has a home.

---

## Phase 7: User Story 5 — The performers who need a contact (P5)

**Goal**: B57 and B58 close.

**Independent test**: list the performers needing a contact, settle one, and re-point one whose
contact is archived — with no booking disturbed.

- [X] T061 [P] [US5] Add failing cases in `tests/integration/performers.needContact.test.ts`: the read counts and lists performers with **no** contact, and those whose contact is **archived or merged** (B57, B58)
- [X] T062 [US5] Implement that read in `src/server/domain/performers/` and expose it for the hub's count
- [X] T063 [US5] Show the count above the table in `src/app/(admin)/bookings/page.tsx` as an invitation to the work (FR-001c, FR-026)
- [X] T064 [P] [US5] Add a failing component case in `tests/component/performerCard.test.tsx`: a performer whose contact is **archived or merged** raises the settle-it question, worded for a retired link (FR-027, B58)
- [X] T065 [US5] Raise the existing settle-it question for a performer whose contact is **archived or merged**, worded for a retired link rather than a missing one (FR-027) — `LinkQuestion` is gated on `!contactId` today
- [X] T066 [US5] Add the case in `tests/integration/performers.needContact.test.ts` asserting re-pointing a performer's contact disturbs **no** booking (FR-028)
- [X] T067 [US5] Run `pnpm vitest run tests/integration/performers`

**Checkpoint**: the eighteen are workable from the hub, and Catherine Sloboda can be corrected.

---

## Phase 8: Polish & Close-out

- [X] T068 Run the full gates with the dev server stopped: `pnpm db:migrate`, `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`
- [X] T069 [P] Run `pnpm exec eslint` and `pnpm exec prettier --check` on the changed code files only, and `pnpm exec markdownlint-cli2 --fix` plus `pnpm lint:md` on the changed markdown
- [X] T070 Walk [quickstart.md](./quickstart.md) §1–§5 as a **Booker** (Peggy Dempsey holds ecd, PeggyTBD holds tnc — a Super-user proves nothing about what the Booker was given)
- [ ] T071 Walk the quickstart's closing guard as the **Financial Secretary**, the **Treasurer**, the **Webmaster** and the **Booker** in turn — four pages were deleted and four capabilities were nearly deleted with them during specification alone
- [X] T072 Update `specs/BACKLOG.md`: mark **B57** and **B58** done with this feature number
- [X] T073 Tick this task and T074 **before** committing, then make one atomic commit for the feature — never amend and force-push a pushed branch merely to mark a step complete
- [X] T074 Push the branch and open the pull request against `main`

---

## Dependencies

```text
Phase 1 (migration + guards) → Phase 2 (the hub's read)
                                  ├→ Phase 3  US1  the table            ← MVP ends here
                                  ├→ Phase 4  US2  work the row
                                  ├→ Phase 5  US3  absorb performers/bands
                                  ├→ Phase 6  US4  the lineup
                                  └→ Phase 7  US5  the contacts worklist
                                                        → Phase 8
```

- **Phase 2 blocks everything.** Every story renders the same row; building it once is what keeps
  two answers to "who is booked" out of the codebase.
- **US1 blocks US2** — you cannot click a row that is not drawn. The rest are independent of each
  other.
- **US3 deletes three pages**, so it must land whole: T053 and T054 are one act, not two.
- **US5 depends on US1's header** for its count (T063), but its read and its question (T061–T065) do
  not.

## Parallel opportunities

- **Phase 3**: T013–T016 are four independent component cases before any of the page exists.
- **Phase 5**: T038/T040/T042 are three separate test files; T047 and T052 mount the same component
  in two places and touch different pages.
- **Phase 7**: T061 is independent of everything in US1–US4.
- **Across stories**: US4 and US5 share no files and could be done by two people at once.

## Implementation strategy

**MVP = Phases 1–3 (US1).** The Booker can read his season in the app. Nothing is clickable and the
spreadsheet is still open beside him — but the question he actually asks, *where are the holes?*, is
answered.

**Then US2**, which is what stops him going back to the spreadsheet to act. **US3** is the
absorption and the only phase that deletes anything. **US4** and **US5** are the long tail.

**The three ways this ships looking right and being wrong**:

1. **T026 written as an example instead of a property.** "Click four times, expect confirmed" passes
   while a fifth click declines someone. Click many more times than the cycle is long, and assert
   the status — that is the guarantee FR-011 actually makes.
2. **T045 skipped because it seems obvious.** The whole undated-membership decision rests on
   bookings being untouched by a roster change. It is obvious from the schema and it is exactly the
   kind of obvious thing that a later convenience — "update the band's bookings when the lineup
   changes" — quietly breaks.
3. **T054 treated as a formality.** The nav guard is the only mechanical proof that the absorption
   is complete. Four capabilities were nearly lost during specification alone; T071 is the human
   half of the same check, and neither substitutes for the other.

## Task count

| Phase | Tasks | Story |
|---|---|---|
| 1 — Setup | T001–T003 (3) | — |
| 2 — The hub's read | T004–T012 (9) | — |
| 3 — The season on one page | T013–T023 (11) | US1 |
| 4 — Work the row | T024–T037 (14) | US2 |
| 5 — Performers and bands | T038–T054 (17) | US3 |
| 6 — The evening's lineup | T055–T060 (6) | US4 |
| 7 — The contacts worklist | T061–T067 (7) | US5 |
| 8 — Polish | T068–T074 (7) | — |
| **Total** | **74** | |
