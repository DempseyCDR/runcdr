# Contract: Booking Central

**Feature**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md)

## The table read — narrowed and paged

| Aspect | Contract |
|---|---|
| Requires | `base` to read, as the report does today |
| Takes | the series, a horizon (upper bound, default today + 4 months), and a cursor |
| No longer takes | a caller, band or musician filter, or a sort toggle (FR-001b) |
| Answers with | a page of rows, newest first, and a cursor for the next page |
| Each row carries | date, start time, label, venue short name **and id**, whether the series uses a sound tech, the caller, the instructor, the band, the musicians, the sound tech, whether it is cancelled, the dance's note, and every booking's id, performer, type, status and note |
| Ordering | `(date, id)` descending — the id tie-break is required, two dances share a date routinely |
| Open-band musicians | **absent** (FR-007). They appear on today's report and will stop appearing |

## The writes — reused unchanged

None of these is new. The hub is a screen over services that already exist and are tested.

| Act | Endpoint | Requires |
|---|---|---|
| Advance a status | `PATCH /api/bookings/{id}` | `booking.write` |
| A band's lead carries the band | same — the cascade is already in the service | `booking.write` |
| Fill a gap | `POST /api/events/{id}/bookings` | `booking.write` |
| Book a whole band | `POST /api/events/{id}/book-band` | `booking.write` |
| Substitute a performer | the substitution service | `booking.write` |
| Cancel, revive or delete a dance | `PATCH /api/events/{id}` `{status}`, `DELETE /api/events/{id}` — carried from the events page, each confirmed first; the form's own button is **Close** | `event.write` |
| Re-point a dance to another band | `POST /api/events/{id}/repoint-band` — carried from the bookings report (T058a) | `booking.write` |
| Create or edit a band, its roster and lead | `POST /api/bands`, `PATCH /api/bands/{id}` — carried from the bands page | `performer.write` |
| Read a dance's bookings | `GET /api/events/{id}/bookings` | `base` |
| Edit a performer | the existing performer write | `performer.write` |

**The stop-at-confirmed rule is the client's** (FR-011). The service can still set any status,
because declining must remain possible — just never by repeating the ordinary click. So that
guarantee is proved where it lives, in the control.

## New reads

| Read | Contract |
|---|---|
| A performer's dances | `GET /api/performers/{id}/history` — every dance they have played and are booked to play, newest first, declined kept. `base`. Shared with the phone surface when it comes |
| A performer's bands | `GET /api/bands?performer={id}` — each band with whether they lead it; archived bands **listed and marked**, as a report of the person (FR-020). `base` |
| The performers needing a contact | `GET /api/performers/needing-contact` — `{count, items: [{id, displayName, reason}]}`, reason `none`, `archived` or `merged`; archived performers left out (FR-026, B57/B58). `base` |
| Whether a performer's contact is retired | `contactRetired` on `GET /api/performers/{id}`: `archived`, `merged` or null (FR-027) |
| Whether the viewer may edit performers | `performerWrite` on `GET /api/me/capabilities` — each host offers the editor editable only to a holder (FR-030b) |

## One rule relaxed

A band's roster needs at least one member and **at most one** lead — no longer exactly one (FR-022,
FR-023). Removing the lead leaves the band with no lead, said plainly; two leads are still refused.
`tests/unit/bands.roster.test.ts` was flipped deliberately to say so.

## The page

| Above the table | the series name, the horizon control, the search, the count of performers needing a contact — **and nothing else** (FR-001c) |
|---|---|
| An unfilled slot | marked, and **clicking the mark begins a booking** for that dance in that role (FR-013a) |
| A cancelled dance | distinguishable **in words**, not by colour alone (FR-005) |
| A new dance | not creatable here — made on the events page (FR-013b) |
| Clicking a name | opens **that booking** |
| Clicking a band | opens **that dance's band bookings** |

## Hosted elsewhere

| Surface | Contract |
|---|---|
| `/payments` | hosts the **same** performer editor, so the Financial Secretary and the Treasurer keep the editing they hold today (FR-030a) |
| `/events` | unchanged, and kept — the Webmaster's only way to edit the public blurb, and where new dances are made |
| `/venues` | unchanged, and kept for the Treasurer |

## Removed

`/bookings-report`, `/bands` and `/manage/performers` are **deleted**, and `/bookings` becomes the
hub. Four menu entries out, one in.

A deleted page with a lingering menu entry fails the nav-completeness test, and so does a surviving
page with no entry — so this cannot be half-done.

## What a test may rely on

- The row carries the instructor, and carries **no** open-band musician.
- Two dances on one date both appear, across a page boundary.
- The status control cannot reach declined, however many times it is clicked.
- Advancing a band's status moves every member's booking.
- Changing a band's membership leaves **every** booking untouched, past and future.
- A slot is marked only where someone is wanted — never a sound tech in a series that uses none.
- The Financial Secretary can edit a performer from `/payments`, with no performers page in the
  menu.
- Every role's capabilities are exactly as they were.
