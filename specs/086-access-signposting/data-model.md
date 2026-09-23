# Data model: Everyone can reach their own work

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## No schema change, no migration

Nothing here stores anything new. A grant has carried a series since the role model was built; a
contact has carried its archived state since feature 084. This feature changes what is **reported**
and what is **permitted**, not what is recorded.

## What moves

### The capability map — one entry added

| Role | Capability | Scope | Why |
|---|---|---|---|
| `booker` | `contact.write` | global | The unlinked-performer question offers the Booker "create the contact", and creating one requires it (FR-001). Global because contacts are not series-scoped — the same reason the Financial Secretary holds it that way |

Nothing else in the map changes. That is not a remark, it is FR-009 and SC-005, and it gets a test.

### The volunteer read — each grant says what it covers

`listVolunteers` returns, per grant, `{ id, role, seriesId, groupId }`. A series **id** is a UUID,
which is why the access screen prints `series-scoped` and stops: it has nothing else to print.

| Field | Before | After |
|---|---|---|
| `seriesId` | uuid \| null | unchanged — still the identifier |
| `seriesKey` | — | **added**: the series' key, or null for a club-wide or group-scoped grant |
| `seriesName` | — | **added**: the series' name, for the screen to show a person rather than a slug |

A read that reports a grant should report what the grant covers. Resolving an id at every reader is
how two readers come to disagree.

### A new capability — who, not which series

`treasurer_report.read` is added to the capability vocabulary and held **club-wide** by:

| Role | Holds it | Why |
|---|---|---|
| `financial_secretary` | yes | the report is her own work read back — and she covers for the other Financial Secretary, so it is not confined by series |
| `treasurer` | yes | one Treasurer, the whole club's books |
| `president` | yes | officer oversight of the club's money |
| `vice_president` | yes | as President |
| `super_user` | yes | holds everything — and the test harness signs in as one (research R7) |
| `booker` | yes | negotiates performer fees, so what an evening took and paid out is their business (added at the walk-through, 2026-09-23) |
| `door_attendant`, `webmaster`, `mailing_list_manager`, `secretary` | **no** | not their work |

| Thing | Before | After |
|---|---|---|
| Reading `GET /api/events/{id}/treasurer-report` | `base` — any signed-in volunteer | `treasurer_report.read` |
| The `/treasurer` menu entry | `treasurer_report.write` — Treasurer and Super-user only | `treasurer_report.read` |

### The viewer's own series — a default, not a gate

| Thing | Before | After |
|---|---|---|
| `/api/me/capabilities` | booleans only | **plus** the series ids the viewer holds a role for, and whether any grant is club-wide |
| The shared event selector | the series filter starts at "any series" | starts narrowed to the viewer's series, on the gate report, gate money and payments |
| Check-in | — | **unchanged**, deliberately |

The narrowing decides what the list **starts** at. It never decides what may be opened: a Financial
Secretary covering for the other widens the filter and reads that evening, because the capability
was never confined by series. Keeping those two ideas apart is the whole design — an earlier draft
merged them and made a fill-in impossible.

## What must not move

| Thing | Why it is listed here |
|---|---|
| The report's CONTENTS | Unchanged (FR-006b). This feature decides who may open the report, nothing about what it says |
| `contact.delete` | A different capability. The Booker gains the ability to write, not to destroy (FR-002) |
| Every other role's capabilities | FR-009. A feature that hands out a permission is the wrong place to be casual, so the guard is a test over the whole map, not an inspection |
| The grant rules | Multi-series already works (research R4). US5 changes the screen, not the service's decisions |
| Which evenings may be OPENED | Decided by the capability rules alone. A filter's starting value is presentation and must never become a permission (FR-014) |

## The two page contracts

- **A contact named in the address**: arriving at the directory with a contact named opens that
  contact — the same record the list rows open, by the same path. Archived opens too, showing that
  it is archived; one such contact exists in the club's data today.
- **A link that opens beside its form**: the performer's contact link opens in a new tab, so the
  form it sits inside keeps its unsaved edits (FR-004a).
