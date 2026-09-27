# Feature Specification: Booking Central — the Booker's hub

**Feature Branch**: `087-booking-central`

**Created**: 2026-09-23

**Status**: Draft

**Input**: Design dialogue with Rich, 2026-09-23

Sean books the club's dances from a spreadsheet: one row per dance, sorted by date, every performer
and every gap visible at once. The app has never given him that. It gave him five separate pages — a
booking list, a bookings report, bands, performers, and events — each holding one slice of the job,
none of them showing him a season.

Booking Central is that spreadsheet, made live. One page, one row per dance, the gaps as loud as the
bookings, and every record he needs reachable from the row he is looking at. When it is done, four
of those five pages are gone, and the two that remain are kept for people who are not the Booker.

The thing to keep hold of while building it: **the hub is a working surface, not a document.** It
scrolls forever, a click changes a booking's status, and it is never printed. The document the club
prints and discusses at meetings is the organizer report, which is why the forward-looking summary
that lives in today's bookings report is being sent there (B59) rather than carried into the hub.

## Clarifications

### Session 2026-09-23

- Q: Does Booking Central replace the bookings report, or absorb the Booker's other pages? → A:
  Absorb. `/bookings`, `/bookings-report`, `/bands` and `/manage/performers` become surfaces reached
  from the hub, and their menu entries go.
- Q: What about `/events` and `/venues`, which the Booker also edits? → A: Both survive as pages,
  because they are not only the Booker's — `/events` is the **Webmaster's** only way to edit the
  public blurb, and `/venues` is the **Treasurer's**. The Booker edits both from the hub as well.
  The Webmaster's arrangement wants revisiting later.
- Q: Can band search be folded into the hub's performer search? → A: Yes, one box returning both,
  each result tagged with what it is.
- Q: What does the status button do? → A: Advances through proposed → requested → tentative →
  confirmed and **stops there**. Declines and substitutions are deliberate acts done on the booking.
- Q: A band's status button — one control or one per member? → A: One, operating on the lead
  musician and cascading to the rest. Individual musicians who are not a band each get their own.
- Q: Should band membership be dated, so past lineups are preserved? → A: No. Every booking records
  its own performer, so "who played on 30 June 2020" is answered by the bookings and cannot be
  disturbed by editing a band today.
- Q: Notes — where? → A: A note on the **event**, and notes on **caller and band bookings**. Not on
  other performers' bookings (YAGNI). `description` is the public blurb and is not a notes field.
- Q: Are open-band musicians booked here? → A: No. They turn up and are not paid. An open-band
  *leader* who is booked and paid is an ordinary musician.
- Q: Does the Booker print this table? → A: No. Printing belongs to the organizer report.
- Q: How far does the table reach? → A: Newest first from four months ahead, scrolling back through
  history without limit.
- Q: Is four months ahead enough? → A: It is the **default**, not the limit. Out-of-town performers
  plan tours much further ahead, so the Booker can push the horizon out.
- Q: Where does a booked instructor appear? → A: In the caller's cell. When a dance has both, the
  caller is named first.
- Q: Absorbing the performers page removes performer editing from the Financial Secretary and the
  Treasurer, who hold it deliberately (B28 — she corrects names and adds substitute payees). How is
  that handled? → A: The performer editor is a **component, not a page**. The hub hosts it over the
  booking table for the Booker; the **payments page** hosts the same one for the Financial Secretary
  and the Treasurer, who work there anyway. So the performers page goes too, and nobody loses
  anything.
- Q: Do they need band editing as well? → A: No. They pay individuals, so bands stay hub-only.
- Q: What sits above the table? → A: The series name, the horizon control, the search box, and the
  count of performers needing a contact. Nothing else.
- Q: How does the Booker fill a gap? → A: **The dash is the control.** Clicking an unfilled slot
  starts a booking for that dance in that role — the gap and the way to fill it are the same object.
- Q: Can he create a dance from the hub? → A: No. New dances are made on the events page, which
  stays in his menu — so that page is kept for the Webmaster's blurb *and* for his own new events.
- Q: Today's bookings report filters by date range, caller, musician and band, and toggles the sort.
  What survives into the hub? → A: **Only the horizon control.** The performer questions are
  answered better by a performer's own history than by filtering the whole table to them, and the
  table's worth is that it reads like the spreadsheet rather than like a query screen. Anything
  genuinely missed comes back later with a real example behind it.
- Q: What makes a slot show as a gap? → A: A caller and music are always wanted, so they mark
  themselves when empty. A sound tech is wanted only where the series uses one — the club already
  records that per series. An instructor never makes a gap; they are an addition, not a requirement.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The season on one page (Priority: P1)

