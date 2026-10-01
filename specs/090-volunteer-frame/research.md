# Research: The volunteer frame

**Feature**: 090-volunteer-frame | **Date**: 2026-09-30

## What exists today

- **Two bars on every page.** The root layout (`src/app/layout.tsx`) renders `PublicNav` (the
  public bar, `aria-label="Site"`) and then `Nav` (the volunteer bar, `aria-label="Main"`) above
  every page. `Nav` renders nothing when no one is signed in.
- **The volunteer bar is a flat row** of the destinations `navItemsFor(actor)` offers, followed by
  "Signed in as {name}" and a Sign out form. It is styled inline (`VolunteerNav.tsx`, backlog B55).
- **Destinations** are listed in `src/server/auth/nav.ts` (`NAV`), each shown when the actor holds
  its capability. The organizer report's entry is fixed at `/organizer/tnc`; the gate report's is
  labelled "Treasurer report".
- **The volunteer look is opt-in, page by page:** `AdminPage`'s `identity` prop draws the
  band-colour rule and a "Volunteer" kicker. Only Booking Central and Contacts use it (feature 087).
- **Sign-in** (`src/app/login/page.tsx`) is a bare page saying "Staff". The Google callback returns
  to `safeNextPath(next)`, which falls back to `/`, the public home.
- **The viewer's own series** is computed inline in `/api/me/capabilities` (feature 086): every
  series any grant names, or none for a club-wide holder.
- **Printing:** the gate report prints only its `[data-printable-report]` on landscape letter, with
  a pinned Print that gives way to a note on iPhone Safari (feature 089, B67). The organizer report
  has no print rules and no stylesheet (inline styles).

---

## R1 — Where each bar renders

**Decision**: the root layout renders no bar.

- `(public)/layout.tsx` renders `PublicNav` then `Nav` above its wrapper, so public pages keep both
  bars when a volunteer is signed in.
- `(admin)/layout.tsx`, `(door)/layout.tsx` and a new `dev/layout.tsx` (the Route index) render
  `Nav` only.
- The sign-in page renders `PublicNav` itself.

**Rationale**: FR-001. The route groups already are the line between public and volunteer pages, and
each has a layout. The bars sit above the public wrapper, not inside it, so the public styling
(`public.module.css`) does not reach them, exactly as today.

**Consequence**: Next's built-in "not found" page, which belongs to no group, shows no bar. That is
acceptable; it was never part of either site's design.

## R2 — Grouping: `menuFor(actor)`

**Decision**: each `NAV` entry gains a `group` from a closed union (`tonight | booking | reports |
people | settings | website`). A pure function `menuFor(actor)` applies the spec's rules:

- the actor's destinations are exactly `navItemsFor(actor)` (FR-007);
- **six or fewer** → `{ kind: "flat", items }`;
- **otherwise** → `{ kind: "grouped", groups }` in the fixed order, each group
  `{ key, label, items }`, empty groups dropped. A one-item group is kept as a group of one, and the
  presenter draws it as a plain link.

**Rationale**: the bar and the home page must show the same arrangement, so it is decided once, on
the server, where the capabilities are. Pure means unit-testable per role without rendering.

## R3 — Groups on a computer: disclosures, not ARIA menus

**Decision**: from 48rem up:

- **Tonight:** its links are flat and first.
- **Other groups:** each is a **disclosure** — a button (`aria-expanded`, `aria-controls`) that
  opens a panel of links below it.
- **Opening and closing:** one group open at a time. A panel closes on choosing a link, on Escape
  (focus returns to its button), on a click outside, or when the route changes.
- **Keys:** Enter or Space on the button opens its panel, and Down moves into it; Up and Down move
  between its links; Home and End go to the first and last. Hover does nothing (touch, not hover,
  §4.6).

**Rationale**: FR-008. For site navigation, the WAI-ARIA Authoring Practices recommend the
disclosure pattern over `role="menu"`, which promises application-menu semantics (typeahead, roving
tabindex) a nav does not need. `aria-expanded` is what tells a screen reader a group is open.

## R4 — The bar below 48rem

**Decision** (clarification, 2026-09-30):

