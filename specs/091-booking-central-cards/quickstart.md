# Quickstart: Booking Central on a phone

How to prove feature 091 works. The page contract is [contracts/page.md](contracts/page.md); the
read's is [contracts/report-api.md](contracts/report-api.md).

## §1 Tests (dev server stopped)

The integration tests share the dev database; a running dev server or build disturbs them.

```bash
pnpm vitest run tests/integration/bookings.report.test.ts tests/integration/bookingsReport.booker.test.ts
```

```bash
pnpm vitest run tests/unit tests/component
```

Expected: green. The report tests cover A1–A7; the component tests cover P1–P7, C1–C6, D1–D6 and T1.

## §2 The read, by hand (dev server running, signed in)

In the browser's address bar, with today's date as `split`:

- `/api/bookings/report?series=tnc&split=<today>&direction=newer&limit=3` — the next three TNC
  dances, nearest first.
- `/api/bookings/report?series=tnc&split=<today>&direction=older&limit=3` — the three before today,
  newest first.
- `…&direction=sideways` — 422.

## §3 Opening and scrolling (a computer, then a phone width)

As the Booker (or a Super-user), open Booking Central:

- **The title** is "Booking Central — Thursday Night Contra" (or "— All series"); no date control.
- **The opening position**: the next dance — the first dated today or later — is the last dance in
  view; later dances are above it.
- **Up**: scroll to the top; later dances load above, and what was in view does not move. Keep going
  until "No later dances".
- **Down**: older dances load below, until "No earlier dances".
- **The keyboard**: the up and down arrow keys scroll to either end and load more, as scrolling
  does; there are no buttons at the ends.

## §4 The cards (320 × 640 and 390 × 844)

- One card per dance; no sideways scroll; above them only the title and **Performers**.
- A card shows the date, series, label, caller and band with their letters, and the gap marks; each
  performer is "C. Sloboda" — first initial and last name.
- On opening, the next dance's card stops clear of the browser's own bar at the bottom (Chrome on
  the iPhone); the volunteer bar stays pinned at the top as the page scrolls, and its Menu opens.
- Tapping a letter on a card does **not** change it — the dance opens instead.
- **The opened dance** fills the screen: Venue, Caller, Music, Sound, Notes. Advance a letter; fill
  a gap; open a booking (its editor stacks on top) and save it. Close: the card shows the change and
  the list has not moved.
- **Back** on the phone closes the opened dance.
- **Performers**: the search and the needs-a-contact list; open a performer — its card stacks on
  top.
- Every control measures at least 44 × 44 (feature 089's measuring script).
- At 200% text, cards wrap and nothing is clipped.

## §5 Crossing the width

On a computer, the cards are live, with the time, venue and notes, and Caller, Music and Sound side
by side; there is no table. Narrow the window through 768 px and back: the phone's cards and the
live ones swap, and the same dances
stay in view.

Make the window under 450 px tall (or turn a phone on its side): the header is one line — the title,
and **Performers** at its far end; the search and the prompt are inside Performers.

## §6 On real phones (through the tunnel)

Rich: an iPhone (Safari and Chrome) and a Galaxy (Chrome and Samsung Internet) — §3 and §4. Safari
is the one that matters for "loading above does not jump" (research R3).