Sean opens Booking Central and sees his series the way his spreadsheet shows it: one row per dance,
newest first, starting four months out. Each row gives him the date, the time, the label, the venue,
and who is booked to call, play and run sound. Where nobody is booked, he sees that immediately.

**Why this priority**: it is the whole point, and it stands alone. Even with nothing clickable, a
Booker who can see his season in the app has stopped needing the spreadsheet to answer "where are
the holes?".

**Independent Test**: open the hub as the Booker and compare a month against the spreadsheet — the
same dances, the same people, the same gaps, in the same order.

**Acceptance Scenarios**:

1. **Given** the Booker's series, **When** the hub opens, **Then** the dances appear one per row,
   newest first, beginning four months ahead, and the series is named at the head of the table.
2. **Given** a dance with a caller, a band and a sound tech booked, **When** the row is read,
   **Then** each is named — a band by its name, loose musicians by their last names — with the state
   of each booking shown beside it.
3. **Given** a dance with nobody booked to call, **When** the row is read, **Then** the empty slot
   is **as visible as a filled one** and marked as needing attention.
4. **Given** a dance with no venue, **When** the row is read, **Then** that too reads as unassigned
   rather than blank.
5. **Given** a cancelled dance, **When** the row is read, **Then** it is distinguishable **by
   wording**, not by colour alone.
6. **Given** the Booker scrolls to the foot of the list, **When** more history exists, **Then** it
   loads and he keeps going back without ever reaching a page break.
7. **Given** a dance carrying a note, **When** the row is read, **Then** the note is shown beneath
   it, at whatever height it needs.
8. **Given** the Booker is planning with an out-of-town band, **When** he reaches the horizon
   further out, **Then** dances beyond four months appear and the table behaves as before.
9. **Given** a dance with an instructor booked, **When** the row is read, **Then** the instructor is
   named in the caller's cell; and where both are booked, the caller is named first.

---

### User Story 2 - Work the row (Priority: P2)

From the row in front of him, Sean opens whatever he needs: the dance, the venue, a booking. He
moves a booking along its course with a single click as performers answer him.

**Why this priority**: it turns a view into a workplace. US1 tells him where the holes are; this
lets him do something about them without leaving the page.

**Independent Test**: from one row, reach the event, the venue and each booking, and advance a
booking's state — without navigating away from the hub.

**Acceptance Scenarios**:

1. **Given** a row, **When** the label is clicked, **Then** the dance opens for editing.
2. **Given** a row, **When** the venue's short code is clicked, **Then** the venue opens for
   editing.
3. **Given** a row, **When** a caller's or a loose musician's name is clicked, **Then** **that
   booking** opens — what they are paid, its note, and the means to decline or substitute.
4. **Given** a row with a band, **When** the band's name is clicked, **Then** **the band's bookings
   for that dance** open — every member, each with their own state.
5. **Given** a booking that is proposed, **When** its state button is clicked repeatedly, **Then**
   it advances to requested, tentative and confirmed, and **stops at confirmed** — no number of
   clicks can decline anyone.
6. **Given** a band's state button, **When** it is clicked, **Then** the lead moves on and the rest
   of the band follows.
7. **Given** a booking that is declined, **When** the row is read, **Then** that is plain, and the
   slot reads as needing attention again.
8. **Given** a dance with nobody booked to call, **When** the Booker clicks the mark in that cell,
   **Then** a caller booking for that dance is begun, and he never leaves the row to do it.
9. **Given** the Booker wants a new dance in the calendar, **When** he looks for it here, **Then**
   the hub does not offer one — dances are made on the events page, which is still in his menu.

---

### User Story 3 - Performers and bands live here (Priority: P3)

Sean looks a performer up from the hub itself, not from a separate page. On a performer he can see
their history with the club and the bands they play in; from a band he can maintain who is in it.

**Why this priority**: it is the absorption. When this lands, three menu entries go and the hub
becomes the only place the Booker needs.

**Independent Test**: from the hub, find a performer by name, read their booking history, reach a
band they play in, and change that band's membership — without visiting any other page.

**Acceptance Scenarios**:

1. **Given** the hub's search box, **When** the Booker types part of a name, **Then** the results
   contain **both** performers and bands, and each result says which of the two it is — so that
   searching "Glenrose" finds the band and the fiddler, and he can tell them apart before clicking.
2. **Given** those results, **When** nothing says otherwise, **Then** archived performers and bands
   are left out, and can be included deliberately.
3. **Given** a performer, **When** their history is asked for, **Then** the dances they have played
   and are booked to play are listed.
