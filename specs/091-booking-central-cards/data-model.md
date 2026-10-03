# Data Model: Booking Central on a phone

**No schema change.** Nothing new is stored; this feature changes how one read pages and how one
page arranges what it reads.

## Dance (read model, unchanged)

`BookingsReportRow` in `src/server/domain/bookings/reportService.ts` — one per dance: event id,
date, start time, label, series name, venue id and **name** (feature 091: the full name, in place of
020's short code, which fit only the retired table's column), whether the series wants a sound tech,
caller, instructor, band (name, id), musicians, sound tech, cancelled, the Booker's note, and its
booking lines (booking id, performer, type, state, note, band id). Every presentation — row, card,
opened dance — is built from this one shape.

## The read's order, in both directions

| Direction | Dances | Order | Continued by |
|---|---|---|---|
| `older` | `event_date < split` (all, when no split) | `event_date desc, start_time desc nulls last, id desc` | `afterCursor` — rows after the cursor in this order |
| `newer` | `event_date >= split` | `event_date asc, start_time asc nulls first, id asc` — the exact reverse | `beforeCursor` — rows after the cursor in this order (before it in the older order) |

- The two directions **partition** the dances of a series at `split`: each dance is in exactly one.
- The cursor is the last row's `(date, time, id)`, opaque to the client, as feature 087 made it.
- A page of `limit` rows is fetched as `limit + 1` to know whether another exists (unchanged).

## The default dance (derived, not stored)

The first row of the first `newer` page from today — the nearest dance dated today or later — or, if
that page is empty, the first row of the first `older` page — the most recent (spec FR-007,
research R2).

## Page state (client)

| State | Meaning |
|---|---|
| `split` | today on the device's date, fixed when the page opens |
| `newer` rows, `newerCursor` | the dances loaded at or after `split`, nearest first; `null` cursor = no more ahead |
| `older` rows, `olderCursor` | the dances loaded before `split`, newest first; `null` cursor = no more behind |
| `positioned` | the opening scroll has happened; until then the top sentinel does not load |
| `wide` | `min-width: 48rem` matches — the live, wide cards; otherwise the phone's cards |
| `short` | `max-height: 450px` matches — the header's search and prompt behind Performers (FR-018) |

The list shows `newer` reversed, then `older`: newest first throughout.
