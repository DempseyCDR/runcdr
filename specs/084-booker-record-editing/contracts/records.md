# Contract: the Booker's records

**Feature**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md)

## Routes — new

| Route | Requires | Contract |
|---|---|---|
| `POST /api/venues/{id}/archive` | `venue.write` | Sets `archived_at`; no-op if already archived; audited. Body `{ "confirm": true }` is required when the venue has future events — without it, **409** naming how many and the next date (FR-014) |
| `POST /api/venues/{id}/restore` | `venue.write` | Clears `archived_at`; no-op if active; audited |
| `POST /api/performers/{id}/archive` | `performer.write` | As above, counting future bookings |
| `POST /api/performers/{id}/restore` | `performer.write` | As above |
| `POST /api/bands/{id}/restore` | `performer.write` | The restore bands never had (research R1) |
| `GET /api/performers/{id}/link-suggestions` | `performer.write` | Contacts most likely to be this performer, best first, scored by name likeness with the duplicate queue's threshold. Never offers a merged or archived contact. Empty list is a valid answer |
| `DELETE /api/venue-rents/{id}` | `venue.write` | Removes a rent **no event has used**; **409** with what uses it otherwise (FR-030). Audited |

## Routes — changed

| Route | Change |
|---|---|
| `GET /api/performers` | Takes `?q=` (name, case-insensitive) and `?archived=1`. Without `q`, returns **no roster** — an empty list, not everyone (FR-005). Returns `{ items, truncated }`, 20 at a time, ordered by name |
| `GET /api/bands` | The same, and keeps excluding archived bands unless asked |
| `GET /api/venues` | Excludes archived venues unless `?archived=1` |
| `GET /api/venue-rents?venueId=` | Unchanged, now read by the venue form rather than its own page |
| `POST /api/contacts` | Unchanged, but the performer form's create path passes the performer's name |

## Routes — unchanged, and deliberately so

`PATCH /api/events/{id}`, `/api/performers/{id}`, `/api/venues/{id}`, `/api/bands/{id}` already apply only
the fields present in the body. FR-028 is a rule about what the FORMS send, not a server change
(research R6). `POST /api/venue-rents` already adds a dated row, which is how a rent is changed (FR-029).

## Pages

### One form per record (FR-001 to FR-003)

| Element | Contract |
|---|---|
| Same component | Creating and editing use one form per record; a field cannot exist on one and not the other |
| Every field | Everything the record holds is editable by whoever may edit it — nothing is write-once |
| Another role's field | Shown, not editable, and not sent (e.g. a Booker sees the advertised price but cannot set it) |
| Saving | Sends only the fields that changed (FR-028) |
| Archive | A control in the form; warns and proceeds when the record is in use |
| The event form | `EventModal`, reused — `/events` opens it to edit instead of patching single fields |

### `/manage/performers` and `/bands` — search-led (FR-005 to FR-009)

| Element | Contract |
|---|---|
| On open | The search box has focus; no roster is listed |
| Searching | As you type, from 2 characters; results ordered by name; each opens the form |
| Too many | "More matched — narrow the search", as the contact directory says it |
| Nothing found | Says so, and offers to create that performer or band, carrying what was typed |
| Archived | Hidden unless "include archived" is on; an archived record shows as such and can be restored |

### The performer with no contact (FR-021 to FR-027)

| Element | Contract |
|---|---|
| When | On opening a performer whose contact link is empty — before the rest of the form is used |
| Choices | Exactly three: **link an existing contact**, **create one**, **archive the performer** |
| Suggestions | Likely contacts first, tolerant of a misspelling: "Clara Reidlinger" must offer "Clara Riedlinger" |
| Creating | Carries the performer's name, links it, returns to the form with nothing retyped, subscribes them to nothing — and first shows any near-match as "did you mean…?" (FR-026) |
| Names differ | Offers the contact's spelling for the performer, and takes no for an answer (FR-027) |
| Already linked | The question never appears |

### `/venues` — rents included (FR-015, FR-017, FR-029, FR-030)

| Element | Contract |
|---|---|
| Rents | Listed with the venue: series, amount, effective date, newest first |
| Changing one | Adds a new rent from a chosen date; existing amounts are not editable |
| Deleting one | Offered only while unused; refused with what uses it otherwise |
| None set | Says "none set" rather than showing zero |
| `/venue-rents` | The page is deleted and its menu entry removed |

## What a test may rely on

- Migration 0056 adds `archived_at` to `venues` and `performers`, and re-runs without error.
- An archived venue is absent from the venue list and the public venues, and still named by a past event.
- An archived performer is absent from the roster, the pickers and the public roster — whatever
  `is_public` says — and still named by a past booking.
- Archiving a venue with future events answers **409** without `confirm`, and succeeds with it.
- `GET /api/performers` with no `q` returns an empty list; with `q` returns matches ordered by name and
  `truncated: true` past 20.
- `GET /api/performers/{id}/link-suggestions` for the performer named "Clara Reidlinger" offers the
  contact "Clara Riedlinger" first.
- `DELETE /api/venue-rents/{id}` refuses a rent an event has used, and removes one nothing has.
- Each form's save request carries only the fields that changed.
