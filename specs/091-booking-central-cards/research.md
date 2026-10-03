# Research: Booking Central on a phone

Feature 091. Decisions for the plan; each names what was chosen, why, and what was set aside.

## R1 — The hub's read pages both ways from a split date

**Decision**: `/api/bookings/report` gains two query parameters and loses one.

- `split=YYYY-MM-DD` — the boundary the list opens on. The client passes **today on the device's
  date** (`localToday`, feature 079); the server never decides what "today" is.
- `direction=older|newer` (default `older`):
  - `older` — dances dated **before** `split`, newest first (today's order), continued by `cursor`.
  - `newer` — dances dated **on or after** `split`, **nearest first**, continued by `cursor` in
    that direction.
- `horizon` is **retired** (FR-010): no longer read at all, as feature 087 retired the old filters
  rather than half-honour them.

The page opens with two requests: a `newer` page from today and an `older` page before today. The
two answers partition every dance exactly once: `date >= split` versus `date < split`.

**Rationale**: the order and the cursor already exist and are proven
(`afterCursor` in `reportService.ts`, feature 087 research R2). The newer direction is their exact
mirror — the same three-part order `(event_date, start_time, id)` reversed — so no dance can be
dropped or repeated at a page boundary in either direction, and one integration test can page both
ways and count every dance once. A split date (not a split *dance*) keeps the first request simple:
nothing has to be found before the list can be asked for.

**The reversed order, exactly.** Older is `event_date desc, start_time desc nulls last, id desc`.
Newer is its reverse: `event_date asc, start_time asc nulls first, id asc`, with a `beforeCursor`
condition written beside `afterCursor` so the two cannot drift. One consequence: on a day with an
untimed and a timed dance, the untimed one sorts first going forward (it sorts last going back).
Untimed dances are rare (feature 013 made the time optional), and the only effect is which of two
same-day dances is the default.

**Alternatives considered**:

- *An `around=<eventId>` request returning both sides at once* — one round trip, but a new response
  shape, and the default would have to be found server-side first. Two requests of an existing shape
  are simpler.
- *Keep `horizon` and widen it as the Booker scrolls up* — re-reads the whole list each time, and
  the page could never know when the future ran out.

## R2 — The default dance is found from the answers, not computed

**Decision**: the default dance is the **first row of the first `newer` page** — the nearest dance
dated today or later. If that page is empty, it is the **first row of the first `older` page** — the
most recent. No new server logic.

**Rationale**: FR-007 is exactly what the two first pages already contain at their near ends.

## R3 — Opening on the default dance, and loading above without a jump

**Decision**:

- **Opening**: once both first pages have rendered, the page scrolls so the **default dance's last
  line** sits at the bottom of the window (`scrollIntoView({ block: "end" })` on the dance's
  element). Each dance is one element to scroll to: a `<tbody>` per dance in the table (a table may
  hold several, and a dance is its row plus its note row), a list item per card.
- **Loading later dances above**: a sentinel at the top of the list loads the next `newer` page when
  it comes into view — **only after** the opening scroll, or it would fire at once. Before the new
  dances are added, the page notes the **dance at the top of the view and where it stands**; in a
  layout effect after they render, it scrolls by however far that dance moved, so what was in view
  stays put. *(Found in the browser: the first version scrolled by the growth in the document's
  height, which fell 263px short — new rows changed the table's column widths, the rows below
  re-wrapped shorter, and the page grew by less than what was added above the Booker's place.)*
- **Loading older dances below**: unchanged from feature 087 (a sentinel at the foot).
- **No buttons at the ends** *(Rich, 2026-10-01 — reversing this plan's first version, which kept
  087's reason for its "older" button: an endless scroll alone traps keyboard users)*. Rich found
  the arrow keys scroll the list to either end, which loads more, as for anyone scrolling. Each end
  says "Loading…" while it loads and, when a direction is exhausted, says so (FR-009).
- The list sets `overflow-anchor: none`, so a browser's own scroll anchoring cannot add to the
  manual correction.

**Rationale**: browser scroll anchoring would do the "no jump" for free, but Safari does not support
it, and the Booker's phones include iPhones. The manual correction is a few lines and behaves the
same everywhere.

**Alternatives considered**:

- *An inner scrolling box* instead of the page — scrollbars inside the page, and a phone's address
  bar no longer collapses. Rejected: the page itself scrolls today.
- *Rely on `overflow-anchor`* — fails on Safari (above).

## R4 — One set of parts for the row, the card and the opened dance

**Decision**: split `HubRow` into a function that computes a dance's **parts** — title, venue,
caller cell, music cell, sound cell, notes — from the row and the (optional) actions, and three
presentations of them:

- **`HubRow`** — the table row, as today (the parts in `<td>`s, notes in the row beneath).
  *(Retired 2026-10-01 with the table — see R6's note; the wide card takes its place.)*
- **`HubCard`** — the card: the parts computed **without actions**, which already yields what
  FR-002a asks — names as text, state letters as text, gap marks as marks, nothing that changes a
  booking (087 built that read-only form for viewers who may not book).
- **`DanceView`** — the opened dance, in the shared `Dialog`: the parts computed **with** the
  actions, under labelled headings (Venue, Caller, Music, Sound, Notes), plus a button into the
  dance's own form.

**Rationale**: SC-005 and FR-014 require the same bookings, gaps and actions at every width; one
source of parts makes that true by construction rather than by keeping three copies in step. It also
reuses 087's read-only path instead of inventing a "display" mode.

**Alternatives considered**: a separate card component re-deriving the bands, loose musicians and
gaps — three copies of the band-lead and "fills" rules, the logic 087 found hardest to get right.

## R5 — The card is a list item with one stretched button

**Decision**: each card is an `<li>` whose heading holds a single `<button>` naming the dance (date,
series, label), stretched over the whole card (`::after`, `inset: 0`). The rest of the card — names,
state letters, gap marks — is ordinary text and marks, read in order by a screen reader.

**Rationale**: "a tap anywhere opens the dance" (FR-002a) without making the whole card one giant
button whose accessible name is every name and letter on it. Valid HTML (a button holds phrasing
content only, so the card's blocks cannot be inside it).

**Alternatives considered**: the card as one `<button>` (invalid block content, an unwieldy name);
a card with an "Open" button (a smaller target than the card the Booker expects to tap).

## R6 — Cards or table: one tree at a time, chosen by the width

**Decision**: the page renders **either** the cards **or** the table, chosen by a media query
(`min-width: 48rem`) read with `useSyncExternalStore` (server snapshot: the table — the server
renders no rows anyway). The loaded rows, cursors and open dialogs are the page's state, shared by
both, so crossing 48rem keeps the same dances; the page re-anchors on the dance last in view.

**Rationale**: rendering both and hiding one with CSS would double every control on the page (each
dance has up to a dozen buttons) and the tests would find each twice. The hub needs JavaScript
anyway (spec edge cases), so a script-chosen layout costs nothing.

**Alternatives considered**: both trees with CSS hiding (above); a separate phone page (rejected by
the draft's Q2 — "no separate phone view").

**Superseded 2026-10-01 (Rich: "the card format should be the basis for all widths").** The table
and `HubRow` are retired. The width still chooses, but now between two forms of the one card: below
48rem the phone's (display-only, a tap opens the dance), from 48rem the **live** card — the parts
with actions, as 087's row had them, plus the time, the venue and the notes, with Caller, Music and
Sound side by side. **The columns are a subgrid** (Rich, 2026-10-01): the list is one six-column
grid (term, names × 3) that each wide card adopts, so columns are sized from every card together and
line up down the list — terms `max-content` and never wrapped, names
`minmax(min-content, 1fr | 2fr | 1fr)`, which first gives each column its widest unbreakable piece
(a name with its letter and its +, kept as one) and then shares the rest 1 : 2 : 1. Equal thirds
were tried first: a + wrapped alone and read as the next column's. At exactly 768px today's names
fit with little to spare. R4's one set of parts now feeds the two cards and the opened dance. A
second query, `max-height: 450px` (a phone on its side), collapses the header's search and prompt
into the Performers button on the title's line (FR-018).

## R7 — Above the dances

**Decision**:

- The title is `AdminPage`'s own: `"Booking Central — " + (series name or "All series")`; the
  separate `<h2>` series heading and the "Showing dances from" control are removed.
- **Below 48rem**: a **Performers** button opens a `Dialog` holding the existing `HubSearch` and,
  when there are any, the list of performers who need a contact.
- **48rem and wider**: unchanged — `HubSearch` inline and the "N performers need a contact" prompt.
- The needing-a-contact list, today written inside its own dialog in `page.tsx`, becomes one
  component (`NeedingContactList`) used by that dialog and by the Performers dialog.
- A performer or band opened from the Performers dialog opens its own dialog **on top**, as from the
  computer's search (feature 089's dialog stack).

**Rationale**: the decisions of the draft's §7 item 9; the extraction is the second use of the list,
needed to show it in two places without a copy.

## R8 — The query is validated at the boundary

**Decision**: a Zod schema for the report's query (`series`, `split`, `direction`, `cursor`,
`limit`) in `src/server/validation/bookings.ts`; a malformed `split` or `direction` answers 422
`VALIDATION_ERROR`, the project's code for a malformed request. The cursor stays opaque but is
decoded defensively (a bad cursor answers 422, not 500).

**Rationale**: the constitution's Type Safety principle — external API boundaries validated with a
schema library. The route today reads its parameters unvalidated; touching it is the time to fix it.

## R9 — Keeping the place after an edit

**Decision**: after a save, the page re-reads **the same span** it has loaded: a `newer` page from
`split` as long as the newer rows it holds, and an `older` page before `split` as long as the older
rows (each capped at the API's 200). The split stays the one the page opened with.

**Rationale**: today's `refresh` re-reads "as many rows as are showing" from the top; with two
directions, the same idea applies to each side. A dance given a new date moves to its place (spec
edge case).
