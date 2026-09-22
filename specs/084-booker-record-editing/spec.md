# Feature Specification: The Booker's records — edit anything, find it by name, archive it

**Feature Branch**: `084-booker-record-editing`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: "booker workflow one"

The first of two features rebuilding the Booker's work. This one repairs the records themselves: today a
venue, a performer or an event collects more when it is CREATED than can ever be changed afterwards, the
performer and band pages list everyone instead of letting you search, and a venue's rents live on a page
of their own. The second feature — "Booking Central" — turns the bookings report into the place the
Booker starts from, opening these same forms over the schedule. It is deliberately not in this one: forms
that cannot edit half their fields would only relocate the frustration.

## Clarifications

### Session 2026-09-22

- Q: How should two people editing one record be handled? → A: Send only the fields that were changed, as
  the forms do today; different fields merge, and on the same field the later save wins.
- Q: What happens when a venue rent that events have already used is changed? → A: A new rent is added
  from a chosen date rather than the old figure being rewritten; a row nothing has used can be deleted.
- Q: Does an archived performer stay on the public roster? → A: No — archived means off the public site,
  the rule bands already follow; the public flag is left untouched, so restoring brings them back.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Change anything the record holds (Priority: P1)

The Booker creates an event, then needs to give it a label and a public description; renames a venue after
the hall changes its name; corrects a performer's stage name and their biography. Every field the record
holds can be changed after it is created, in the same form that created it.

**Why this priority**: This is the complaint that started the feature, and it is a trap rather than a
missing nicety — the information is collected, stored, and then unreachable. Nothing else here matters if
a record still cannot be corrected.

**Independent Test**: Create a venue, a performer and an event; reopen each; change every field in turn;
confirm each change is kept and shown.

**Acceptance Scenarios**:

1. **Given** an event created earlier, **When** the Booker opens it and sets a label, a start time and a
   public description, **Then** all three are saved and shown on the event afterwards.
2. **Given** a performer created earlier, **When** the Booker changes their display name and biography,
   **Then** both are saved, and the performer reads the same way everywhere they appear.
3. **Given** a venue created earlier, **When** the Booker corrects its name, short name, address and
   directions, **Then** each is saved.
4. **Given** any of the three, **When** the Booker opens the form to create one and then opens it to edit
   one, **Then** it is the same form, with the same fields in the same order.
5. **Given** a field the Booker may not change (one belonging to another role), **When** they open the
   form, **Then** that field is shown but not editable, rather than hidden or silently ignored.

---

### User Story 2 - Find a performer or a band by name (Priority: P2)

The Booker looks after a few hundred performers. Rather than a list of all of them, they type two or three
letters and see the matches, sorted, and open the one they want.

**Why this priority**: It is how the contact directory already works, and the list becomes unusable as the
roster grows. It changes how the page is reached, but not what a record can hold — so it follows P1.

**Independent Test**: With many performers present, open the page, type part of a name, and confirm the
matches appear sorted and that none of the full roster is listed before typing.

**Acceptance Scenarios**:

1. **Given** the performers page, **When** it opens, **Then** the search box has focus and no roster is
   listed.
2. **Given** the Booker types part of a name, **When** matches exist, **Then** they are listed in a
   predictable order, and each can be opened.
3. **Given** more matches than the page shows, **When** the results are truncated, **Then** the Booker is
   told so and asked to narrow the search.
4. **Given** no match, **When** the search finds nothing, **Then** the page says so and offers to create
   that performer.
5. **Given** the bands page, **When** the Booker searches, **Then** it behaves the same way.

---

### User Story 3 - Retire a venue, performer or band that is no longer used (Priority: P3)

The hall closes; a caller stops calling. The Booker archives the record so it stops appearing when
booking, while every past event that used it still reads correctly.

**Why this priority**: Without it the only tidy-up is deletion, which would falsify history. It is a small
addition to the form P1 builds.

**Independent Test**: Archive a venue, confirm it is no longer offered when booking, and confirm a past
event that used it still names it.

**Acceptance Scenarios**:

1. **Given** a venue nobody books any more, **When** the Booker archives it, **Then** it is not offered
   when a new event chooses a venue.
2. **Given** an archived venue, **When** a past event that used it is opened, **Then** it still shows that
   venue.
3. **Given** an archived record, **When** the Booker searches with "include archived" turned on, **Then**
   it is found and can be restored.
4. **Given** a performer shown on the public roster, **When** the Booker archives them, **Then** they
   leave the public roster — and return to it if they are restored.
