# Research: Mobile door check-in

**Feature**: 079-mobile-door-checkin | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md)

Thirteen decisions. R1 and R2 are the spine: one function computes an event's attendance breakdown for all
four places it appears, and a small rollup keeps it true after the purge. The rest are the door screen.

## R1 — One breakdown function, read by all four surfaces

**Decision**: a new `getAttendanceBreakdown(db, eventId)` in `src/server/domain/attendance/` returns the
whole breakdown — attendance, paying, children, performers checked in by kind, door attendant, comps, gift
cards, and any double bookings. The door's checked-in dialog and the gate page read it through a new
`GET /api/events/{id}/attendance-breakdown`; the treasurer report embeds it in its existing response; the
organizer report takes its paying figure from it. One client component, `AttendanceBreakdownView`, renders it
on the three screens.

**Rationale**: FR-027 and SC-004 require the figures to be identical everywhere. Today the paying formula
lives in the organizer report alone (`payingDancers` in `danceResult.ts`, fed by `computeEventGate`), and
the treasurer report reads the raw comp count separately. Four surfaces computing or rendering it
separately is exactly the drift feature 072 found between two copies of one rule. `payingDancers` stays as
the arithmetic; only its performer argument changes (R3).

**Alternatives considered**: extend `computeEventGate` — rejected, it is the door record's *money* and
returns zeros when no door record exists, while a free event with check-ins still has attendance. Compute
on the client from the roster — rejected, the roster is purged and the organizer report has no client.

## R2 — Surviving the purge: roll up what the purge deletes, derive the rest

**Decision**: a new table `event_attendance_rollups` (one row per event, created on first need) holding the
figures that are otherwise derived from check-in rows: children, and performers checked in by kind (caller,
band, sound tech, instructor). `purgeOldAttendance` adds the counts for the rows it is about to delete, in
the same transaction, before deleting them. The breakdown is **rollup + derived from the rows still
present**. Everything else it needs is already kept: `events.attendance_count`, and the door record's comp,
open-band and gift-card counts.

**Rationale**: FR-029 needs children and checked-in performers to outlive the rows they come from. FR-030
needs the performer figures to follow booking changes while the rows exist. Deriving live answers FR-030
for free — bookings are read at display time — and the rollup freezes the figures only at the moment the
evidence is destroyed. The purge is the **one** write path, so nothing can drift. Adding rather than
overwriting handles an event whose check-ins straddle two purge runs (the cutoff is a timestamp, and an
evening's check-ins span hours).

**Consequence, recorded in the spec**: after the purge, the performer figures are frozen — a booking changed
more than 90 days after the event no longer moves them, and the double-booking warning (R10) is no longer
shown, since it rests on check-ins that no longer exist. FR-030 is scoped to "while the event's check-ins
are retained".

**Alternatives considered**:

- **Maintain counters on every write** — check-in, correction, move, delete, *and* every booking add,
  removal, kind change and re-point, plus merges relinking contacts and performers. Rejected: a dozen write
  paths, several outside attendance, the drift risk 072 and 078 both paid for.
- **Store the performer kind on the check-in row** — rejected: goes stale when bookings change after
  check-in (FR-030), and is purged anyway.
- **Columns on `events`** — rejected: five purge-only columns on the most-read table; a separate row keyed by
  event keeps the rollup visibly the purge's.
- **Columns on `door_records`** — rejected: door records exist only once money or counts are recorded; a
  free event's check-ins have none.

## R3 — Performers checked in: the booking's contact, once per person

**Decision**: a performer is checked in when a check-in for the event has the contact of a performer booked
**for that event** (`bookings.event_id`), in any booking status. Counted **per contact**, once, under the
first matching kind: `caller`; band = `lead_musician`, `musician`, `open_band_musician`; `sound_tech`;
`instructor`. `payingDancers(attendance, performersCheckedIn, comps)` keeps its floor at zero.

**Rationale**: the organizer report counts distinct performers across all bookings today; the spec changes
that to checked-in only (FR-023/FR-024). Counting per contact rather than per performer record also
catches one person with two performer records booked on one event. A performer with no contact can never
match — deferred to the booker's workflow (spec, Out of Scope).

**Effect on existing tests**: `organizer.report.test.ts` books performers without checking them in and
expects them subtracted. Those expectations change with the rule; they are updated, not deleted.

## R4 — Search results: event-aware, with names and addresses the door needs

**Decision**: `GET /api/attendance/search` gains an optional `eventId`. Each item gains `firstName`,
`lastName`, `displayNameOverride` (names are not PII), `checkedIn` (when `eventId` is given), `emails` as
**reachable** addresses — active or in transition, the same set the email-owner check treats as owned
(R6) — with personal purpose first, and `reachedVia` — the owner's display name and address —
for a contact who rides a household address (067). Addresses and `reachedVia.address` stay PII-gated
exactly as today.

**Rationale**: FR-005–FR-007. The checkmark must come from the server, which knows every attendant's
check-ins (MEG-R6). Today's route attaches every address, retired ones included.

**Alternatives considered**: mark checked-in on the client from the loaded roster — rejected, the roster is
not loaded on the page any more (it moves into a dialog) and another attendant's check-ins would be missed.

## R5 — The name rule, shared

**Decision**: move `PairContactName` to a shared `ContactName` component and use it for search results, the
Add contact suggestions and the checked-in dialog. The two contacts-page uses import the moved component.

**Rationale**: FR-005 is feature 076's rule, which lives in that one component. A second copy at the door is
the drift 076 was written to prevent. Its prop type is already structural (`displayName`, `firstName`,
`lastName`, `displayNameOverride`).

## R6 — An email that belongs to someone else: ask, then act

**Decision**: the new-contact path checks for an owner of the address (status `active` or `transition`, the
same set the uniqueness index guards) **before** creating anything. If one exists and the request does not
say how to treat it, it refuses with the existing `409 EMAIL_ACTIVE_ELSEWHERE`, whose payload already names
the other contact and the email id (feature 066). The dialog then offers:

- **(a) That person** → checks the existing contact in (`contactId`), with the extras row.
- **(b) A different person sharing it** → resubmits the new contact with `shareEmail: true`: the contact is
  created **without** owning the address and linked to it as its message recipient, then checked in — one
  transaction.
- **(c) A mistake** → back to the form, email field focused. Nothing is sent.

The silent `UNIQUE_VIOLATION` swallow is removed; a race that reaches the index is refused the same way.

**Rationale**: FR-016/FR-017; SC-003. Checking first means nothing is created until Meg answers. Linking
reuses `linkMessageRecipient`'s rules (no self-reference, target reachable, the referrer owns no working
address — trivially true for a contact just created without one), made callable inside a transaction.

