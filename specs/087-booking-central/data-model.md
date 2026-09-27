# Data model: Booking Central

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Migration 0058 — one note

```sql
ALTER TABLE events ADD COLUMN IF NOT EXISTS note text;
```

Nullable, private to the club's volunteers.

**Corrected at implementation.** The plan proposed a second column, `bookings.notes`. But
`bookings.note` **already exists**, is written by `createBooking` and `patchBooking`, and is edited
through the Notes box in `BookingModal` — so FR-015 was already satisfied. Adding a second column
would have given every booking two notes. The new event column is named `note` to match it.

**`events.description` is not this.** It is the public blurb and renders on the public site, which
is why the Booker's note needs a column of its own rather than the text field already sitting there
(FR-016, research R3). A note typed into `description` would be published; the column exists so that
cannot happen by accident.

The booking's note is **not** added here: `bookings.note` already exists for every booking, and
which bookings show its box is a display decision.

No other schema change. In particular **band membership stays undated** — `band_members` answers
"who is in this band now", and the bookings answer "who played that night" (research R4).

## The row — evolved, not replaced

`BookingsReportRow` already carries most of the hub's row. This feature changes it in three ways.

### Added

| Field | Why |
|---|---|
| `startTime` | the row shows the time |
| `label` | the row shows it, and clicking it opens the dance |
| `venueId` | the short code opens the venue; only the name comes back today |
| `notes` | the dance's note, shown beneath its row |
| `instructor` | FR-003a — booked instructors are surfaced nowhere today |
| each booking's `notes` | shown on caller and band bookings |

### Removed

| Field | Why |
|---|---|
| the `caller`, `band`, `musician` filters | FR-001b — the horizon is the table's only control |
| the `sort` toggle | the table is newest-first, always |

### Changed — and this one is visible

`MUSICIAN_TYPES` includes `open_band_musician` today, so open-band players appear among a dance's
musicians on the existing report. They should never have (Rich, 2026-09-23) — they turn up, they are
not booked and not paid, and naming them among the booked musicians overstates what the club
engaged. FR-007 excludes them. **A row that names one today will stop naming it**, and that is a
defect being corrected rather than a trade being made.

## Paging

The table reads by **keyset**, not offset: a cursor of `(event_date, start_time, id)` descending —
nulls last on the time, matching `listEvents` — with the horizon as the first page's upper bound.

The `id` tie-break is not optional. Two dances share a date routinely (a TNC and a Community Dance
on one evening), and two *can* share a date **and a start time**, told apart only by their venue. A
cursor on date alone drops or repeats one at a page boundary; on date and time it still does for the
same-hour case.

## What a slot being "wanted" means

| Role | Wanted? |
|---|---|
| caller | always |
| music — a band, or musicians | always |
| sound tech | only where the series uses one (`series.has_sound_tech`, already on the row) |
| instructor | never — an addition, not a requirement |

A slot nobody is wanted for is never marked (FR-004a). This is why the English series, which uses no
sound tech, does not show a permanent warning the Booker learns to ignore.

## What must not move

| Thing | Why it is listed here |
|---|---|
| Every role's capabilities | SC-007. This feature moves where work happens, never who may do it |
| Any booking, when a band's membership changes | FR-025, SC-005 — proved, not asserted |
| `events.description` | the public blurb, untouched and still editable by the Webmaster |
| Band membership's shape | undated, deliberately (research R4) |
