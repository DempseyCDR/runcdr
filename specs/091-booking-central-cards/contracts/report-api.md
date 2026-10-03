# Contract: `GET /api/bookings/report`

Booking Central's read (feature 087), paged both ways from a split date (feature 091, research R1).
Requires `base` — any signed-in volunteer, unchanged.

## Query

| Parameter | Form | Default | Meaning |
|---|---|---|---|
| `series` | one series key, or several comma-separated (`tnc,cdob`) | every series | the dances of any of them |
| `split` | `YYYY-MM-DD` | none | `older` reads dances **before** it; `newer` reads dances **on or after** it |
| `direction` | `older` or `newer` | `older` | which way from `split` (or from `cursor`) |
| `cursor` | opaque | none | continue from the last page in the **same** direction |
| `limit` | 1–200 | every row | rows in this page |
| ~~`horizon`~~ | — | — | **retired**: no longer read |

Validated with a Zod schema (research R8). A malformed `split`, an unknown `direction`, a `limit`
outside 1–200 or a cursor that does not decode answers **422** `VALIDATION_ERROR` with the reason
— the project's code for a malformed request (`errors.validation`), logged by the request wrapper.

## Answer (200)

```json
{ "rows": [ /* BookingsReportRow */ ], "nextCursor": "opaque or null" }
```

- `older`: rows newest first; `nextCursor` continues further back.
- `newer`: rows **nearest first** (ascending); `nextCursor` continues further ahead. The client
  reverses them to show newest first.
- `nextCursor` is `null` when there are no more rows that way.

## Guarantees (each an integration test)

| # | Guarantee |
|---|---|
| A1 | Paging `older` from `split` to the end lists every dance dated before `split` exactly once, newest first. |
| A2 | Paging `newer` from `split` to the end lists every dance dated on or after `split` exactly once, nearest first. |
| A3 | Together, A1 and A2 list every dance of the series exactly once — including several on one day, and dances sharing a date and a time. |
| A4 | The first `newer` row is the first dance dated `split` or later; with none, the first `older` row is the most recent. |
| A5 | `series` narrows both directions; cancelled dances are included and flagged, as today. |
| A6 | `horizon` is ignored; bad `split`, `direction`, `limit` or `cursor` answer 422. |
| A7 | A `base` volunteer may read it (unchanged). |
