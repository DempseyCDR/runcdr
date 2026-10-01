# Feature Specification: The volunteer frame

**Feature Branch**: `090-volunteer-frame`

**Created**: 2026-09-30

**Status**: Draft

**Input**: User description: "the volunteer frame." — the second of the two features the mobile
conventions review split out (`specs/phase-8-requirements/mobile-volunteer-conventions.md`, §7 item
1, decided 2026-09-28). Feature 089 built the shared building blocks; this feature is the frame
every volunteer page sits in: the menu, where a volunteer lands, and the sign-in page.

Every page a signed-in volunteer visits carries two bars today: the public site's menu, and under it
the volunteer menu — one flat row of up to twenty links, with "Signed in as …" and Sign out at the
end. On a phone that row wraps into a tall block before any work appears. Signing in returns a
volunteer to the public home page, so the first thing they do is look for their work. The sign-in
page itself is a bare form that says "Staff".

This feature gives volunteers a frame of their own: **one coloured volunteer menu, grouped by the
kind of work, that collapses on a phone**; a **volunteer home page** that sign-in lands on; a
**sign-in page** that looks like the club's and says who it is for; and two small corrections the
review found along the way — the gate report's menu name, and the organizer report opening on the
volunteer's own series.

The thing to hold on to: **a volunteer reaches their own work in one tap, on any screen, and every
volunteer page is plainly a volunteer page.** Nobody gains or loses access to anything: the menu
only signposts, and every page still decides for itself who may use it.

## Clarifications

### Session 2026-09-30