5. **Given** a venue with three future events, **When** the Booker archives it, **Then** they are warned
   how many and when the next one is, and archiving proceeds once they confirm.
6. **Given** that archived venue, **When** those future events are opened, **Then** they still name it,
   and it is simply not offered to any new event.

---

### User Story 4 - A performer with no contact gets resolved (Priority: P4)

The Booker opens a performer who is linked to no contact record. Before anything else, they are asked to
settle it: link an existing contact, create one from the performer's name, or archive the performer.

**Why this priority**: 19 performers carry no contact today — 5 are seed leftovers never booked, 12 were
booked once or twice and are long past, and 2 are active, one of them with 9 bookings and 3 still to come.
Unlinked performers drop out of mailing-list exports and confuse the organizer report's counting, and the
queue has been deferred since feature 072. It needs archiving (US3) to exist first, which is why it
follows.

**Independent Test**: open an unlinked performer; confirm the three choices; take each in turn on a
different record and confirm the outcome.

**Acceptance Scenarios**:

1. **Given** a performer with no linked contact, **When** the Booker opens them, **Then** they are asked
   to link a contact, create one, or archive the performer — before the rest of the form is used.
2. **Given** that question, **When** the Booker searches for a contact, **Then** likely matches for that
   performer's name are offered first.
3. **Given** no such contact exists, **When** the Booker creates one, **Then** it is created from the
   performer's name, linked, and the Booker continues editing without retyping anything.
4. **Given** a seed leftover or a guest booked once years ago, **When** the Booker archives it, **Then**
   it leaves the roster and every past booking still names them.
5. **Given** a performer who already has a contact, **When** the Booker opens them, **Then** no such
   question appears.

---

### User Story 5 - Keep a venue's rents with the venue (Priority: P5)

The rent for a hall — which varies by series and changes over time — is part of what the Booker knows
about that hall, so it is edited where the hall is edited, not on a page of its own.

**Why this priority**: It removes a whole page and a menu entry, and puts a fact where it is looked for.
Real, but the smallest of the five — and independent of the rest, so it can ship whenever.

**Independent Test**: Open a venue, add a rent for a series from a date, change it, and confirm the figure
the reports resolve is the changed one.

**Acceptance Scenarios**:

1. **Given** a venue, **When** the Booker opens it, **Then** its rents are listed — each with the series
   it applies to and the date it takes effect.
2. **Given** a venue's rents, **When** the Booker sets a new rent from a date, **Then** events on or after
   that date resolve the new figure and earlier events resolve exactly what they did before.
3. **Given** a rent added by mistake that no event has used, **When** the Booker deletes it, **Then** it is
   gone and the previous rent applies again.
4. **Given** the volunteer menu, **When** this feature is done, **Then** it no longer offers a separate
   venue-rents destination.

---

### Edge Cases

- **Two people editing one record**: only the fields each person changed are sent, so edits to different
  fields of the same record both survive (FR-028). Two people changing the SAME field is accepted as a
  last-save-wins race — rare with one Booker, and not worth a version check.
- **A field that belongs to someone else**: a Webmaster may set an event's public price, the Booker its
  date. The one form serves both, each seeing what they may change.
- **Archiving something in use**: warned, then allowed (FR-014) — a hall that closes keeps the dates
  already booked in it and stops taking new ones.
- **Changing a performer's telephone**: the form sends the Booker to the contact record, which may be
  linked to more than one performer — a reason the number is edited in exactly one place (FR-018).
- **Restoring an archived record** whose name now collides with a newer one.
- **Archiving a publicly listed caller**: they leave the public roster at once (FR-031); their public flag
  is untouched, so restoring them puts them back without the Booker having to remember it was set.
- **Searching before typing enough**: one letter matches nearly everyone; the page should ask for more
  rather than returning hundreds.
- **A performer with no contact record**: settled on opening (FR-021) — link, create, or archive.
- **A performer unlinked later**, because their contact was deleted: the same question, whenever they are
  next opened. This is not a one-off cleanup.
- **A guest who will never be a club contact** — a touring musician booked for one night: creating a
  contact is the answer, and it subscribes them to nothing (FR-023).
- **A performer whose name is misspelled**: the live example is the performer "Clara Reidlinger" and the
  contact "Clara Riedlinger" — one person, two spellings, no link. Matching on the exact name finds
  nothing here, and the Booker would be pushed into creating a second contact for her. FR-022 and FR-026
  exist for this case.
