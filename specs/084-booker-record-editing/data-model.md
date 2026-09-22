# Data model: the Booker's records

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Migration 0056 — `archived_at` on venues and performers

One migration, two additive columns, no data change. Latest migration before this feature is
`0055_gate_sale_quantity.sql`.

```sql
ALTER TABLE venues     ADD COLUMN archived_at timestamptz;
ALTER TABLE performers ADD COLUMN archived_at timestamptz;
```

Nullable timestamp, exactly as `bands.archived_at` (feature 008) — null means active, a time means
retired then. No enum, no boolean: the shape already in use wins.

Nothing else changes. `venue_rents` is untouched; `performers.contact_id` keeps its `ON DELETE SET NULL`,
which is what lets a performer become unlinked again later.

## Archived state

| Question | Answer |
|---|---|
| What does archiving mean? | "We do not work with this any more." It is not deletion and destroys nothing (FR-013). |
| Who may? | Whoever may edit the record — `venue.write` for a venue, `performer.write` for a performer or band. No new capability. |
| Reversible? | Yes. Restore clears `archived_at`. Bands gains this too (research R1). |
| In use? | Archiving warns — how many future events or bookings, and the next date — then proceeds on confirmation (FR-014). Existing bookings are untouched. |
| Audited? | Yes, beside `band.deleted`'s entry: archive and restore each write one. |

### Which reads gate on it

**Gated** — these OFFER a record, and must not offer an archived one:

- the performer roster and every booking picker; `matchPerformers`' unlinked queue
- the public roster (`publicPerformers`, `performerDisplay`) — archived is never public, whatever
  `is_public` says (FR-031), the rule bands already follows
- the venue list and the event form's venue picker; `publicVenues`

**Not gated** — these REPORT what happened, and must keep naming the record (FR-011):

- the treasurer and organizer reports
- a past event's venue; a past booking's performer; a band's historical roster

`is_public` is never written by archiving, so restoring a performer restores their public listing without
the Booker having to remember it was set.

## Venue rents — unchanged shape, one new operation

`venue_rents` is already append-only: (venue, series, amount, effective date), with `venue_rent_audit`
recording changes. A rent is CHANGED by adding a newer dated row (FR-029) — which is what the existing
POST does — and the resolver picks the newest row on or before an event's date.

**New**: a rent row may be DELETED when nothing has used it (FR-030). A row counts as **used** when an
event exists at that venue, in that row's series (or any series, for a venue-wide row), whose date falls on
or after the row's effective date. Deliberately conservative: refusing a wanted deletion is recoverable;
allowing one that moves a past report is not.

## Performer ↔ contact

| State | Meaning |
|---|---|
| Linked | Normal. The contact owns the person's email and telephone; the performer form shows them read-only (FR-018). |
| Unlinked | Legacy or orphaned — 19 today, and a new one appears whenever a linked contact is deleted. Settled on opening: link, create, or archive (FR-021). |

**Link candidates** are scored with `pg_trgm` `similarity()` against `contacts.dedup_normalized`, ordered
best first, using the duplicate queue's 0.4 threshold. Measured on the live pair: the right contact scores
0.619, the next candidate 0.240 (research R5). Retired contacts — merged or archived — are never offered,
the rule `matchPerformers` already follows.

## Entities, as this feature leaves them

- **Venue** — name, short name, address, directions, landlord contact, **`archived_at`**, and its rents.
- **Venue rent** — venue, series (nullable = any), amount, effective date. Append-only; deletable only
  while unused.
- **Performer** — display name, biography, public flag, caller flag, styles, promo links, contact link,
  **`archived_at`**.
- **Band** — unchanged but for restore and search.
- **Event** — unchanged. Not archivable: an event is cancelled, which `status` already carries.
