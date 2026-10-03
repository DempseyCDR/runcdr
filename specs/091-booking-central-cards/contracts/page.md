# Contract: Booking Central's page (`/bookings`)

What the page shows and does at each width (feature 091). One card per dance at every width — 087's
table is retired (Rich, 2026-10-01). The gap marks, state letters and editors are feature 087's and
unchanged unless stated.

## At every width

| # | Element or behaviour | Spec |
|---|---|---|
| P1 | The page shows exactly the series the viewer's roles name, one or several (the read's `series=tnc,cdob`), or every series when they name none. The title is one line: "Booking Central — Thursday Night Contra & Community Dance", or "Booking Central — All series". No second series heading. | FR-011 |
| P2 | No "Showing dances from" control. | FR-010 |
| P3 | On opening, the page asks for a `newer` page from today and an `older` page before today (contracts/report-api.md), then scrolls so the default dance's last line is at the bottom of the window. | FR-007 |
| P4 | Scrolling to the top of the list — or the arrow keys — loads the next `newer` page, once the page has opened; the top says "Loading…" meanwhile. What was in view does not move. When there are no more, it says "No later dances". No button. | FR-008, FR-009 |
| P5 | Scrolling to the foot loads the next `older` page ("Loading…" meanwhile). When there are no more, "No earlier dances". No button. | FR-008, FR-009 |
| P6 | No dances at all: one line says so; neither end offers to load. | Edge cases |
| P7 | After a save, the page re-reads the span it holds and keeps its place. | FR-004, R9 |
| P8 | The default dance stops 6rem (plus the safe area) short of the window's bottom, clear of a phone browser's bar; the volunteer bar is pinned to the top of the window on this page only, its open Menu scrolling within itself. | FR-007, FR-016 |
| P9 | Under the bar, one header holds the title (smaller, 1.125rem) and its controls — the search and the needs-a-contact prompt on a computer, Performers on a phone — pinned as the page scrolls (`AdminPage`'s `head` and `pinned`; the page keeps `--volunteer-bar-height` set). | FR-017 |
| P10 | Under 450px tall (`max-height: 450px`, a phone on its side), at any width: the search and the prompt collapse into **Performers**, at the far end of the title's line (`AdminPage`'s `headBeside`) — one line. | FR-018 |

## Below 48rem — the cards

| # | Element or behaviour | Spec |
|---|---|---|
| C1 | A list (`aria-label="Dances"`) of cards, one per dance, newest first — at every width. No table. | FR-001, FR-006 |
| C2 | A card shows the date, series, label (or the series when there is none), caller and band or musicians — each performer as first initial and last name ("C. Sloboda"), a musician beside a band joined by "feat." — each with its state letter as text, and the gap marks as marks; "Cancelled" in words. Caller, Music and Sound are a description list, each term top-aligned with the first line of its names. | FR-002, FR-002b |
| C3 | One button per card, named by its date, series and label, covering the card: a tap anywhere opens the dance. Nothing on the card advances a letter or fills a gap. | FR-002a |
| C4 | Only the title and a **Performers** button sit above the cards. | FR-012 |
| C5 | **Performers** opens a dialog headed "Performers": the performer-and-band search, then, when there are any, the performers who need a contact. Opening a performer or band from it stacks its dialog on top. | FR-012 |
| C6 | Nothing scrolls sideways at 320 px; every control is at least 44 × 44 px. | FR-001, SC-001 |

## The opened dance (below 48rem)

| # | Element or behaviour | Spec |
|---|---|---|
| D1 | The shared dialog, filling the screen, headed by the dance (date, series, label). | FR-003 |
| D2 | Sections headed Venue, Caller, Music, Sound (Sound only where the series wants one) and Notes, holding the same controls as the row: names — first initial and last name, as on the card — that open their booking, state letters that advance, gap marks and **+** that fill or add, the venue — its full name — that opens the venue. | FR-003 |
| D3 | A button into the dance's own form ("Edit dance", or "View dance" read-only). | FR-003 |
| D4 | Editors opened from it stack on top; saving one updates both the opened dance and its card. | FR-003, FR-004 |
| D5 | Close, Escape or the phone's Back closes it; the list is where it was, focus on the card's button. | FR-003a |
| D6 | A volunteer who may not book sees it read-only, as their computer row is: letters as text, no **+**, gap marks as marks; a name still opens its booking, read-only. | FR-005 |

## 48rem and wider — the live card

| # | Element or behaviour | Spec |
|---|---|---|
| T1 | The same list of cards, each **live** as 087's row was — a name opens its booking, a letter advances, a gap mark or **+** fills the slot, the label opens the dance's form, the venue its venue — with no card-wide button. Its heading line: date · time · series (when there is a label) · label · venue (its full name — the short code fit only the table's narrow column), and "Cancelled"; then Caller, Music and Sound side by side. The list is one grid of six columns — term, names, term, names, term, names — that every card takes as a subgrid, so the columns line up from card to card: each term's column is its word, never wrapped; each names column gets the room its widest unbreakable piece needs (a performer's name, its letter and its +, kept together — a band's name may wrap), and the rest is shared 1 : 2 : 1 (Caller, Music, Sound). Sound's columns are empty where a series has none. Each term sits beside its names (first initial and last name, "feat."); then the notes line. | FR-006, FR-002b |
| T2 | The search and the "N performers need a contact" prompt above the cards, in the pinned header — unless the window is short (P10). | FR-013 |

## A band's roster

| # | Element or behaviour | Spec |
|---|---|---|
| B1 | The "Add a member" search offers **New performer “{typed}”** after every answer (not to a read-only viewer). It opens a dialog headed "New performer" over the band, holding the performer form with the typed name split into first and last; **Create** makes the performer, closes the dialog, and lists them among the members, ticked, not the lead, no instrument. Close adds no one. | FR-019 |

## Crossing 48rem

| # | Behaviour | Spec |
|---|---|---|
| X1 | The cards switch between the phone's and the wide, live ones, keep the loaded dances and any open dialog, and keep the dance last in view in view. | Edge cases, R6 |