- **The bar:** the volunteer's name (FR-011) and a **Menu** button, one line.
- **The Menu:** a full-width panel flowing below the bar (feature 046's pattern), listing every
  group **open** under its heading, Tonight first. Then Sign out, and the link to the club's site.
- **Closing:** on choosing a link, on Escape (focus back to the Menu button), on pressing Menu
  again, and on a route change.
- **No JavaScript:** a `<noscript>` rule shows the panel, as feature 046 does, so destinations are
  always reachable.

**Rationale**: FR-010–FR-013. The name, three Tonight links and Menu measure about 475px against
358px available at 390px wide, so Tonight moved inside (Rich's choice). One line then holds at
320px.

## R5 — What the bar holds, and its look

**Decision**:

- **Left:** a **"Volunteer"** link to the home page (`/volunteer`, FR-003), always.
- **At 48rem and up:** Tonight's links, the group disclosures, then "Signed in as {name}", Sign out
  and a **"Club site"** link to `/`.
- **Below 48rem:** the name and Menu, as in R4.
- **The colour:** the bar is the band colour (`--band`) with light text (`--link-on-dark`), which
  measures about 5:1 contrast.
- **Tap targets:** every control meets `--tap-min`.

**Rationale**: FR-002/FR-003. The colour now lives in the bar, so every volunteer page is marked
(Q8).

## R6 — Retire the per-page identity

**Decision**: remove `AdminPage`'s `identity` prop and its `.identity` rules, and drop the prop from
Booking Central and Contacts.

**Rationale**: FR-002 ("pages MUST no longer opt in"). With the colour in the bar, a second marker
per page repeats it. `adminPage.test.tsx`'s identity cases move to the bar's test.

## R7 — Landing after sign-in

**Decision**: the Google callback falls back to **`/volunteer`** instead of `/`, using
`safeNextPath(next, "/volunteer")`. A `next` from a volunteer page is honoured as today (FR-015).
The sign-in page already omits `next` when it would be `/`.

**Rationale**: FR-014/FR-015. One change at the one place that decides the landing.

## R8 — The sign-in page

**Decision**: `src/app/login/page.tsx` gets a stylesheet, `login.module.css`.

- **Bars:** `PublicNav` on top.
- **Layout:** a two-block row — the logotype (`/CDR_Logotype_4Color.svg`, `max-width: 100%`) and
  the sign-in. The blocks stack below 40rem, logotype first.
- **Wording:** "Volunteer sign-in"; "Volunteer areas require a CDR volunteer account."; "For club
  volunteers. Dancers don't need to sign in."; "On a shared phone, sign out when you're done."
- **Help:** a "Can't sign in?" link to `/contact-us`.
- **The button:** Google's standard light button — a white face, a grey border, the four-colour
  "G" as an inline SVG, and "Sign in with Google" — linking to the same `/api/auth/google` URL.
- **Refusals:** the generic refusal message is unchanged (FR-020).

**Rationale**: FR-016–FR-020, all decided in the review (§7 item 7). Google's branding guidelines
ask for their mark and wording unchanged, so the button is theirs, drawn inline, with no library.

## R9 — The organizer report's landing, selector and print

**Decision**:

- **`mySeries(actor)`** (`src/server/auth/mySeries.ts`) is lifted out of `/api/me/capabilities`
  unchanged; the route uses it.
- **The landing:** a new `/organizer` page (a server component) redirects to
  `/organizer/{key}`. The key is the viewer's series when `mySeries` names exactly one; otherwise
  `tnc`, today's default. The rule is a pure `organizerLandingKey(mySeriesIds, series)`. The menu's
  entry becomes `/organizer`.
- **The selector:** a small labelled `<select>` of every series (`/api/series`) beside the year.
  Choosing one goes to `/organizer/{key}`.
- **The stylesheet:** the page gains `organizer.module.css`. Its inline styles move there only as
  far as the print rules need; the rest stays as it is (a later conversion).
- **Print:** the report is wrapped in `data-printable-report`, and `PrintBar` (R10) offers Print.
  Its own print rules set a 9pt table at 100% width on landscape letter.

**Rationale**: FR-021–FR-023; feature 086's rule that a default narrows and a permission never does.
Doing it with a redirect keeps every link and bookmark to `/organizer/{key}` working.

## R10 — `PrintBar`: one Print for both reports

**Decision**: a shared component at `src/app/_components/PrintBar.tsx`:

- **Everywhere but iPhone Safari:** a pinned `ActionBar` with Print (`window.print()`).
- **On iPhone Safari:** the B67 note instead.
- **Detection:** feature 089's `isIPhoneSafari` and `useCanPrint` move into it, from the gate
  report page.
- **Print rules:** its stylesheet carries the rules both reports share — landscape letter, and
  hide everything, then reveal only `[data-printable-report]`. Those rules also move out of the gate
  report's stylesheet, which keeps its own table and grid rules.

**Rationale**: FR-023 asks for the organizer report to print "as the gate report prints". One
component means the iPhone Safari check and the hide-everything rules exist once.