- Q: Where does a volunteer land after signing in? → A: On a **volunteer home page** — their own
  menu laid out as a page, grouped, Tonight first (the review's Q10 reading, confirmed).
- Q: Is the organizer report's print styling part of this feature? → A: **Yes.** It prints the
  report alone — no menu, no selector — as the gate report does.
- Q: On a phone, how are the groups shown inside the open Menu? → A: Every group listed **open**,
  its destinations under its heading — two taps to anything (Menu, then the destination).
- Q: At phone width the name, Tonight's pages and the Menu button do not fit on one line for anyone
  holding two or three of Tonight's pages (about 475 px against 358). What gives way? → A: **Tonight
  moves inside the Menu**, listed first; the bar is the name and the Menu button, always one line.
  (Reverses the review's Q9 "Tonight stays visible outside the collapsed menu"; decided during
  planning.)

### Session 2026-10-01

- Q: With every group open, the Menu is too long on a phone for a role with many pages (the
  Treasurer). Does "two taps to anything" still hold? → A: **Relaxed.** In a grouped menu, Tonight's
  pages stay open at the top — still two taps — and each other group is listed **collapsed**; a tap
  opens it in place, so its pages are three taps away. A flat menu (six or fewer: the Door
  Attendant, the Financial Secretary) still shows everything. *(Rich, after using 090; supersedes
  the 2026-09-30 "every group listed open".)*

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A grouped, coloured volunteer menu (Priority: P1)

Wendy, the Treasurer, signs in on her laptop. On every volunteer page one coloured bar shows her
work grouped by kind: **Tonight** (Gate money, Payments) first and always open, then **Reports**,
**People**, **Settings** and the others as groups that open on demand. (A Financial Secretary, with
six destinations, keeps a flat row.) The public site's bar is gone
from volunteer pages; one link in the volunteer bar returns to the club's site.

**Why this priority**: the menu is how every volunteer reaches every page; a Super-user's twenty
links in one row are hard to scan, and two stacked bars waste the top of every screen.

**Independent Test**: sign in as three volunteers — a Door Attendant, the Financial Secretary, a
Super-user — and compare their menus with the groups below; open and close each group with the
mouse and with the keyboard.

**Acceptance Scenarios**:

1. **Given** a volunteer page, **When** it is shown to a signed-in volunteer, **Then** only the
   volunteer bar appears at the top — not the public site's bar — and it carries one link to the
   club's public site.
2. **Given** a volunteer with more than six destinations, **When** the menu is shown, **Then** they
   are grouped: **Tonight** (Check-in, Gate money, Payments) first and flat; then **Booking**
   (Booking Central, Events, Venues); **Reports** (Organizer report, Gate report); **People**
   (Contacts, Mailing-list exports); **Settings** (the four parameter pages, Access control, Route
   index); **Website** (Content pages, Officers, Announcement, Campaigns).
3. **Given** a group the volunteer holds nothing in, **When** the menu is shown, **Then** it does
   not appear; **Given** a group with one destination, **Then** it is a plain link, not a group.
4. **Given** a volunteer with six destinations or fewer (a Door Attendant has three), **When** the
   menu is shown, **Then** it is a flat row with no groups.
5. **Given** the gate report, **When** it appears in the menu, **Then** it is called **"Gate
   report"**, matching the page (it was "Treasurer report").
6. **Given** a public page, **When** a signed-in volunteer visits it, **Then** both bars appear as
   today — the public bar, then the volunteer bar.
7. **Given** the menu, **When** it is used with a keyboard, **Then** a group opens with Enter or
   Space, the arrow keys move within it, Escape closes it and returns focus to the group's button,
   and a screen reader is told whether each group is open.

---

### User Story 2 - The menu on a phone (Priority: P1)

Meg is at the door with her phone. The volunteer bar is one short line: her name and a Menu button.
Inside the Menu, Tonight's work (Check-in) comes first, then everything else and Sign out.

**Why this priority**: today the flat menu wraps into a tall block on a phone, and the door, gate
and payments pages are used standing up, on a phone, under time pressure.

**Independent Test**: at 320 and 390 px wide, sign in as a Door Attendant and as the Financial
Secretary; the bar is one line; the Menu opens with Tonight's pages first; Sign out is inside it.

**Acceptance Scenarios**:

1. **Given** a screen narrower than the second named width (48rem, about 768 px), **When** a
   volunteer page is shown, **Then** the volunteer bar collapses behind a **Menu** button.
2. **Given** someone who holds any of Tonight's pages, **When** they open the Menu, **Then** those
   pages are listed first, under "Tonight" — two taps from anywhere (Menu, then the page).
3. **Given** the collapsed bar, **When** it is shown, **Then** the signed-in volunteer's **name**
   stays in plain view (shortened from "Signed in as {name}"), and **Sign out** is inside the Menu.
4. **Given** a grouped menu and the Menu open, **When** it is shown, **Then** Tonight's pages are
   listed open and each other group is listed collapsed, in the menu's order; **When** a group is
   tapped, **Then** its pages open beneath it (one group open at a time). A flat menu lists every
   destination — any is the next tap.
5. **Given** the Menu open, **When** a destination is chosen, or Escape is pressed, or the Menu
   button is pressed again, **Then** the Menu closes.
6. **Given** a phone, **When** the bar is shown, **Then** it fits on one line at 320 px and never
   makes the page scroll sideways; every control in it meets the tap minimum.

---

### User Story 3 - Landing on a volunteer home page (Priority: P2)

Sean signs in. Instead of the public home page he lands on **his volunteer home page**: his own
destinations laid out as a page, grouped as in the menu, Tonight's work first — so whatever he came
to do is one tap away.

**Why this priority**: every sign-in today starts with a detour to the public site; this removes it.

**Independent Test**: sign in as each of three volunteers with no page requested; each lands on the
volunteer home page and sees exactly their own destinations, grouped; sign in from a link to a
volunteer page and land on that page instead.

**Acceptance Scenarios**:

1. **Given** a volunteer signing in with no page asked for, **When** sign-in succeeds, **Then** they
   land on the volunteer home page — not the public home page.
2. **Given** a volunteer sent to sign in from a volunteer page, **When** sign-in succeeds, **Then**
   they return to that page, as today.
3. **Given** the volunteer home page, **When** it is shown, **Then** it lists exactly the
   destinations the volunteer's menu offers, in the same groups and order, Tonight first, each a
   tap target.
4. **Given** the volunteer bar, **When** it is shown, **Then** it links to the volunteer home page.

---

### User Story 4 - A sign-in page that looks like the club's (Priority: P2)

Margaret, a new volunteer, is sent the sign-in link. The page wears the public site's bar, shows the
club's logotype beside the sign-in, says it is for volunteers — "Dancers don't need to sign in" —
offers Google's own sign-in button, tells her what to do if she can't get in, and reminds her to
sign out on a shared phone.

**Why this priority**: it is the first volunteer page anyone sees; today it says "Staff", looks like
none of the club's pages, and gives no way forward to someone who cannot sign in.

**Independent Test**: open the sign-in page signed out, at desktop and phone widths; check each
element below; follow the "Can't sign in?" link; sign in.

**Acceptance Scenarios**:

1. **Given** the sign-in page, **When** it is shown, **Then** it has the public site's bar on top;
   beneath it, two blocks of about the same height side by side — the club's logotype on the left,
   the sign-in on the right.
2. **Given** a narrow screen, **When** the page is shown, **Then** the blocks stack, logotype first,
   and the logotype is never wider than the screen.
3. **Given** its wording, **When** read, **Then** it says **"Volunteer"** where it said "Staff"
   ("Volunteer sign-in", "Volunteer areas require …").
4. **Given** the page, **When** read, **Then** it says who it is for — "For club volunteers. Dancers
   don't need to sign in." — and carries a shared-phone reminder: "On a shared phone, sign out when
   you're done."
5. **Given** someone who cannot sign in, **When** they choose **"Can't sign in?"**, **Then** they
   reach the club's Contact Us page.
6. **Given** the sign-in control, **When** shown, **Then** it is Google's standard sign-in button,
   with its "G" mark, in place of today's text link.
7. **Given** a refused sign-in, **When** the page returns with the error, **Then** it says so as
   today — generically, naming no reason.

---

### User Story 5 - The organizer report: your own series, and a clean printout (Priority: P3)

Frank organises the Sunday English Country Dance. "Organizer report" in the menu opens the **ECD**
report, not Thursday Night Contra's; a small series selector on the report switches to any other.

**Why this priority**: the menu has always opened the TNC report for everyone; feature 086 set the
rule that a default narrows to the viewer's own series (and a permission never does). The report is
also the document the club prints and hands out at meetings; with the coloured bar on every page, it
must print without it.

**Independent Test**: as volunteers whose roles name one series, open the report from the menu;
as a club-wide volunteer, open it; switch series with the selector.

**Acceptance Scenarios**:

1. **Given** a volunteer whose roles name exactly one series, **When** they open the organizer
   report from the menu or the home page, **Then** it opens on that series.
2. **Given** a volunteer whose roles name no single series (club-wide, or several), **When** they
   open it, **Then** it opens on Thursday Night Contra (TNC), as today.
3. **Given** the report, **When** shown, **Then** an unobtrusive series selector offers every
   series; choosing one shows its report. The organizer reports stay visible to every volunteer.
4. **Given** the report, **When** it is printed, **Then** the printout holds the report alone — no
   menu, no series selector, no Print control — laid out for the paper, as the gate report is.
5. **Given** the gate report, or check-in, gate money or payments, **When** a series is chosen in
   the event selector, **Then** the evening moves to that series' most recent dance (FR-024).

### Edge Cases

- **Grants change while signed in.** The menu, the home page and the collapsed bar all read the
  volunteer's destinations on each page load; a new or removed role shows on the next page.
- **A volunteer with no destinations of their own.** Every volunteer has at least the organizer
  report and Contacts (they need no special role), so the home page is never empty.
- **A page a volunteer cannot use, requested directly.** Still refused by the page itself, as today;
  the menu and home page only signpost.
- **Enlarged text (200%).** The bar and the open Menu wrap rather than clip; nothing scrolls
  sideways.
- **No JavaScript.** Sign out still works (a plain form, feature 083); neither the collapsed Menu
  nor a group on a computer may hide destinations with no way to reach them — without JavaScript
  they are shown open.
- **Printing a volunteer page.** Only reports are printed (§7 item 4): the gate report already
  prints the report alone, and the organizer report gains the same (FR-023). Other volunteer pages
  get no print styling.
- **Printing from Safari on the iPhone.** It cannot print a report as intended (feature 089); the
  organizer report's Print gives way there to the same note as the gate report's (backlog B67).
- **Dark mode.** Not supported: volunteer pages stay light (decided 2026-09-28).

## Requirements *(mandatory)*

### Functional Requirements

#### The volunteer menu

- **FR-001**: Volunteer pages MUST show only the volunteer bar at the top — not the public site's
  bar. Public pages MUST keep both bars when a volunteer is signed in.
- **FR-002**: The volunteer bar MUST carry the volunteer look (the Volunteer colour), so every
  volunteer page is marked by it; pages MUST no longer opt in to the look one by one.
- **FR-003**: The volunteer bar MUST carry one link to the club's public site and one to the
  volunteer home page.
- **FR-004**: A volunteer with more than six destinations MUST see them in these groups, in this
  order: **Tonight** (Check-in, Gate money, Payments — always shown flat, first); **Booking**
  (Booking Central, Events, Venues); **Reports** (Organizer report, Gate report); **People**
  (Contacts, Mailing-list exports); **Settings** (Rate parameters, Admission pricing, Expense
  parameters, Door parameters, Access control, Route index); **Website** (Content pages, Officers,
  Announcement, Campaigns).
- **FR-005**: A group with no destinations for the volunteer MUST NOT appear; a group with exactly
  one MUST appear as a plain link. A volunteer with six destinations or fewer MUST see a flat row.
- **FR-006**: The gate report MUST be called **"Gate report"** in the menu.
- **FR-007**: Which destinations a volunteer sees MUST NOT change: the menu offers exactly what it
  offers today, only grouped. It MUST remain a signpost — every page enforces its own access.
- **FR-008**: The menu MUST be usable without a mouse or touch: a group opens with Enter or Space,
  the arrow keys move within it, Escape closes it and returns focus to its button, and a screen
  reader is told whether each group is open.
- **FR-009**: The current page's destination MUST be marked as current, as today.

#### The menu on a phone

- **FR-010**: Below the second named width (48rem), the volunteer bar MUST collapse to the
  volunteer's name and a **Menu** button, on one line. Every destination — Tonight's first — and
  Sign out MUST be inside the Menu.
- **FR-011**: At phone width the signed-in label MUST shorten from "Signed in as {name}" to the
  **name**; it MUST never be hidden.
- **FR-012**: In a grouped menu, the open Menu MUST list Tonight's pages open, first, under their
  heading, and each other group of two or more **collapsed**, in the menu's order; tapping a group
  MUST open its pages in place, one group at a time; a group of one MUST be a plain link. A flat
  menu MUST list every destination. The Menu MUST close when a destination is chosen, on Escape
  (an open group closes first), or when the Menu button is pressed again; it MUST reopen with its
  groups collapsed. *(Amended 2026-10-01: groups were listed open.)*
- **FR-013**: The bar MUST fit on one line at 320 px, MUST NOT cause sideways scroll at any
  supported width, and every control in it MUST meet the tap minimum (feature 089).

#### The volunteer home page

- **FR-014**: There MUST be a volunteer home page listing exactly the volunteer's menu destinations,
  in the menu's groups and order, Tonight first, each a tap target. At every width the groups MUST
  sit in exactly two equal columns, paired in rows so each pair starts on one line and its cards are
  level (a flat menu's cards likewise) — one column is too long on a phone (Rich, 2026-09-30). On a
  phone, where a label may wrap to two lines, every card MUST be tall enough for two, so the cards
  stay level; nothing may scroll sideways at 320 px.
- **FR-015**: A successful sign-in with no page requested MUST land on the volunteer home page.
  A sign-in started from a volunteer page MUST return to that page, as today.

#### The sign-in page

- **FR-016**: The sign-in page MUST carry the public site's bar, then the club's logotype and the
  sign-in side by side, stacking on a narrow screen (logotype first, never wider than the screen).
- **FR-017**: Its wording MUST say **"Volunteer"** in place of "Staff".
- **FR-018**: It MUST say who it is for ("For club volunteers. Dancers don't need to sign in."),
  carry a shared-phone reminder ("On a shared phone, sign out when you're done."), and offer a
  **"Can't sign in?"** link to the club's Contact Us page.
- **FR-019**: The sign-in control MUST be Google's standard sign-in button, with its "G" mark.
- **FR-020**: A refused sign-in MUST still be reported generically, naming no reason (feature 015).

#### The organizer report

- **FR-021**: The organizer report MUST open on the volunteer's own series when their roles name
  exactly one; otherwise on Thursday Night Contra (TNC), as today.
- **FR-022**: The organizer report MUST offer an unobtrusive series selector listing every series;
  every volunteer may still read every series' report.
- **FR-023**: The organizer report MUST print the report alone — no menu, no series selector, no
  Print control — laid out for US Letter, landscape (its per-dance table is wide), as the gate
  report prints. It MUST offer **Print** in a pinned action bar, as the gate report does, including
  the gate report's note in its place on Safari on the iPhone (backlog B67).
- **FR-024**: On every page with the shared event selector (the gate report, check-in, gate money,
  payments), choosing a series MUST select that series' most recent dance up to today (else its
  soonest upcoming one) — the same rule as the first default — so a page never shows an evening
  from another series. The date range still only narrows the list (feature 028). Where the selector
  sits under **Change**, it MUST stay open after a series is chosen, so an earlier evening of that
  series can still be picked; picking an evening closes it. *(Added 2026-09-30 from Rich's browser
  check of quickstart §5, then widened to every such page.)*

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in volunteer reaches any of their destinations in at most two taps from any
  volunteer page on a computer (Tonight's pages in one). On a phone: Tonight's pages, and every
  destination of a flat menu, in two; any other destination in three (amended 2026-10-01).
- **SC-002**: At 390 px wide the volunteer bar is one line high on every volunteer page (from a
  block of several lines for a Super-user today).
- **SC-003**: For every role in the club, the set of destinations offered is identical before and
  after this feature — only their arrangement changes.
- **SC-004**: 100% of volunteer pages show exactly one bar at the top, in the Volunteer colour; 100%
  of public pages still show the public bar.
- **SC-005**: Signing in with no page requested lands on the volunteer home page every time.
- **SC-006**: The menu can be worked end to end with a keyboard alone, and a screen reader
  announces each group's open state.
- **SC-007**: The sign-in page shows all of its elements (FR-016–FR-019) at 320 px, 390 px and on a
  computer, with no sideways scroll.
- **SC-008**: A printed organizer report shows the report alone on landscape letter, from desktop
  Chrome and Safari and from Chrome on a phone.

## Assumptions

- **Scope** (§7 item 1, decided 2026-09-28): the menu and its phone behaviour, dropping the public
  bar on volunteer pages, the volunteer home page, the sign-in page, the "Gate report" rename, and
  the organizer report's series default and selector — plus its print styling (§7 item 4, assigned
  here 2026-09-30). Booking Central's cards and the other page
  conversions follow separately.
- **Builds on feature 089**: the tap minimum, the two named widths, the action bar and the one
  dialog; the collapsed Menu follows the public menu's pattern (feature 046).
- **Who sees what does not change** (feature 016): only the arrangement of the menu changes.
- **The Tonight group** holds Check-in, Gate money and Payments; a volunteer who holds none of them
  sees no Tonight group.
- **"A volunteer's own series"** means the one series their roles name, as feature 086 defined it
  for the gate report, gate money and payments.
- **The Route index** keeps no styling of its own (YAGNI, §7 item 7).
- **The public site is not changed**: its bar and pages are as they are (backlog B65 stays with the
  public-pages review).
- **Testing**: through the development tunnel on real phones, as for feature 089.
- **Dependencies**: feature 089 (merged).
