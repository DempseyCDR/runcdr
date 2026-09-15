# Data Model: Mobile door check-in

**Feature**: 079-mobile-door-checkin | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

One new table. Everything else is read from what exists.

## New: `event_attendance_rollups` (migration `0050`)

What an event's check-ins said, kept after the purge deletes them (research R2). One row per event, created
the first time the purge removes any of that event's check-ins; counts are **added** on each purge run.

| Column | Type | Notes |
|---|---|---|
| event_id | uuid PK → events(id) ON DELETE CASCADE | goes with its event |
| children_count | integer NOT NULL default 0 | sum of `attendance.children_count` over purged rows |
| caller_count | integer NOT NULL default 0 | purged check-ins that were a booked caller |
| band_count | integer NOT NULL default 0 | …a booked lead musician, musician or open-band musician |
| sound_tech_count | integer NOT NULL default 0 | …a booked sound tech |
| instructor_count | integer NOT NULL default 0 | …a booked instructor |
| updated_at | timestamptz NOT NULL default `now()` | last purge that added to it |

- **Written only by** `purgeOldAttendance`, inside its existing transaction, before the delete.
- **CHECK** every count ≥ 0.
- A contact counts under one kind (research R3), so the four performer counts never double-count a person.

## Read, unchanged

| Source | Used for |
|---|---|
| `events.attendance_count` | attendance (children included), already kept through the purge |
| `door_records.comp_count` + `open_band_count` | comps |
| `door_records.gift_card_redemption_count` | gift cards |
| `attendance` rows still present | children, performers checked in, double bookings |
| `bookings` (event, performer, performer_type) + `performers.contact_id` | which check-ins are performers, and of what kind |
| `contacts`, `contact_emails` (status, purposes), `contacts.message_recipient_email_id` | search results and suggestions |

## Derived: the attendance breakdown

Computed by `getAttendanceBreakdown(db, eventId)`; never stored.

| Figure | Definition |
|---|---|
| attendance | `events.attendance_count` |
| children | rollup `children_count` + Σ `children_count` over present check-ins |
| caller, band, soundTech, instructor | rollup count + present check-ins whose contact is booked for the event, counted once per contact under the first matching kind (caller → band → sound tech → instructor) |
| performers | caller + band + soundTech + instructor |
| doorAttendant | 1 |
| comps | `comp_count` + `open_band_count` (0 with no door record) |
| giftCards | `gift_card_redemption_count` (0 with no door record) |
| paying | max(0, attendance − performers − doorAttendant − comps) |
| doubleBookings | present checked-in contacts booked more than once for the event: `{ contactId, displayName, kinds[] }` |

**Display rule**: sound tech and instructor are shown only when non-zero (FR-025). Caller and band are always
shown.

**Invariant** (SC-005): whenever paying > 0, paying + performers + doorAttendant + comps = attendance.

## Changed behaviour on existing rows

- **New contact at the door** with an email owned (active or transition) by another contact: no longer
  inserted without the address. Either refused with `EMAIL_ACTIVE_ELSEWHERE`, or — with `shareEmail` —
  created owning no address and pointed at the owner's email through `message_recipient_email_id`, in one
  transaction with its check-in.
- **Organizer report**: paying dancers subtract performers checked in, not all booked performers.
