# Phase 0 research: the Booker's records

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-22

Answered by reading the code on `main` at `efae846`, and by querying the development database where the
answer depended on real data.

## R1 — What does archiving look like, and what is missing?

**Decision**: copy `archiveBand` for venues and performers, and **add the restore it never had** — to all
three.

**Rationale**: `archiveBand` (`src/server/domain/bands/bandService.ts`) sets `archived_at`, is a no-op if
already archived, writes an audit entry, and never touches performers or bookings. `listBands` filters
`isNull(bands.archivedAt)`. That is exactly the shape FR-010 to FR-013 describe — except that **nothing
unarchives a band**. FR-012 requires restoring, so a restore goes in beside each archive.

**Corrects the spec**: FR-020 says bands' behaviour is left as it is, adding only search. It is not quite
true — bands also gains restore. The wording is corrected.

**Alternatives considered**: a `status` enum instead of a nullable timestamp — rejected, it would make
bands the odd one out for no gain. Hard deletion — refused by the spec, and it would falsify history.

## R2 — Which reads must exclude an archived record, and which must not?

**Decision**: gate the places that OFFER a record; leave every place that REPORTS one.

| Read | Gate? |
|---|---|
| `performerService` roster list, the booking pickers | **Yes** — archived is not offered |
| `publicPerformers` / `performerDisplay` (the public roster) | **Yes** (FR-031), matching bands' "public AND not archived" |
| `matchPerformers` (the auto-link queue) | **Yes** — an archived performer is settled, not pending |
| `venueService` list, the event form's venue picker | **Yes** |
| `publicVenues` | **Yes** |
| `reportService` (treasurer), organizer reports, a past event's venue, a past booking's performer | **No** — history must keep naming them (FR-011) |

**Rationale**: the distinction is "would this invite someone to use it again?" rather than "does it
mention the record?". Feature 072 learned the same lesson the hard way with merged contacts: filtering a
retired row out of a HISTORY view loses the record of what happened.

**Alternatives considered**: filtering globally in the query layer — rejected: it would silently blank
past events' venues, which SC-004 forbids.

## R3 — How do venue rents behave today?

**Decision**: keep the append-only design; add only a delete for a row nothing has used.

**Rationale**: `venue_rents` is (venue, series, amount, effective date), and `/api/venue-rents` exposes
**GET and POST only** — there is no PATCH. A rent has always been changed by adding a newer dated row, and
`venueRentAudit` records the history. So clarification Q2's decision ("a change adds a new row from a
date") is what the data already does, and FR-029 needs no code. FR-030's delete is the new part, and it is
guarded: a row may be deleted only when no event could have resolved it.

**A row counts as used** when an event exists for that venue whose date is on or after the row's effective
date, in the row's series (or any series, for a venue-wide row). Conservative on purpose: refusing a
deletion the Booker wanted is recoverable; allowing one that changes a past report is not.

**Alternatives considered**: allowing edits with a warning (Q2 option B) — rejected by Rich; it would also
have meant rewriting `venueRentAudit`'s meaning.

## R4 — Is there one form per record today?

**Decision**: one component per record, used for create and edit. For events, that component already
exists.

**Rationale**: `EventModal` already edits date, start time, venue, label and description — everything
`/events` collects on creation and more. `/events` never opens it: the page's own controls patch only
date, status and rent. So the event half of US1 is mostly *routing an existing component*, not building
one. Venues and performers have no such component; their pages hold a create form plus a scatter of
single-field PATCH buttons, which is the shape to replace.

**Alternatives considered**: separate create and edit forms that share field components — rejected by the
spec (FR-002) and by the evidence: this divergence is exactly how the write-once fields appeared.

## R5 — Why was Clara never linked, and what will link her?

**Decision**: suggest link candidates with `pg_trgm` `similarity()` over `contacts.dedup_normalized`,
reusing the duplicate queue's approach and its 0.4 threshold.

**Rationale**: `matchPerformers` compares `normalizeName(performer.displayName)` to
`contacts.dedup_normalized` for **exact equality**. The live case is a transposition — performer "Clara
Reidlinger", contact "Clara Riedlinger" — so equality finds nothing, the Booker is offered no match, and
the only remaining path creates a second contact for the same person. Measured against the development
database:

| Contact | `similarity` to `clara reidlinger` |
|---|---|
| **Clara Riedlinger** | **0.619** |
| Barbara Clarke | 0.240 |
| Joe Clark | 0.174 |

The right answer scores more than twice the next candidate, and the duplicate queue's existing threshold
(0.4) separates them cleanly. `pg_trgm` is installed in migration `0001`, and `suggestionService` already
scores pairs this way, so this is reuse.

**Also decided**: the "did you mean…?" guard before creating a contact (FR-026) must use this same scoring.
The existing guard in `AddContactDialog` searches by substring (`/api/attendance/search`), which would miss
Riedlinger just as exact matching does — copying it unchanged would reintroduce the bug.

**Alternatives considered**: lowering the exact matcher to a prefix or substring match — rejected: a
substring of "Reidlinger" never appears in "Riedlinger". Levenshtein in application code — rejected:
`pg_trgm` is installed, indexed and already trusted for this exact judgement.

## R6 — What does "send only what changed" require?

**Decision**: nothing on the server; a rule for the forms.

**Rationale**: every relevant PATCH already applies only the fields present in the body — the event route
checks `input.x !== undefined` field by field, and the performer, venue and band routes take partial
schemas. So FR-028 is satisfied as long as each form sends its dirty fields rather than its whole state.
Tests assert the form's request body, not the server's tolerance.

**Alternatives considered**: a version column and conflict detection — ruled out by clarification Q1.

## R7 — What drains the unlinked queue, and how big is it?

**Decision**: settle each performer as it is opened; no bulk tool.

**Rationale**: the development database holds **19** performers with no contact — 5 seed leftovers never
booked, 12 booked once or twice with nothing upcoming, and 2 active (Clara Reidlinger with 9 bookings and 3
still to come; Evan DeSmitt with 1). At that size the "settle it when you open it" rule drains the queue in
a handful of sittings, and keeps it drained: a performer becomes unlinked again whenever their contact is
deleted, because `performers.contact_id` is `ON DELETE SET NULL`.

**Alternatives considered**: a bulk "resolve unlinked performers" screen — rejected as YAGNI for 19 rows,
and it would need building again the first time someone wanted it for one record.

## Open question deferred, not resolved

**The `/events` page keeps its own list and controls.** This feature makes the event form reachable and
complete; whether `/events` survives at all is Booking Central's question, not this one.