4. **Given** a performer, **When** their bands are asked for, **Then** each is listed and each leads
   to that band.
5. **Given** a band, **When** it is opened, **Then** its members are listed and **only** its members
   — each can be removed by unticking, and one can be marked the lead.
6. **Given** a band, **When** a performer is searched for and chosen, **Then** they join it.
7. **Given** the lead is unticked from the band, **When** that happens, **Then** the band is left
   with no lead and says so.
8. **Given** a band with no lead, **When** the Booker needs to contact it, **Then** he is offered
   the members who have an email address to choose from.

---

### User Story 4 - The evening's lineup changes (Priority: P4)

A fiddler drops out on the Tuesday. Sean opens that dance's band bookings, marks her declined, and
books a substitute in her place — without touching who is in the band.

**Why this priority**: it is the case the status button deliberately cannot do, and the reason it
stops at confirmed. Rarer than the rest, and safe to ship after it.

**Independent Test**: decline one member of a booked band and substitute another performer, then
confirm the band's own membership is unchanged and the other members' bookings are untouched.

**Acceptance Scenarios**:

1. **Given** a band booked for a dance, **When** its bookings are opened, **Then** each member's
   booking is listed separately with its own state and pay.
2. **Given** one member, **When** they are declined, **Then** only their booking changes.
3. **Given** a declined member, **When** a substitute is chosen, **Then** the substitute is booked
   for that dance and the band's membership is **unchanged**.
4. **Given** a completed substitution, **When** that past dance is later read, **Then** it shows who
   actually played.

---

### User Story 5 - The performers who need a contact (Priority: P5)

Sean can find the performers with no contact behind them, and settle each one; and where a performer
points at a contact that has been retired, he can point it at the right one.

**Why this priority**: it closes two known gaps (B57, B58). The club has eighteen performers with no
contact and at least one pointing at an archived record — a worklist, not an incident, and nothing
else in the app can work it.

**Independent Test**: from the hub, list the performers that need a contact, settle one by creating
a contact, and re-point a performer whose contact is archived.

**Acceptance Scenarios**:

1. **Given** the hub, **When** the Booker asks, **Then** the performers with no contact are listed
   and counted (B57).
2. **Given** one of them, **When** it is opened, **Then** the existing question is raised — link,
   create, or archive — and answering it removes the performer from the list.
3. **Given** a performer linked to an **archived or merged** contact, **When** it is opened,
   **Then** the same question is raised, worded for a retired link rather than a missing one (B58).
4. **Given** that performer, **When** the right contact is chosen, **Then** the link moves, and no
   past booking is disturbed.

---

### Edge Cases

- **A dance with two of a kind** — two callers, or a band and a loose musician: the row shows both
  rather than choosing one.
- **Two dances at the same time on the same day**, in different halls: two rows, told apart by their
  venue. The Booker uses date, time and venue together to know which evening he is looking at, so a
  row that omits any of the three is ambiguous.
- **A dance with an instructor and no caller**: the instructor is named, and the caller is **still**
  marked as wanted — a workshop does not excuse a dance from having someone to call it. If that
  turns out to be wrong for a real evening, it is a rule to revisit, not a case to special-case
  quietly.
- **A dance in a series with no sound tech**: the sound-tech slot is never marked, so the Booker is
  not taught to ignore a permanent warning.
- **A performer booked for a series the Booker does not handle**: out of his table, and his searches
  still find the performer.
- **A band whose members change between booking and the night**: the dance still reports who was
  booked for it, because each booking names its own performer.
- **A band with no members**: can exist, and reads as having none rather than appearing
  empty-handed.
- **A band whose members have no email addresses**: the contact picklist is empty and says so,
  rather than offering nothing silently.
- **A dance in the past with a gap**: history, not a task. It is shown as it was, not flagged for
  attention.
- **An event the Booker cannot edit** (another series): reachable to read, not to change.
- **A Financial Secretary opening the performer editor** from payments: she edits the performer, and
  is offered nothing about bands or bookings — the editor is the same, its surroundings are not.
- **Two series**: the Booker who handles both gets each named, never one table silently mixing them.

## Requirements *(mandatory)*

### Functional Requirements

#### The table

- **FR-001**: The hub MUST present the Booker's dances one per row, newest first, beginning four
  months ahead and extending back through history as far as the Booker keeps scrolling.
- **FR-001a**: Four months MUST be a default the Booker can change, reaching further ahead when he
  needs to — out-of-town performers plan tours a year or more out, and a dance he cannot see is a
  dance he cannot book.
