# Phase 0 research: Booking Central

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-23

Answered by reading the code on `main` at `d7d9561` and by querying the development database where
the answer depended on what is actually recorded.

## R1 — Does the hub's row already exist? *(load-bearing)*

**Decision**: yes. `assembleBookingsReport` becomes the hub's read; it is evolved, not replaced.

**Rationale**: `BookingsReportRow` already answers with `eventId`, `date`, `series`,
`venueShortName`, `hasSoundTech`, `caller`, `band`, `bandId`, `musicians`, `soundTech`, `cancelled`,
and a `bookings` list carrying each booking's id, performer, type and status. That is most of the
hub's row, built for feature 020's report and already tested. Writing a second read alongside it
would put two answers to "who is booked for this dance" in the codebase, which is how they come to
disagree.

**What must be added**: `startTime` and `label` (the row shows both), `venueId` (the short code
opens the venue, and today only the name comes back), the event's note and each booking's note (R3),
and the instructor (FR-003a — currently surfaced nowhere).

**What must be removed, and it is a correction**: `MUSICIAN_TYPES` includes `open_band_musician`
today, so open-band players appear among the musicians on the existing report. They should never
have (Rich, 2026-09-23): they turn up, they are not booked and not paid, and listing them among the
booked musicians overstates what the club engaged. FR-007 removes them. A row will lose a name —
that is a defect being fixed, not a trade being made.

**What must go**: the `caller`, `band`, `musician` and `sort` filters (FR-001b). `series`, `from`
and `to` stay, because the hub needs them for the series and the horizon.

**Alternatives considered**: a new read for the hub, leaving the report's alone — rejected; the
report's page is being deleted, so the two would not coexist for long, and in the meantime they
would drift.

## R2 — How does the table scroll back forever?

**Decision**: keyset pagination on `(event_date, start_time, id)` descending — nulls last on the
time — with the horizon as an upper bound.

**Rationale**: the Booker scrolls back through years. An offset grows a query that must count rows
it will throw away; a cursor does not, and the ordering is already `event_date` descending with `id`
available to break ties on a date with two dances. The horizon (default today + 4 months, FR-001a)
is simply the upper bound of the first page, so "look further ahead" is the same query with a
different ceiling.