- **A performer whose name differs on purpose**: a stage name is not a misspelling, so the offer to adopt
  the contact's spelling (FR-027) is an offer and never automatic.
- **A venue with no rent for a series**: reports already fall back; the form must show "none set" rather
  than a misleading zero.
- **A rent typed wrongly and saved**: if no event has used it, delete it (FR-030); if one has, the
  correction is a new rent from a date, and the past stays as it was reported (FR-029).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every field a venue, performer or event record holds MUST be changeable after creation by
  whoever may change it.
- **FR-002**: Creating and editing MUST use the same form for each kind of record, so a field can never be
  offered on one and missing from the other.
- **FR-003**: A field the viewer may not change MUST be visible but not editable, and the form MUST NOT
  offer to save it.
- **FR-004**: A change MUST be kept and shown wherever that record appears, including in reports and
  public pages that use it.
- **FR-005**: The performers page and the bands page MUST be reached by searching, and MUST NOT list the
  whole roster before a search is made.
- **FR-006**: Search results MUST be ordered predictably by name, so the same search twice gives the same
  order.
- **FR-007**: When there are more matches than are shown, the page MUST say so and ask for a narrower
  search.
- **FR-008**: A search finding nothing MUST offer to create that performer or band, carrying what was
  typed into the form.
- **FR-009**: The search box MUST have focus when the page opens.
- **FR-010**: A venue, performer or band MUST be archivable, and an archived record MUST NOT be offered
  when booking or when choosing a venue.
- **FR-011**: An archived record MUST still be shown wherever it is part of history — a past event, a past
  booking, a past report.
- **FR-012**: An archived record MUST be findable by searching with archived records included, and MUST be
  restorable.
- **FR-013**: Archiving MUST be reversible and MUST NOT delete anything.
- **FR-031**: An archived performer MUST NOT appear on the public roster, whatever their public flag says
  — the rule bands already follow (public AND not archived). The flag itself MUST be left as it was, so
  restoring the performer restores their public listing.
- **FR-014**: Archiving a record still in use MUST warn first — naming how many future events or bookings
  use it and when the next one is — and MUST proceed if the Booker confirms. Those bookings stand, and
  still show the record; it simply stops being offered for new ones.
- **FR-015**: A venue's rents MUST be listed and managed with the venue, each with the series it applies
  to and the date it takes effect.
- **FR-029**: A rent MUST be changed by adding a new one from a chosen date, not by rewriting an existing
  amount — so no report of a past event changes because of an edit made today.
- **FR-030**: A rent row that no event has used MUST be deletable, so a mistake made a moment ago can be
  removed rather than corrected by a second row.
- **FR-016**: The rent an event resolves MUST be unchanged by where it is edited — the same figure as
  before this feature, for the same data.
- **FR-017**: The separate venue-rents destination MUST be removed from the volunteer menu once its
  contents are on the venue.
- **FR-018**: A performer's email and telephone belong to their linked contact record, not to the
  performer. The performer form MUST name the linked contact and link to the record where they are
  changed — one fact, one place to edit it. *(Corrected during implementation: the form does NOT display
  the email and telephone. Feature 016 keeps them behind `contact.pii.read` while the performer payload
  is readable by any volunteer, so showing them here would leak PII. Backlog B56 carries the PII-gated
  alternative if the Booker turns out to need the number in front of them.)*
- **FR-019**: A performer with no linked contact MUST NOT appear to have an email or telephone that can be
  set on the performer.
- **FR-021**: Opening a performer who is linked to no contact MUST ask the Booker to settle it, offering
  exactly three ways out: link an existing contact, create one, or archive the performer.
- **FR-022**: That question MUST offer the contacts most likely to be the same person first, and the
  likeness MUST tolerate a misspelling — an exact-name match is not enough. A performer recorded as
  "Clara Reidlinger" MUST offer the contact "Clara Riedlinger".
- **FR-023**: Creating a contact from the question MUST carry the performer's name into it, link it, and
  return the Booker to the form with nothing retyped. It MUST NOT subscribe that person to any mailing
  list.
- **FR-024**: The question MUST be settled before the performer's other fields are edited, and no field
  already typed may be lost by settling it.
- **FR-025**: A performer who HAS a linked contact MUST NOT be asked the question.
- **FR-026**: Creating a contact from the question MUST first show any near-match and ask whether that is
  the same person, so settling an unlinked performer cannot quietly create a duplicate contact.
- **FR-028**: Saving a record MUST send only the fields that were changed, so a change to one field never
  overwrites someone else's change to another field of the same record.
