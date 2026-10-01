# Quickstart: validating the volunteer frame

**Feature**: 090-volunteer-frame

## 1. The automated gates (dev server stopped)

```bash
pnpm tsc --noEmit
```

```bash
pnpm vitest run
```

```bash
pnpm build && rm -rf .next/dev
```

Expected: every test passes, including the new unit, integration and component tests and the
extended style guard. The per-role menus in `authz.nav` offer the same destinations as before,
only grouped.

## 2. The menu, by role (a computer)

Sign in as each of:

- a Door Attendant: a flat row of 3 — Check-in, Organizer report, Contacts;
- the Financial Secretary: a flat row of 6;
- the Treasurer: grouped;
- a Booker;
- a Super-user: grouped, 20 destinations.

For each, check that:

- **One bar:** it is the band colour, with no public bar above it on any volunteer page.
- **Groups:** Tonight's links come first and flat; the other groups follow in order (Booking,
  Reports, People, Settings, Website). Empty groups are absent, and a one-item group is a link.
- **Names:** "Gate report" appears (not "Treasurer report"). "Volunteer" and "Club site" are there.
- **Keyboard:** Tab to a group, then Enter; Down, Up, Home and End move within it; Escape closes it
  and returns focus. Clicking outside closes it, and hovering opens nothing.
- **Public pages:** on a public page (What's On), both bars show.

## 3. The menu on a phone

At 320 × 640 and 390 × 844, as the Financial Secretary and as a Door Attendant:

- **One line:** the bar is the name and Menu, with no sideways scroll.
- **The Menu:** it lists Tonight first, then every group open under its heading, then Sign out and
  Club site.
- **Closing:** choosing a destination closes it and goes there; Escape closes it; pressing Menu
  again closes it.
- **Tap size:** every control measures at least 44 × 44 (feature 089's quickstart §2 script).
- **Enlarged text:** at 200% text the bar and the Menu wrap rather than clip.

## 4. Landing and sign-in

- **Sign-in page:** signed out, open `/login` at 320, 390 and on a computer. Check the public bar,
  the logotype beside (or above) the sign-in, "Volunteer" wording, the four additions, and Google's
  button. "Can't sign in?" opens Contact Us.
- **Landing:** sign in from `/login`, and you land on `/volunteer`, which lists exactly your menu's
  destinations, grouped the same way.
- **Returning to a page:** open `/payments` signed out, sign in, and you return to `/payments`.

## 5. The organizer report

- **Landing on your series:** as a volunteer whose roles name one series (for example the ECD
  organizer), "Organizer report" in the menu opens that series. As a club-wide volunteer it opens
  TNC.
- **The selector:** switching series with it shows each series' report.
- **Printing:** Print from desktop Chrome and Safari, and from Chrome on a phone, gives the report
  alone on landscape letter. On iPhone Safari the note shows instead of Print.

## 6. On the phones, through the tunnel

On the iPhone (Safari) and a Galaxy (Chrome and Samsung Internet):

- the bar is one line;
- the Menu opens and closes;
- Back (the edge swipe) leaves the page as usual — the Menu is not a dialog;
- the sign-in page, the landing and the organizer report behave as above.