- **FR-001c**: Above the table MUST sit the series name, the horizon control, the search that finds
  performers and bands, and the count of performers needing a contact — **and nothing else**. The
  page is a spreadsheet to be read, not a console to be operated.
- **FR-001b**: The horizon MUST be the table's **only** control. The filters today's bookings report
  carries — by caller, by musician, by band, by date range, and a sort toggle — are deliberately NOT
  carried over: a performer's own history answers those questions in one click, and the table's
  worth is that it reads like the spreadsheet rather than like a query screen.
- **FR-002**: Each row MUST carry the date, the start time, the label, the venue, and the performers
  booked to call, to play, and to run sound.
- **FR-003**: A band MUST be shown by its name; performers booked without a band MUST be shown by
  their last names.
- **FR-003a**: An instructor booked for a dance MUST be named in the same cell as the caller. When
  both are booked, the caller MUST be named first.
- **FR-004a**: A dance MUST be treated as wanting a caller and wanting music, always; as wanting a
  sound tech only where its series uses one; and as never wanting an instructor. A slot nobody is
  wanted for MUST NOT be marked.
- **FR-004**: Every performer slot that is unfilled MUST be **as visible as a filled one** and
  marked as wanting attention — the gaps are what the Booker is scanning for.
- **FR-005**: A cancelled dance MUST be distinguishable **in words**, not by colour alone.
- **FR-006**: The table MUST name the series it is showing, and MUST NOT mix two series without
  saying so.
- **FR-007**: Open-band musicians MUST NOT appear as bookings in the hub. An open-band leader who is
  booked and paid is an ordinary musician and appears as one.

#### Working from the row

- **FR-008**: Clicking the label MUST open the dance for editing; clicking the venue MUST open the
  venue.
- **FR-009**: Clicking a caller's or a loose musician's name MUST open **that booking** — its pay,
  its note, and the means to decline or substitute.
- **FR-010**: Clicking a band's name MUST open **that dance's band bookings**, not the band's own
  record.
- **FR-011**: A booking's state control MUST advance proposed → requested → tentative → confirmed
  and **stop at confirmed**. No sequence of clicks on it may decline anyone.
- **FR-012**: A band's state control MUST act on the lead and carry the rest of the band with it.
- **FR-013**: Declining and substituting MUST be deliberate acts performed on a booking, never
  reachable by repeating the ordinary click.
- **FR-013a**: Clicking an unfilled slot MUST start a booking for that dance in that role. The mark
  that says a performer is wanted MUST be the same control that engages one — the Booker should
  never have to leave the row where he saw the gap in order to fill it.
- **FR-013b**: New dances MUST NOT be created from the hub. They are made on the events page, which
  remains in the Booker's menu for that purpose as well as for the Webmaster's.

#### Notes

- **FR-014**: A dance MUST be able to carry a note of the Booker's own, shown beneath its row at
  whatever height it needs.
- **FR-015**: A caller's booking and a band's booking MUST each be able to carry a note.
- **FR-016**: These notes MUST be private to the club's volunteers. The dance's public blurb is a
  separate thing and MUST remain so — a note MUST NOT be publishable by mistake.

#### Performers and bands

- **FR-017**: The hub MUST offer one search that finds both performers and bands, each result saying
  which it is.
- **FR-018**: Searches that OFFER a record MUST leave archived ones out by default, and MUST allow
  them to be included deliberately.
- **FR-019**: A performer MUST be able to show the dances they have played and are booked to play.
- **FR-020**: A performer MUST be able to show the bands they play in, each leading to that band.
- **FR-021**: A band MUST list its members and only its members; a member MUST be removable by
  unticking, and a performer MUST be addable by searching.
- **FR-022**: Exactly one member MAY be marked the band's lead — the person the Booker contacts.
- **FR-023**: Removing the lead from a band MUST leave the band with no lead, stated plainly, rather
  than a lead who is not a member.
- **FR-024**: A band with no lead MUST offer the members who have an email address, so one can be
  contacted.
- **FR-025**: Changing a band's membership MUST NOT alter any past or existing booking.

#### The performers who need a contact

- **FR-026**: The hub MUST be able to list and count the performers that have no contact (B57).
- **FR-027**: A performer whose contact is archived or merged MUST raise the same settle-it question
  as one with no contact, worded for a retired link (B58).
- **FR-028**: Re-pointing a performer's contact MUST NOT disturb any booking.

#### The absorption

- **FR-029**: When the hub covers what they did, the separate booking, bookings-report, bands and
  performers pages MUST be **removed**, not merely unlinked — a page nobody can reach is worse than
  either keeping it or deleting it.