**The trap**: two dances share a date routinely — TNC and a Community Dance on the same evening —
and two *can* share a date **and a start time**, distinguished only by venue (Rich, 2026-09-23; none
in the club's data today, so this is anticipation rather than repair). A cursor on the date alone
would skip or repeat one at a page boundary, and a cursor on date and time would still do so for the
same-hour case. The `id` tie-break is not optional.

The ordering also matters for its own sake: `listEvents` already sorts by date then start time
descending, nulls last, so a timed dance outranks an untimed one on the same day. The hub keys on
the same order rather than inventing a second one — two orderings of the same events is how two
screens come to disagree about which is "first".

**Alternatives considered**: offset paging — simpler, and wrong at this shape; loading everything —
fine today at a few hundred dances, and quietly worse every year.

## R3 — Where do the notes live?

**Decision**: one new nullable `text` column, `events.note`. The booking's note **already exists**.

**Rationale**: the spec puts a note on the dance and on caller and band bookings (FR-014, FR-015).
`bookings.note` is already in the schema, already written by `createBooking` and `patchBooking`, and
already edited through the Notes box in `BookingModal` — so FR-015 was satisfied before this feature
began. Only the dance lacks one.

**Corrected at implementation.** This section first decided on *two* columns, `events.notes` and
`bookings.notes`, because the schema was read for `notes` and the existing singular `note` was
missed. A second booking column would have given every booking two notes — the "two answers to one
question" failure this plan warns against everywhere else. The analysis then compounded it, flagging
"booking notes have no way to be written" as critical, when the write path had existed all along.
The lesson recorded for next time: **grep the schema for the concept, not the spelling.**

**The thing to guard**: `events.description` is **the public blurb** — it renders on the public
site. A private note typed into it would be published. That is why FR-016 exists, and why the note
is a new column rather than a reuse of a field that is already there and already text.

**Alternatives considered**: reusing `description` — the trap above; a polymorphic notes table — a
join and an entity for two strings.

## R4 — Should band membership be dated?

**Decision**: no, and the bookings are why.

**Rationale**: `band_members` carries `bandId`, `performerId`, `isLead`, `instrument`, `createdAt` —
no end date, so it answers "who is in this band **now**". That is enough, because **every booking
names its own performer** and a band booking is N bookings, one per member. So "who played on 30
June 2020" is answered by the bookings and cannot be disturbed by editing a band today. The only
thing that drifts when a member leaves is the publicity roster and the next booking's pre-fill —
which is what Rich said, and the code agrees.

**Alternatives considered**: effective-dated membership — a much larger change that buys back a
history the bookings already keep.

## R5 — How does the performer editor serve two pages?

**Decision**: it is already a component. `PerformerForm` is mounted by the performers page today;
the hub and `/payments` each mount the same one.

**Rationale**: absorbing `/manage/performers` would otherwise take performer editing from the
Financial Secretary and the Treasurer, who hold `performer.write` deliberately (B28 — she corrects a
name and adds a substitute payee while recording a payment). Hosting the editor on the page where
she already works keeps that, removes the page, and adds no capability. Each host is reached by its
own capability; the editor's writes still require `performer.write`, which the Booker, the FS and
the Treasurer all hold.

**The consequence for scope**: this feature touches `/payments`, which nothing else in it does.

**Alternatives considered**: keeping the performers page for them — a menu entry saved nothing;
opening the hub to `performer.write` holders — a page called the Booker's hub showing a Financial
Secretary half a screen.

## R6 — Can one box search performers and bands?

**Decision**: yes, as a client-side merge of two calls.

**Rationale**: `GET /api/performers?q=` and `GET /api/bands?q=` both already search **and** browse
when `q` is absent, both return `{ items, truncated }`, and both accept `includeArchived`. At 12
bands and 58 performers a union endpoint would be machinery for nothing. Each result is tagged with
its kind (FR-017) — there are no name collisions in the club's data today, but a band named after
its lead is normal in this music, and a tag added later is a rename.

## R7 — What does "the admin styling" actually require?

**Decision**: a layer over tokens that already exist, applied through `AdminPage`.

**Rationale**: `globals.css` already defines the app-wide vocabulary — ground, surface, band, text,
link, hairline, the series colours, the heading and body fonts. And `(admin)/_components/AdminPage`
already wraps administrative pages. So FR-032/033 is not a design system: it is an administrative
identity built from the existing tokens and defined in one place the other admin pages can adopt
later. Today's bookings report does not even use `AdminPage` — it opens with an inline-styled
`<main>` — so the hub gains the shell that page never had.

**Alternatives considered**: a token set of its own — two vocabularies drifting apart; per-page
styling — the thing being fixed.

## R8 — Which path does the hub take?

**Decision**: `/bookings`, the thin booking list it replaces. `/bookings-report`, `/bands` and
`/manage/performers` are removed.

**Rationale**: the Booker's menu entry keeps a name he knows, and one of the four pages is reused
rather than orphaned. The nav-completeness test then does the enforcing: a removed page with a
lingering menu entry fails, and a surviving page with no entry fails — so "fewer links" cannot be
half-done.

## R9 — How much of the writing is already built? *(load-bearing)*

**Decision**: nearly all of it. US2 and US4 are presentation over tested services.

| The spec asks for | What exists |
|---|---|
| advance a booking's status (FR-011) | `patchBooking` — `PATCH /api/bookings/{id}`, `booking.write` |
| a band's status carries the rest (FR-012) | `patchBooking` **already cascades a band lead** to the band's other bookings |
| fill a gap (FR-013a) | `createBooking` — `POST /api/events/{id}/bookings` |
| book a whole band | `POST /api/events/{id}/book-band` |
| substitute a performer (US4) | `substitutePerformer` |
| the dance's bookings (US4) | `getBookingsForEvent` — `GET /api/events/{id}/bookings` |
| which roles a dance wants | `listEventRoles` |

**What this changes about the plan**: the new server work is four things — the row's additions, the
cursor, a performer's booking history, and the note columns. Everything else is a screen over
services that already have tests. The stop-at-confirmed rule (FR-011) is therefore a **client**
constraint over a service that can still set any status, which is correct — declining must remain
possible, just not by repeating a click — and is why the test for it belongs at the component level.

## Live data, checked rather than assumed

- **12 bands, 58 performers, no name collisions** — so tagging search results is prevention, not
  repair.
- **18 performers with no contact**, and **one** linked to an archived contact — US5's worklist,
  already measured.
- **Each Booker handles one series** today (Peggy Dempsey → ecd, PeggyTBD → tnc), so the two-series
  case is real but not yet exercised.