- **FR-027**: On linking, where the performer's name and the contact's differ, the Booker MUST be offered
  the contact's spelling for the performer — and MUST be able to decline, because a performer's name is
  a stage name as often as it is a misspelling.
- **FR-020**: Bands already allow editing and archiving; this feature MUST leave that behaviour as it is,
  adding only the search (FR-005) and the restore that bands never had — nothing unarchives a band today,
  and FR-012 requires it. *(Corrected at planning, research R1.)*

### Key Entities

- **Venue**: a hall the club dances in — name, short name, address, directions, landlord, and the rents
  below. Archivable.
- **Venue rent**: what a hall costs, for one series, from one date. Several per venue; the newest on or
  before an event's date is the one that applies.
- **Performer**: someone who is booked — display name, biography, whether they are public, whether they
  call, their styles and promo links, and a link to a contact record. New performers already require that
  link; 19 older ones lack it, and FR-021 settles each as it is opened. Archivable.
- **Band**: a bookable group of performers. Already fully editable and archivable.
- **Event**: a dance — date, start time, series, label, public description, venue, rent override, status
  and advertised price. Not archivable: an event is cancelled, which it already supports.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: **Every** field these records hold can be changed after creation — nothing is write-once.
- **SC-002**: The Booker can correct any single field of a venue, performer or event in under a minute,
  without leaving the page they were on to do it.
- **SC-003**: Finding a performer by name takes one search and no scrolling, with a roster of several
  hundred.
- **SC-004**: Retiring a venue or performer takes one action, and no past event, booking or report changes
  because of it.
- **SC-005**: The volunteer menu offers at least one destination fewer than before.
- **SC-007**: Every performer the Booker opens ends that visit either linked to a contact or archived, so
  the count of active unlinked performers only ever falls — from 19 today.
- **SC-006**: No rent figure any report resolves changes as a result of this feature, for unchanged data.

## Assumptions

- **Booking Central is the next feature, not this one.** These forms are built to be opened from the
  schedule later; this feature ships them on their own pages first.
- **Bands is the model.** It is the one record of the four that is already fully editable and archivable,
  so it sets the pattern the other three follow rather than being rebuilt itself.
- **Archiving is not deletion** and there is no bulk archive. Deleting a venue or performer stays whatever
  it is today.
- **The contact directory sets the search pattern** — focus the box on open, search as you type, tell the
  searcher when results are truncated, and offer an "include archived" switch — so the Booker learns one
  behaviour, not two.
- **A warning, not a gate (decided 2026-09-22).** Archiving a venue or performer in use warns and
  proceeds; it is reversible, nothing is deleted, and existing bookings are untouched. This is how a hall
  actually closes: keep what is booked, take nothing new.
- **Contact details have one home (decided 2026-09-22).** The performer form shows email and telephone
  read-only and links to the contact record. The cost, accepted: correcting a number means opening that
  record.
- **Authorization is unchanged.** Who may edit an event's date, its public description or a venue's rent
  is exactly as it is today; the one form simply shows each person what they may change.
- **Clara Riedlinger is left unlinked on purpose (decided 2026-09-22)** as the first live test of User
  Story 4: an active performer, 9 bookings and 3 still to come, whose contact exists under the correct
  spelling while the performer record carries a transposition typo. Fixing her by hand would remove the
  evidence that the matching actually works.
- **Duplicate-making is the risk this story carries.** Settling an unlinked performer ends in creating a
  contact whenever no match is offered, so a weak match is not a small inconvenience — it is how a
  duplicate gets made. The contacts directory already asks "did you mean…?" before creating (feature 079)
  and already scores likeness for its duplicate queue; this feature reuses both rather than inventing a
  third rule.
- **Unlinked performers are legacy, not a permitted state.** Creating a performer already requires a
  contact; the 19 without one predate that rule or lost their contact when it was deleted (the link is
  cleared rather than blocking the deletion). FR-021 drains that queue as each is opened rather than
  demanding one big cleanup, and keeps it drained.
- **Settling the link comes first (decided 2026-09-22).** The question blocks the rest of the performer
  form. The alternative — a banner the Booker can ignore — would leave the queue where it has sat since
  feature 072.
- **Events are not archived.** They are cancelled, which already exists; an event also disappears from
  view naturally as its date passes.
- **The volunteer menu's grouping is out of scope** — removing the venue-rents entry is in, rearranging
  the rest belongs with Booking Central.