**Authority**: linking at creation needs no `contact.mailing.write`, which a door attendant does not hold.
It is part of recording the walk-in's address, which `contact.write` + `attendance.write` already cover
today — the difference is only whether the contact owns the address or rides it. Linking an **existing**
contact stays `contact.mailing.write`.

## R7 — "Did you mean…?" in Add contact

**Decision**: the dialog calls the same search endpoint (with `eventId`) as Meg types — the first and last
name together, or the email once it has an `@` — debounced, and lists at most five matches using
`ContactName`, each with **Check in** (or the checkmark).

**Rationale**: FR-014, with no new endpoint: the X-R3 search already matches names and email prefixes.

## R8 — The extras row

**Decision**: one piece of page state — children, comp, gift card, open band — sent with whichever check-in
happens next and reset **only after that check-in succeeds** (a refused check-in keeps it). Open band
appears only at a community dance. The Add contact dialog shows what the extras row will apply ("With: 2
children · comp"), since the row is behind the dialog. Check in anonymously is disabled while open band is
ticked, with the hint that open band needs a name — the server already refuses open band on an anonymous
check-in.

**Rationale**: FR-009, FR-012. Resetting on success only means a refused check-in never loses what Meg set.

## R9 — Confirming the event

**Decision**: an `EventConfirm` header shows the selected event large (date, series, start time, label),
with **Change** revealing the existing `EventSelector`. It warns when the event's date is not **the device's
local date**. The selector's default ("most recent event on or before today") switches from the UTC date to
the same local date.

**Rationale**: FR-003. The door phone is at the venue, so its local date is the evening's date. The
selector computes "today" with `toISOString()`, which is UTC: after 8 pm Eastern that is tomorrow, which
would make the new warning fire on the evening's own event.

## R10 — Double bookings

**Decision**: the breakdown lists each checked-in contact booked more than once for the event, with their
display name and every kind booked. `AttendanceBreakdownView` shows one warning line per entry beneath the
counts. Check-in never consults it.

**Rationale**: FR-033/FR-034. Performer names are not PII; the roster already shows names to every
volunteer.

## R11 — The checked-in dialog's list

**Decision**: `listEventAttendance` gains a `display` sort (display name, then first, then last) and returns
`displayNameOverride`. The route keeps `last` as its default so existing callers do not change; the dialog
asks for `display`.

**Rationale**: FR-018. Corrections (FR-020) reuse `CorrectionModal`'s calls unchanged, opened from a row.

## R12 — Layout and ergonomics

**Decision**: a mobile-first CSS module for the page and its dialogs, replacing today's inline styles. The
dialogs follow the contacts page's pattern (backdrop, a sized panel, `RecordView` inside). The top region —
event, search, extras row, Check in anonymously, Add contact, Show checked in — is compact enough to fit on
a medium phone, 390 × 844 points, within the roughly 700 points the page sees once the browser's bars take
their share, with the on-screen keyboard closed; results scroll beneath. At 360 wide and 375 × 667 it must
still work without horizontal scrolling. Enter in the search box checks
in the top result unless it is checked in (FR-010). A check-in reaching the database's unique index in a
race is mapped to `ALREADY_CHECKED_IN`.

**Rationale**: FR-001–FR-004, SC-001/SC-002. Verified in the browser at a phone viewport (quickstart), since
"above the fold" cannot be proven in jsdom.

## R13 — Who may see the breakdown

**Decision**: `GET /api/events/{id}/attendance-breakdown` declares `requires: "base"`, like the roster read
and the treasurer report it sits beside. It carries counts and performer names only.

**Rationale**: FR-027 puts it on three screens used by three roles; none of its content is PII.