- **FR-030**: The events page and the venues page MUST remain, because they serve the Webmaster and
  the Treasurer respectively; the Booker MUST be able to do the same editing from the hub.
- **FR-030a**: The performer editor MUST be usable from the **payments page** as well as from the
  hub, so the Financial Secretary and the Treasurer keep the performer editing they hold today —
  correcting a name, adding an unknown substitute payee — without a performers page existing.
- **FR-030b**: Each host MUST be reached by its own capability, and editing a performer MUST still
  require the performer-editing capability. Where the editor is offered changes; who may write does
  not.
- **FR-030c**: Band membership editing MUST live in the hub alone. Nobody outside the Booker's work
  needs it — performers are paid individually.
- **FR-031**: What every role may do MUST be unchanged by this feature. Absorbing pages rearranges
  where work happens, never who may do it.

#### Its look

- **FR-032**: The hub MUST carry a visual identity that marks it as an administrative page rather
  than public content, derived from the public site's styling.
- **FR-033**: That styling MUST be defined once, in a form the club's other administrative pages can
  adopt later, rather than belonging to this page alone.

### Key Entities

- **A dance**: one evening — its date, time, label, venue, public blurb, the Booker's private note,
  and whether it is cancelled.
- **A booking**: one performer engaged for one dance, in one role, at a pay, in one of five states.
  A band booked for a dance is several of these, one per member, which is why history survives a
  change of lineup.
- **A band**: a named group with members, one of whom may be the lead — the person the Booker rings.
  Membership describes the band **now**; it carries no history and needs none.
- **A performer**: someone who plays, calls or runs sound, ideally linked to a contact so they can
  be reached and paid.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The Booker can answer "where are the holes in the next four months?" **from one
  screen, without scrolling sideways or opening anything**.
- **SC-002a**: Seeing a gap and beginning to fill it is **the same click** — no navigation, no menu,
  no separate "new booking" form to find.
- **SC-001a**: The table carries **four** things above it — the series, the horizon, the search, and
  the count of performers needing a contact — and no more. Every question the retired filters
  answered is reachable another way — and named, so that none is lost by omission.
- **SC-002**: Every record the Booker needs while looking at a dance — the dance, the venue, each
  booking, the band's lineup — is reachable in **one click from its row**.
- **SC-003**: Moving a booking from proposed to confirmed takes **three clicks and no navigation**,
  and **no number of clicks can decline anyone**.
- **SC-004**: The volunteer menu loses **four entries** — bookings, the bookings report, bands and
  performers — and gains one.
- **SC-004a**: The Financial Secretary can still correct a performer's name and add a substitute
  payee, from the page where she records payments, with **no performers page in the menu**.
- **SC-005**: A band's membership can be changed without altering **any** booking, past or future —
  proved, not asserted.
- **SC-006**: The eighteen performers with no contact can be listed, and each settled, **without
  leaving the hub or consulting the database**.
- **SC-007**: Every capability is **unchanged** from before the feature.

## Assumptions

- **The hub is a working surface, never a document.** It scrolls without end and is not printed. The
  printed artefact is the organizer report, and the forward-looking summary that today's bookings
  report provides is being rehomed there — filed as **B59** and named here as a non-goal so the
  absorption does not delete it by omission.
- **The phone is a separate feature.** Away from his desk the Booker asks specific questions — when
  is this performer's next booking, what is their history, when is the first open gig of their type,
  who has not shown up tonight — and those are answered from a performer and from tonight, not from
  a table. Its user stories are Rich's to write.
- **Band membership stays undated.** "Who played on 30 June 2020" is answered by the bookings, each
  of which names its own performer. A dated-membership model would be a much larger change and buys
  nothing the club has asked for.
- **The event record has one editor behind two doors.** The Booker edits a dance from the hub and
  the Webmaster edits it from the events page; both change the same record. The public blurb is
  editable in both places; the Booker's private note belongs to the hub.
- **`/venues` survives for the Treasurer alone**, who holds venue-editing club-wide. The Webmaster's
  claim on `/events` is the same shape and is accepted for now, to be revisited (Rich, 2026-09-23).
- **Statuses and roles already exist.** The five booking states and the performer roles are the
  app's own; this feature presents them, and adds none.
- **The app's shared event picker is out of scope, and knowingly so.** It shows date, time and label
  but never the venue, so it cannot distinguish two dances at the same hour in different halls. The
  hub has no event picker — its rows carry all three, and filling a gap starts from the row — so the
  gap lives on the four pages that use the picker. Filed as **B60**.
- **This feature establishes the administrative styling** because it is the first page to need it.
  Rolling it across the remaining administrative pages is later work, not a precondition.
