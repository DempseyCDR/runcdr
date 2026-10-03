# Feature Specification: Booking Central on a phone

**Feature Branch**: `091-booking-central-cards`

**Created**: 2026-10-01

**Status**: Draft

**Input**: User description: "booking central"

The first page conversion after the shared building blocks (feature 089) and the volunteer frame
(feature 090), in the order the conventions draft set
(`specs/phase-8-requirements/mobile-volunteer-conventions.md` §7 item 1). Booking Central (feature
087) is the Booker's hub: one row per dance, every performer and every gap in view. On a computer it
is a wide table; on a phone it does not fit. Most of what follows was decided with Rich on
2026-09-28 (the draft's §4.5 and §7 item 9); this specification records those decisions as
requirements.

## Clarifications

### Session 2026-10-01

- Q: Which dance does Booking Central open on, at the bottom of the window? → A: The **first dance
  dated today or later** — not the most recent dance up to today (check-in's rule, which the draft
  had named). With no dance to come, the most recent. *(Rich, reviewing the first draft of this
  specification.)*
- Q: Does a card show each booking's state (P/R/T/C/D)? → A: **Yes, for display only.** Each name
  on a card carries its state letter, so an unconfirmed booking is seen from the list; a letter
  advances only inside the opened dance, so a tap on a small card can never change a booking.
- Q: What does tapping a card open? → A: **The dance in the shared dialog**, filling the screen on a
  phone. Back or Close returns to the list where it was; the booking, band, venue and event editors
  open on top of it. (Not a card that expands in place.)

### Session 2026-10-01 (Rich's phone check)

- Q: On Chrome on the iPhone the next dance's card, at the bottom of the window, is partly under the
  browser's own bar. → A: **Stop the default dance short of the bottom**, clear of a phone browser's
  bar (FR-007).
- Q: Opened scrolled down past the dances to come, the volunteer bar is out of sight. → A: **Pin the
  volunteer bar to the top of the window on Booking Central** (FR-016) — only there, since elsewhere
  a pinned bar would cover what a page scrolls to the top (check-in's search box).
- Q: On a computer the page opens scrolled down, so its title, search and prompt are out of sight.
  What stays pinned with the bar? → A: **The title and its controls, at every width** — on a
  computer the search and the "performers need a contact" prompt, on a phone the Performers button —
  with **a smaller title** so the pinned block stays short (FR-017).
- Q: Is the table kept on a computer? → A: **No — the card is the basis for every width.** From
  48rem (768px, the second named width) each card is **live**, as the table's row was, adds the
  **time, venue and notes** the phone's card leaves out, and spreads **Caller, Music and Sound
  across the card** side by side. The table is retired (FR-006).
- Q: Sean books contra and the community dance. Which dances does he see? → A: **Those two series,
  not ECD** — every series his roles name, not "all series" whenever they name more than one
  (FR-011).
- Q: Sean adds a band member who is not a performer yet — the search finds nobody. → A: **Offer a
  new performer** in the band's member search, as the hub's search does, with the same form that
  makes one there; once made, the performer **joins the band**, ready for a lead and an instrument
  (FR-019).
- Q: Short code or full name for the venue? → A: **The full name** ("The Rose Room", not "RR"), on
  the wide card and in the opened dance. The short code fit 087's narrow Venue column; the table is
  retired and the phone's card shows no venue.
- Q: A phone on its side is wide but short. What happens to the pinned header? → A: Under **450px
  tall**, the search and the prompt **collapse into the Performers button at the end of the title's
  line** — the header is one line (FR-018).
- Q: Does each end of the list need a "Show later dances" / "Show earlier dances" button? → A:
  **No.** Scrolling — and the arrow keys — load more; the ends say "Loading…" and, at the last,
  that there are no more (FR-009).
- Q: How is a performer named on a card? → A: **First initial and last name** ("C. Sloboda") — Sean
  must tell Catherine Sloboda from her brother Matt (FR-002b).
- Q: Is a declined performer booked? → A: **No.** They said they would not come, so the booking was
  never made; Sean still sees it on the hub (a struck **D**) to remember who turned him down, but it
  reaches no payment and no report. The hub already treats it so (a declined booking never fills its
  slot); the organizer report and the door do not — backlog **B68**, outside this page.
- Q: A booked performer who does not come — a no-show? → A: **Backlogged (B69)** — the payments
  page needs a way to mark one, unpaid; out of scope for the booker's page.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The dances as cards on a phone (Priority: P1)

Sean, the Booker, is away from his desk when a caller texts to say yes. He opens Booking Central on
his phone. Instead of a table too wide for the screen, he sees one card per dance — its date,
series, label, caller and band — with a mark wherever the dance still wants someone. He taps the
dance the caller agreed to, and everything the computer's row offers is there: he moves the caller's
booking along to confirmed and closes it.

**Why this priority**: the hub is the Booker's main page, and today it cannot be used on a phone —
the table scrolls sideways and its controls are too small to tap. The rest of this feature arranges
the cards; this story makes the page usable at all.

**Independent Test**: at 320 and 390 px wide, signed in as the Booker, open Booking Central; every
dance is a card, nothing scrolls sideways, and a dance's card opens a view that offers everything
its computer row does.

**Acceptance Scenarios**:

1. **Given** a screen narrower than the second named width (48rem, about 768 px), **When** Booking
   Central is shown, **Then** each dance is one card, in the hub's order (newest first), and the
   page never scrolls sideways.
2. **Given** a card, **When** it is shown, **Then** it gives the dance's date, its series, its
   label, its caller and its band (or musicians), each name with its booking's state letter, and
   marks any slot the dance wants but has not filled — the caller, the music or the sound — as the
   row's gap marks do. A cancelled dance says so. Nothing on the card changes a booking: a tap
   anywhere on it opens the dance.
3. **Given** a card, **When** it is tapped, **Then** the dance opens with everything its computer
   row offers: the venue, the caller, the music, the sound, each booking's state letter (which
   advances on a tap), the gap marks and the **+** that fill a slot, the dance's notes, and the way
   into the dance's own form.
4. **Given** a change made from an opened dance, **When** it is saved, **Then** the dance's card
   shows it, and the list keeps its place.
5. **Given** a volunteer who may read Booking Central but not book, **When** they tap a card,
   **Then** the dance opens read-only, as their computer row is.
6. **Given** a screen at least 48rem wide, **When** Booking Central is shown, **Then** each dance is
   still a card — live, as the table was, with its time, venue and notes, and its Caller, Music and
   Sound spread across it (FR-006). The table is retired.

---

### User Story 2 - Opening on the dance that matters, and scrolling both ways (Priority: P1)

Sean opens Booking Central. It shows the dances around the one that matters now — the next dance,
the first dated today or later — with that dance at the bottom of the window: the dances further
ahead above it, which is where his work is, and the past below. He scrolls up into the coming months
and the list keeps going; he scrolls down into last season and it keeps going too. There is no date
to set first.

**Why this priority**: today the hub opens on every dance up to four months ahead and scrolls only
back in time, below a "Showing dances from" date the Booker must change to see further ahead. On a
phone that control and a list opening months ahead of today are both in the way.

**Independent Test**: at a phone width and at a computer width, open Booking Central; the default
dance is the last one in view; scrolling up reaches dances further ahead without a control, and
scrolling down reaches older ones.

**Acceptance Scenarios**:

1. **Given** Booking Central opening, **When** it is shown, **Then** it shows about ten dances, the
   **default dance** last in view — the first dance dated today or later, or, if there is none, the
   most recent — with the dances further ahead above it.
2. **Given** the list, **When** the Booker scrolls up past the latest dance loaded, **Then** later
   dances load above it, without the view jumping.
3. **Given** the list, **When** the Booker scrolls down past the oldest dance loaded, **Then** older
   dances load below it, as today.
4. **Given** either end of the list, **When** there are no more dances that way, **Then** the list
   says so and stops loading.
5. **Given** a keyboard user, **When** they scroll with the arrow keys to either end, **Then** more
   load that way, as for anyone scrolling — there are no buttons at the ends (Rich, 2026-10-01).
6. **Given** any width, **When** Booking Central is shown, **Then** there is no "Showing dances
   from" control: it is retired at every width.

---

### User Story 3 - One title, and the performers in reach (Priority: P2)

At the top of the page Sean sees one line, "Booking Central — Thursday Night Contra". On his phone,
below it, is one **Performers** button: it opens the performer-and-band search and the list of
performers who need a contact, so the cards start high on the screen. At his desk the search and
the "3 performers need a contact" prompt stay in view above the table, where they prompt him to act.

**Why this priority**: the cards are useful without it, but the space above them is scarce on a
phone, and today it holds a title, a separate series heading, the date control, the search and the
prompt.

**Independent Test**: at a phone width, the top of the page is the title line and the Performers
button; the button opens the search and the needs-a-contact list; at a computer width both stay in
view above the table.

**Acceptance Scenarios**:

1. **Given** any width, **When** Booking Central is shown, **Then** its title is the one line
   **"Booking Central — {series name}"**, or **"Booking Central — All series"** when the viewer's
   roles name no single series; the separate series heading beneath the title is gone.
2. **Given** a phone width, **When** the page is shown, **Then** only the title and a
   **Performers** button sit above the cards.
3. **Given** the Performers button, **When** it is pressed, **Then** a dialog opens holding the
   performer-and-band search and, when there are any, the performers who need a contact, with
   everything each offers today (opening a performer or band, making a new one, settling a
   performer's contact).
4. **Given** a computer width, **When** the page is shown, **Then** the search and the "performers
   need a contact" prompt stay in view above the table, as today.

---

### Edge Cases

- **No dances at all** (for the viewer's series). The list says there are none; nothing loads at
  either end.
- **Only future dances, or only past ones.** The default is the first to come, or, with none to
  come, the most recent; the list opens on it and loads only the way there are dances.
- **A dance today.** It is the default (today counts as "today or later"), so on the night the
  Booker opens on that evening's dance.
- **A dance saved with a new date** moves to its new place in the list on the next re-read; the list
  keeps the Booker's place rather than jumping to the top.
- **The window crosses 48rem** (a tablet turned, a window resized). The cards switch between the
  phone's and the wide, live ones and keep showing the same dances.
- **A phone on its side** — wide but under 450px tall. The cards are the wide, live ones; the pinned
  header is one line, the search and the prompt behind the Performers button at the end of the
  title's line (FR-018).
- **Later dances load above while the Booker is reading.** What is in view stays where it is; the
  new dances appear above it, not under his thumb.
- **Enlarged text (200%).** Cards grow taller and wrap; nothing is clipped and nothing scrolls
  sideways.
- **A cancelled dance.** Its card says "Cancelled", as its row does; it can still be opened.
- **No JavaScript.** Booking Central needs it today (it is a working surface built in the browser);
  this feature does not change that.

## Requirements *(mandatory)*

### Functional Requirements

#### The cards

- **FR-001**: Below the second named width (48rem), Booking Central MUST show each dance as one
  card, in the hub's order (newest first), and MUST NOT scroll sideways at any width from 320 px.
- **FR-002**: A card MUST show the dance's date, series, label, caller and band (or its musicians,
  as the row names them), each name with its booking's state letter (P, R, T, C, D, as the row
  shows them), and MUST mark every slot the dance wants but has not filled — caller, music, sound —
  as the row's gap marks do (feature 087 FR-004, FR-004a). A cancelled dance's card MUST say
  "Cancelled".
- **FR-002b**: On a card, every performer MUST be named by first initial and last name ("C.
  Sloboda"); a one-word name is shown whole, and a musician booked beside a band is joined to it by
  "feat.". The state letter still gives a screen reader the full name. Each kind of performer —
  Caller, Music, Sound — is a term with its names beside it, the term aligned with the first line of
  names however many lines they wrap to. The opened dance names its performers the same way, and so
  does the wide card (FR-006) — the card replaces 087's row names (087 FR-003) at every width.
- **FR-002a**: A card MUST NOT change a booking: its state letters are shown, not pressed, and a
  tap anywhere on the card opens the dance (FR-003), where the letters advance.
- **FR-003**: Tapping a card MUST open that dance in the shared dialog (feature 089), filling the
  screen, with everything its computer row offers: venue, caller, music and sound with their state
  letters (advancing on a tap, as the row's do — feature 087 FR-011), the gap marks and **+** that
  fill or add to a slot, the dance's note and booking notes, and the way into the dance's own form.
  The booking, band, venue and event editors MUST open on top of it. Every control in it MUST meet
  the tap minimum (feature 089) and nothing in it may depend on hover.
- **FR-003a**: Closing the opened dance — Close, Escape, or the phone's Back — MUST return to the
  list in the same place, with focus on the card that opened it.
- **FR-004**: A change made from an opened dance MUST show on its card when saved, and the list MUST
  keep its place.
- **FR-005**: A volunteer who may read but not book MUST see an opened dance read-only, as their
  computer row is (feature 087).
- **FR-006**: At 48rem and wider each dance MUST still be a card — the table is retired (Rich,
  2026-10-01: the card is the basis for every width) — and the card MUST be **live**, with every
  capability the table's row had: a name opens its booking, a letter advances, a gap mark or **+**
  fills the slot, the label opens the dance's form, the venue opens the venue. It MUST also show
  what the phone's card leaves out — the start time, the venue and the notes line — and set Caller,
  Music and Sound side by side across the card, each still a term beside its names. FR-002a and
  FR-003 (display-only, a tap opens the dance) are the phone's.

#### Where the list opens, and scrolling both ways

- **FR-007**: At every width, Booking Central MUST open on the **default dance** — the first dance
  dated today or later, or, if there is none, the most recent (today on the device's date, as
  feature 079 set; the reverse of check-in's rule, which looks back because the door records the
  evening just past, while the Booker works ahead) — showing about ten dances with the default
  dance last in view and the dances still to come above it. The default dance MUST stop short of
  the window's bottom, clear of a phone browser's own bar (Chrome on the iPhone covers it).
- **FR-008**: The list MUST load later dances when the Booker reaches its top, and older dances when
  they reach its foot, without end until there are no more that way; loading above MUST NOT move
  what is in view.
- **FR-009**: Each end MUST say "Loading…" while more load that way, and say so when there are no
  more dances that way. There MUST be no button at either end: scrolling, or the arrow keys, loads
  more *(amended 2026-10-01 — Rich: the buttons are not needed; this retires 087's "load older"
  button too)*.
- **FR-010**: The "Showing dances from" control MUST be removed at every width.

#### Above the dances

- **FR-011**: Booking Central MUST show exactly the series the viewer's roles name — one or several
  (Rich, 2026-10-02: a Booker of contra and the community dance sees those two, not ECD) — and every
  series only when they name none (a club-wide role). Its title MUST say which, one line at every
  width: "Booking Central — {series names, joined by &}", or "Booking Central — All series"; the
  separate series heading MUST be removed.
- **FR-012**: Below 48rem, only the title and a **Performers** button MUST sit above the cards. The
  button MUST open a dialog (the shared dialog, feature 089) holding the performer-and-band search
  and, when there are any, the performers who need a contact — with everything each offers today.
- **FR-013**: At 48rem and wider, the search and the "performers need a contact" prompt MUST stay in
  view above the cards, as above 087's table — unless the window is short (FR-018).
- **FR-016**: On Booking Central the volunteer bar MUST stay pinned to the top of the window as the
  page scrolls (it opens scrolled down the page); its Menu, opened, MUST scroll within itself. Other
  volunteer pages are unchanged.
- **FR-017**: Beneath the pinned bar, the page's title and its controls (FR-012, FR-013) MUST stay
  pinned too, at every width, the title in a smaller size than a page title elsewhere; a dance
  scrolled to the top of the list MUST stop clear of them.
- **FR-019**: A band's member search MUST offer **New performer “{what was typed}”** after every
  answer — the one wanted may not be among those found — to a volunteer who may change the band. It
  MUST open the existing performer form (feature 084) over the band, the typed name carried in; once
  the performer is created, they MUST join the band's members, unticked as lead and with no
  instrument, to be set before the band is saved. Closing the form adds no one.
- **FR-018**: In a window under 450px tall (a phone on its side), the search and the prompt MUST
  collapse into the **Performers** button of FR-012, placed at the far end of the title's line, so
  the pinned header is one line.

#### Unchanged

- **FR-014**: Who may see Booking Central, and who may change what in it, MUST NOT change; the
  dances, bookings and prompts it shows MUST be the same at every width — only their arrangement
  changes.

### Key Entities

- **Dance**: an event on the club's calendar, as Booking Central lists it — date, start time,
  series, label, venue, note, cancelled or not, and its bookings. Nothing new is stored.
- **Booking**: a performer booked for a dance in a role, with its state (proposed, requested,
  tentative, confirmed, declined) and note. Unchanged.
- **Default dance**: not stored — the first dance dated today or later, else the most recent, among
  the dances the viewer is shown.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At 320 and 390 px wide, Booking Central never scrolls sideways, and every control on
  the page and in an opened dance measures at least 44 × 44 px.
- **SC-002**: On opening, at every width, the default dance is the last dance in view, with no
  action by the Booker.
- **SC-003**: From the opened page, the Booker reaches a dance a year ahead or a year back by
  scrolling (or the arrow keys) alone — no date to set.
- **SC-004**: On a phone, the Booker confirms a tentative booking for a dance in view in three taps
  — the card, the booking's state letter, and closing the dance — and each earlier step takes one
  more tap on the letter.
- **SC-005**: For each role that may see Booking Central, the dances, bookings, gap marks and
  actions offered are the same at a phone width as at a computer width.

## Assumptions

- **Which series.** The hub shows every series the viewer's roles name — no longer only when they
  name exactly one (087, by 086's rule) — and every series for a club-wide role (FR-011). It is a
  default, not a permission: each dance's own page still decides who may change it. No series
  selector is added.
- **"About ten dances."** The number in view depends on the screen; the list loads enough to fill
  the window above the default dance and a page below it, so the Booker can scroll at once.
- **Order.** Newest first, as today, at every width; the opening position, not the order, puts the
  coming dances above the default.
- **The editors** the opened dance opens — booking, band, venue, event — are the existing ones.
- **Tablets.** At 48rem and wider a tablet shows the wide, live cards (the draft's §4.1: tablets in
  scope, portrait and landscape).
- **No phone-only Booker stories** were gathered (the draft's Q2): the phone shows the same hub,
  arranged as cards, not a separate phone view.
- **The hub's read** today pages only backwards, below an upper date; opening on the default dance
  and loading later dances needs it to page forwards from a dance as well (the draft's §7 item 9).
  How is the plan's to decide.
- **Out of scope**: the organizer report looking ahead (B59), telling apart two dances that differ
  only by venue (B60), and a venue when a dance is made (B63) — all still in the backlog.
