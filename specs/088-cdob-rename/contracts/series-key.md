# Contract: the community dance series key

**Feature**: [../spec.md](../spec.md)

## Addresses that carry a series key

| Address | Before | After |
|---|---|---|
| The organizer report page | `/organizer/community_dance` | `/organizer/cdob` |
| The organizer report read | `GET /api/organizer/community_dance/report` | `GET /api/organizer/cdob/report` |
| The public dance list, filtered | `/whats-on?series=community_dance` | `/whats-on?series=cdob` |
| The public past-dance list, filtered | `/what-was-on?series=community_dance` | `/what-was-on?series=cdob` |

**The old key** is not redirected (FR-007). It behaves as any unknown key: the organizer report
answers "not found"; a public list filtered to it is empty.

## Reads that report a series' key

Every read that returns a dance or a series with its key — the public schedule and event pages, the
events list, the Booker's hub, the gate and organizer reports — returns `cdob` for the community
dance. Nothing else in those responses changes.

## Unchanged

- Thursday Night Contra's organizer report still counts the community dance with it (FR-003).
- The series' name, its sound-tech setting, its colour, photo, landing page and calendar code.
- The keys `tnc`, `ecd`, `general`.
