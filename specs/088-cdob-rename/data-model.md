# Data Model: The community dance series key becomes `cdob`

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## Series (existing table — one row changes)

| Field | Before | After |
|---|---|---|
| `key` | `community_dance` | **`cdob`** |
| `name` | Community Dance | Community Dance *(unchanged)* |
| `has_sound_tech` | false | false *(unchanged)* |
| `id` | — | *(unchanged — everything that belongs to the series refers to this)* |

`key` stays unique and free text; it is not a database enum (research R1).

**Other series**: `tnc`, `ecd`, `general` — unchanged (FR-009).

## What belongs to the series (unchanged)

Every one of these refers to the series by `id`, so the rename moves none of them (research R2):
dances (`events`), series parameters and their audit, venue rents and their audit, role grants
scoped to the series, admission prices, and quarterly attendance counts. Bookings, attendance, door
records and payments belong to dances, and so to the series through them.

## Migration `0060_cdob_series_key.sql`

Renames the one row's key. Idempotent — a second run finds no `community_dance` row. No other
table is touched.

## `SeriesKey` (new, in code — research R1)

The four keys the club has — `tnc`, `ecd`, `cdob`, `general` — as one hand-maintained list with a
type. It describes the seeded series; it does not constrain the table.
