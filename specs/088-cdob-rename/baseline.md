# Baseline: before the `cdob` rename

**Feature**: [spec.md](./spec.md) | **Task**: T001 | **Captured**: 2026-09-28, dev database, dev
server stopped

What SC-002 and SC-003 are checked against. The counts were read per series; the Thursday Night
Contra organizer reports were produced by the report's own code and saved whole, so the check after
the change is a diff with the old key read as the new one.

## Records per series

| Series key | Dances | Bookings | Attendance | Door records | Payments | Parameters |
|---|---|---|---|---|---|---|
| `community_dance` | 4 | 13 | 23 | 3 | 2 | 5 |
| `ecd` | 18 | 34 | 13 | 6 | 3 | 11 |
| `general` | 0 | 0 | 0 | 0 | 0 | 5 |
| `tnc` | 38 | 142 | 249 | 12 | 31 | 15 |

## Thursday Night Contra's organizer report

| Year | Fingerprint (SHA-256, first 16) | Size |
|---|---|---|
| 2025 | `0cf30fc1b8874ecb` | 38,735 |
| 2026 | `7815e4b47a05ea94` | 38,868 |

The report names the community dance's key four times (it counts the community dance with TNC), so
after the change its fingerprint differs by those four words alone; the saved reports are compared
with `community_dance` read as `cdob`.

## After the change (T029, 2026-09-28)

Captured the same way, after migration `0060`:

| Series key | Dances | Bookings | Attendance | Door records | Payments | Parameters |
|---|---|---|---|---|---|---|
| `cdob` | 4 | 13 | 23 | 3 | 2 | 5 |
| `ecd` | 18 | 34 | 13 | 6 | 3 | 11 |
| `general` | 0 | 0 | 0 | 0 | 0 | 5 |
| `tnc` | 38 | 142 | 249 | 12 | 31 | 15 |

The community dance's row is the same row under its new key, with every record still attached
(SC-002). Thursday Night Contra's organizer reports for 2025 and 2026 are **identical** to the
saved ones once `community_dance` is read as `cdob` (SC-003) — each is 44 characters shorter: the
key's four occurrences, eleven characters shorter each.
