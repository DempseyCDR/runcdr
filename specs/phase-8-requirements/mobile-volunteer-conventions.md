# Mobile conventions for volunteer pages — DRAFT

**Status**: draft for discussion, 2026-09-27. Not a spec — nothing here is decided until Rich says
so. **Targets**: iPhones and Samsung Galaxy phones, in the browser. **Builds on**: the public design
system (features 045–048, 055) and the volunteer mobile foundation (feature 060), plus the
phone-first work already shipped on the door and money pages (079, 081, 082) and Booking Central
(087).

**Update, 2026-09-30 — the shared building blocks shipped as feature 089**
(`specs/089-mobile-building-blocks/`): the tap-minimum token `--tap-min`, the one `Dialog` and its
`ActionBar`, and the two widths (`40rem`, `48rem`). After testing on an iPhone 15 Pro Max and a
Galaxy S23 Ultra, Rich set the tap minimum to **44px** (it had been decided at 48px; see §4.2 and
Q1). The frame and the later conversions use these, and add their style files to 089's style guard
(`tests/unit/volunteerStyle.test.ts`) as each page is converted.

**Update, 2026-09-30 — the volunteer frame shipped as feature 090** (`specs/090-volunteer-frame/`):
one coloured volunteer bar on every volunteer page, the destinations grouped by the kind of work
(Tonight first, flat when there are six or fewer), and on a phone the volunteer's name and a Menu
button (Q9: Tonight sits inside the Menu). Each area's layout now draws its own bars, so a volunteer
page no longer shows the public bar. Sign-in lands on a new volunteer home page (`/volunteer`), the
sign-in page wears the club's look, and the Organizer report opens on the viewer's own series and
shares the Gate report's Print bar. This closes B55.

**Update, 2026-10-01 — "two taps to anything" relaxed.** With every group open, the Menu was too
long on a phone for a role with many pages. In a grouped menu, Tonight's pages stay open (two taps)
and each other group is listed collapsed, opened by a tap (three). A flat menu — six or fewer, the
Door Attendant and the Financial Secretary — still shows everything.

**Update, 2026-10-01 — Booking Central's cards shipped as feature 091**
(`specs/091-booking-central-cards/`), the first page conversion. **The card is the basis at every
width; 087's table is retired.** On a phone each dance is a card (§4.5), its letters shown, not
pressed, and a tap opens the dance in the shared dialog. From 48rem the card is live, with the time,
venue (by its full name) and notes, and Caller, Music and Sound in a six-column subgrid shared by
every card. The hub opens on the **first dance dated today or later** (not check-in's rule —
corrected in §4.5) and scrolls both ways with no buttons at the ends; "Showing dances from" is
retired. The volunteer bar and a one-line header are pinned on this page; the header's
**Performers** button holds the search on a phone or in a window under 450px tall. The hub shows
every series the viewer's roles name. Its stylesheet joins 089's style guard: every letter, gap mark
and **+** is a tap-minimum control around a small chip.

## 1. Units: why dips and points are not a problem here

These are web pages, so the unit is the **CSS pixel**, which is already density-independent. With
the `width=device-width, initial-scale=1` viewport (Next.js emits it by default), one CSS px is one
**dp** in Chrome on a Galaxy and one **pt** in Safari on an iPhone. A 48px control is the same
physical size on both, at any screen density. We design in CSS px and never think about device
pixels.

Two consequences follow:

- **Type is sized in `rem`**, so a volunteer who enlarges text in Android's settings gets larger
  text. (iOS Dynamic Type does not reach ordinary web text, so our defaults must be legible without
  it.)
- **Spacing stays in `px`** (`--space-*`), so gaps do not balloon when text is enlarged.

## 2. What is already in place

| Area | Where | What it gives us |
|---|---|---|
| Token vocabulary | `src/app/globals.css` (045) | palette, `--font-*`, type scale in rem (`--fs-sm` … `--fs-h1`), `--space-1`…`--space-7`, `--container-max: 720px` |
| Public application | `(public)/public.module.css` (045) | 16px body, `box-sizing: border-box`, one focus ring, images never overflow, `100dvh` |
| Public nav | `PublicNav.module.css` (046, 055) | disclosure menu below **768px**, inline bar above; **44px** targets; logomark ↔ logotype at **640px** |
| Volunteer shell | `AdminPage` (060, 087) | token-driven container, one `<h1>`; `.touchTarget` = **48px** floor (060 FR-008); opt-in `identity` (the "Volunteer" band) and `wide` |
| Volunteer patterns | `RecordView`, `TriageList` (060) | Record mode (one entity, edit in place) and Triage mode (a worklist that opens a record) |
| Phone-first pages | `/checkin` (079), `/gate` (082), `/payments` (081), `/treasurer` (082) | event confirmed at the top; one action per row; **44px** controls; 16px inputs to stop iOS zooming |
| Dialog shell | `_components/Dialog` (081, 082, 087) | backdrop, `100dvh`-bounded scrolling panel, Escape, focus to the search box or first field |

## 3. What is inconsistent today

1. **Two tap floors.** 060 set **48px** (Material's 48dp); the public nav and the door/money pages
   use **44px** (Apple's 44pt). `/checkin` also has one control at **36px** (`min-height: 2.25rem`),
   below both.
2. **Four dialog shells.** The shared `Dialog`, `/checkin`'s own, Booking Central's `Panel`, and
   `/contacts`' own — each with its own backdrop, width and close behaviour.
3. **Scattered breakpoints.** 640px, 768px, 22.5rem (360px), 52.75rem (844px) — in px and rem mixed,
   and no named set.
4. **Most volunteer pages predate 060.** About a dozen are still styled inline, and don't use the
   shell: events, venues, the parameter pages, access, exports, officers, campaigns, announcement,
   the organizer report. `VolunteerNav` is inline too (backlog **B55**).
5. **The volunteer identity is opt-in.** Only Booking Central carries it (087 FR-032).
6. **Some meaning lives in hover tooltips.** Booking Central's state letters say "click for
   requested" only in a `title`, which a phone never shows.
7. **Tables do not fit a phone.** Booking Central has seven columns; at 360px it scrolls sideways.

## 4. The proposed convention

### 4.1 Widths

- **Design at 360px** (the common Galaxy width); **check at 390–430** (current iPhones); **must not
  break at 320** (iPhone SE, or any phone with display zoom). No horizontal page scroll at any of
  these.
- **Tablets, in portrait and landscape, are in scope** *(decided 2026-09-28)*: check at
  **768 × 1024** and **820 × 1180** portrait and **1024 × 768** landscape. **Phones in landscape are
  out of scope** *(decided 2026-09-28)* — phones are designed and checked in portrait only.
- **Two named breakpoints**, matching what the public site already does, written in **rem** so they
  respond to enlarged text: **`40rem` (640px)** — phone → large phone / small tablet; **`48rem`
  (768px)** — the point where the public nav becomes a bar and a volunteer table may show as a
  table.

### 4.2 Touch targets

- **One floor for every volunteer control: 44 × 44 CSS px**, with at least 8px between neighbouring
  targets *(decided 2026-09-30, after the phone tests of feature 089)*. It was first decided at
  48px *(2026-09-28)* — 060's number and the larger of the two platform guidelines — but on the
  phones 48 made the counting dialog and check-in too tall for the screen. 44px is Apple's
  guideline and the public site's size, so the whole app now has one floor. Check-in's one 36px
  control and the other small ones come up to it; feature 060's `.touchTarget` follows it too.
- **The public site keeps its own 44px** — the same size, but its menu and controls are not part of
  this work and do not read the token.
- Expressed once, as the token **`--tap-min`** (feature 089), composed through `AdminPage`'s
  `.touchTarget` — not re-typed per page as `2.75rem`.
- A small visual mark may sit inside a larger hit area (Booking Central's gap squares, state
  letters): the **hit area** meets the floor, not necessarily the drawn shape.

### 4.3 Type and fields

- Body text **16px** (`--fs-body`); `--fs-sm` (14px) only for secondary text, never for a control's
  label.
- **Every text field 16px or larger**, or iOS Safari zooms the page on focus.
- Labels **above** fields at phone width; fields full-width.
- The right keyboard: `inputmode="decimal"` for money, `type="tel"`, `type="email"`, `type="search"`
  for finders, `type="date"`/`"time"` for dates and times; `autocomplete` where it helps.
- Layouts must survive **200% text** (Android font scaling) without overlap or clipped labels.

### 4.4 Page anatomy

- Every volunteer page uses **`AdminPage`**, with **`identity` on** — one `<h1>`, the Volunteer
  band.
- **What the page is about comes first**: the evening pages open with the event confirmation
  (`EventConfirm`); a record page with the record's name.
- **One action bar, and Save is always at the bottom right** *(decided 2026-09-28)*. A form's
  actions — Archive, Close, Cancel this dance, Mark reviewed and the like — are clustered together
  in one bar, with **Save last, at the bottom right**. On a page the bar is pinned to the bottom of
  the viewport; **in a dialog it is inside that dialog**, at its foot, and affects only it *(decided
  2026-09-28)* — on a phone the dialog fills the screen, so the two coincide. The cluster keeps to
  **one line**: when space is short, a button's label wraps inside the button rather than the
  buttons wrapping onto a second row. The bar sits above the iPhone home indicator
  (`env(safe-area-inset-bottom)`), the form scrolls beneath it, and it must never hide the field
  being typed in. (Booking Central's event form, whose Cancel, Delete, Save and Close were put on
  one row in 087, is the nearest existing case.)
- Heights use **`dvh`**, never `vh`, so the browser's address bar never hides the bottom of a page.

### 4.5 Patterns

- **Record mode** and **Triage mode** (060) remain the two ways to present work.
- **Evening mode** — the door and money pattern already shipped: confirm the evening, then one row
  per person or payment, each row's action in the row.
- **Table → list at phone width.** A table that cannot fit 360px becomes a list of cards below
  `48rem`, one card per row. Booking Central is the first case *(decided 2026-09-28 — no separate
  phone view; phone-specific Booker stories have not been gathered)*:
  - **One card per dance**, showing its **date, series key, label, caller and band**.
  - **Where the list opens**: the list keeps the hub's order (newest first) and opens scrolled so
    that the **default dance sits at the bottom of the viewport** — the dances still to come are
    above it, and the past below. The default is the **first dance dated today or later**, or, if
    there is none, the most recent *(corrected 2026-10-01, feature 091: this had named check-in's
    rule, the most recent dance dated today or earlier — the Booker works ahead, the door behind)*.
  - **Scrolling both ways** *(decided 2026-09-28)*: the cards sit in one window that scrolls
    without end in both directions — **up into the future, down into the past**. It opens with
    about **ten dances** around the default and loads more as the Booker reaches either end. The
    **desktop table scrolls the same way** *(decided 2026-09-28)*, so the **"Showing dances from"
    control is retired at every width**.
  - **Above the cards**, only two things *(decided 2026-09-28)*: one line, **"Booking Central —
    {series name}"**, dash-separated; and a **Performers** button that opens a dialog to manage
    performers — the performer-and-band search and the performers who need a contact move into it.
    The one-line title is used **at every width**. The **Performers button is for phones only**: at
    desktop width the search and the "performers need a contact" count stay in view above the table,
    because the count is there to prompt action *(decided 2026-09-28)*.
  - **Tapping a card manages that dance** — it opens the dance with everything its desktop row
    offers (venue, caller, music, sound, the gap marks and the **+**, notes, the status letters,
    the event form).
- **One dialog shell** — the shared `Dialog` — for every modal, replacing the other three. At phone
  width it fills the screen (a sheet), keeps its own heading and Close, scrolls inside itself, and
  puts the cursor in its search box when it opens on one (087).

### 4.6 Touch, not hover

- **Nothing only on hover.** A `title` tooltip is a desktop convenience; anything a volunteer needs
  is shown, or said in the control's visible text.
- `@media (hover: hover)` for hover styling; `@media (pointer: coarse)` where a control needs more
  room for a finger.
- Focus stays visible (`:focus-visible`, the public focus ring) — for keyboards and switch users.

### 4.7 Look

- Volunteer pages keep the **public palette and fonts** (045, 060 FR-003) and carry the **Volunteer
  band** (087) so a volunteer always knows they are on a working page, not the public site.
- **AA contrast** throughout, as the public site requires (045 FR-005).

### 4.8 Checking it

- In the browser: emulate **360 × 800** and **390 × 844**, and **320** for the break test; then the
  tablet sizes in §4.1.
- On devices: **one iPhone and one Galaxy pass per page** before it is called done — the only way to
  catch focus zoom, the keyboard covering a field, and the home-indicator area.
- A short per-page checklist: no sideways scroll at 320; every control ≥ the floor; every field ≥
  16px; nothing hover-only; one dialog shell; identity on.

## 5. Pages, by how much they are used on a phone

| Tier | Pages | State today |
|---|---|---|
| On their feet, on the night | `/checkin`, `/gate`, `/payments` | phone-first already; bring to the one floor and one dialog |
| Often on a phone | Booking Central (`/bookings`), `/contacts`, the volunteer home | hub needs table → list; contacts on 060's shell |
| Sometimes | `/events`, `/venues`, `/treasurer`, `/organizer/*` | inline-styled or print-first; make usable, not optimised |
| At a desk | rate / expense / door / admission parameters, `/access`, `/exports`, `/content`, `/officers`, `/campaigns`, `/announcement` | inline-styled; move onto the shell, no phone design beyond "not broken" |

## 6. Questions for Rich before anything is specified

1. **Q1 — one tap floor** — *decided 2026-09-28*: **48px** on volunteer pages; the public site stays
   at 44px for now (§4.2). **Changed 2026-09-30: 44px**, after the phone tests (§4.2).
2. **Q2 — Booking Central on a phone** — *decided 2026-09-28*: the same hub as **one card per
   dance**, opening with the default dance at the bottom of the viewport; tapping a card manages
   it (§4.5). No separate phone view until phone stories are gathered.
3. **Q3 — actions and Save** — *decided 2026-09-28*: one action bar pinned to the bottom of the
   viewport, the actions clustered on one line, **Save always at the bottom right** (§4.4).
4. **Q4 — tablets and landscape** — *decided 2026-09-28*: **tablets in scope**, portrait and
   landscape; **phones in portrait only** (§4.1).
5. **Q5 — in what order is the work built?** — *decided 2026-09-28: shared parts first.* Most of
   what is decided above is shared by every page: the 48px floor, the one action bar, the one
   dialog, the breakpoints, and the volunteer menu (Q6–Q11). There were two ways to sequence it:
   - **Shared parts first.** One feature builds the shared parts once — the 48px token, the action
     bar, the single dialog, the breakpoints, the restyled volunteer menu — and then later features
     convert pages a tier at a time: Booking Central's cards, then check-in / gate / payments, then
     the rest.
   - **Page by page.** Each feature converts one page completely, starting with Booking Central,
     and builds whichever shared parts that page needs as it goes; the next page reuses them.

   **Shared parts first** was chosen: Booking Central alone would need the action bar, the dialog,
   the breakpoints and the menu anyway — and building them for one page tends to shape them around
   that page. Doing them first means every page after is only a conversion.

### The volunteer menu (added 2026-09-27)

Styling volunteer pages includes the volunteer menu — the bar every signed-in page shows
(`VolunteerNav`, backlog B55). A grouping was proposed before Booking Central; features 084–087
have since removed six entries (venue rents, QBO mapping, the booking report, performers, bands,
bookings), so it is restated here against today's menu. A Super-user sees 20 destinations, a Booker
about 12, a Door Attendant 3.

- **Q6 — grouping** — *decided 2026-09-28*: **part of this work; the proposal is accepted.**
  **Tonight**, always flat and first (Check-in, Gate money, Payments); **Booking** (Booking Central,
  Events, Venues); **Reports** (Organizer report, Gate report); **People** (Contacts, Mailing-list
  exports); **Settings** (the four parameter pages, Access control, Route index); **Website**
  (Content pages, Officers, Announcement, Campaigns). An empty group vanishes, a one-item group is a
  plain link, and a menu of six or fewer stays flat — a Door Attendant's three links get no
  grouping at all.
- **Q7 — two bars** — *decided 2026-09-28*: **volunteer pages drop the public bar** and keep one
  link back to the club's site; public pages keep both bars.
- **Q8 — where the Volunteer look lives** — *decided 2026-09-28*: **in the coloured menu bar**, so
  every volunteer page is marked at once. Pages no longer opt in (this retires 087's per-page
  `identity` switch, and settles §3 item 5).
- **Q9 — the menu on a phone** — *decided 2026-09-28*: **yes** — below 768px it collapses as the
  public menu does (046), Tonight's pages stay visible outside the collapsed menu for those who hold
  them, and Sign out moves inside the collapsed menu. The signed-in volunteer stays **in plain
  view**, shortened at phone width from "Signed in as {name}" to just the **name** (§7 item 2).
  **Changed 2026-09-30 (feature 090 planning):** Tonight's pages move **inside** the Menu, listed
  first — the name, three Tonight links and Menu do not fit one line on a phone. The bar is the
  name and Menu.
- **Q10 — where a volunteer lands** — *decided 2026-09-28*: **yes — the "home-page staff nav"**:
  sign-in no longer returns a volunteer to the public home page. *As read on 2026-09-28, to confirm
  at review:* a volunteer lands on a **volunteer home page** that lays out their own grouped
  destinations — the menu as a page, Tonight's work first — so whatever they do is one tap away.
  (The older note in Meg's check-in notes, "render the staff nav on the home page", was met when the
  menu moved to every page; this is the landing half of it.)
- **Q11 — names, and the organizer report** — *decided 2026-09-28*:
  - **"Treasurer report" becomes "Gate report"** in the menu, matching the page.
  - **The organizer report opens on the volunteer's own series** (086's rule: a default narrows to
    the viewer's series; a permission never does), with an **unobtrusive series selector** — the
    organizer reports are visible to every volunteer, so any series is one choice away. A volunteer
    whose roles name no single series opens on the first as today.
  - **The community dance series key becomes `cdob`** — "Community Dance / Open Band" — replacing
    `community_dance`. This is more than a label: the key is in about 13 source files and 20 test
    files — check-in's open-band rule, the organizer report's TNC + community-dance pairing, the
    public site's colour, hero image and landing-page mappings, the printable calendar's short code,
    the seed — and in URLs such as `/organizer/community_dance`. It needs a migration, the code and
    tests moved in one step. **Old links simply change — no redirects** *(decided 2026-09-28)*. The
    hero image is not named by rule: `seriesHero.ts` maps each key to a hand-picked file. The
    file is renamed to `cdob.jpg` with the key, so nothing outside the migrations still carries the
    old key (feature 088); a missed row would show a plain coloured header instead of the photo.
    The public site's look must not change.

## 7. Still to decide (added 2026-09-28)

1. **How the shared work is split into features** — *decided 2026-09-28*: **separate features** —
   (a) **the volunteer frame** — the grouped, coloured menu and its phone behaviour, dropping the
   public bar on volunteer pages, the volunteer home page, the "Gate report" rename, and the
   organizer report's series default and selector; (b) **the shared building blocks** — the 48px
   token, the action bar, one dialog in place of four, the named breakpoints. (c), the `cdob`
   rename, is done — feature 088. The page conversions follow: Booking Central's cards, then
   check-in / gate / payments, then the rest.
2. **"Signed in as …" on a shared phone** — *decided 2026-09-28*: the signed-in volunteer stays **in
   plain view** on a phone, shortened to just their **name**; **Sign out** is hidden in the
   collapsed menu with the other links. A shared door phone still always shows whose session it
   holds (083's reason).
3. **Public links that carry the series key** — *resolved 2026-09-28*: moot. The app has not been
   deployed, so no printed or posted link carries the old key (feature 088).
4. **Printing** — *decided 2026-09-28*: **only reports are printed**, so only reports get print
   markup: the **organizer report** gains it (it is the printed document, B59), joining the gate
   report and the printable calendar, which already print cleanly. Hiding the menu and action bar
   on every volunteer page in print is **not** done — most volunteer pages are for acting, not
   printing (YAGNI).
5. **"Save at the bottom right" inside a dialog** — *decided 2026-09-28*: the action bar is **inside
   the dialog it affects**, Save at its bottom right (§4.4).
6. **Samsung Internet, and who tests** — *answered 2026-09-28, in part*: real-phone testing needs
   the app reachable from a phone, and sign-in is the obstacle — Google returns a volunteer only to
   a return address registered with it, and accepts plain `http` only for `localhost`. Three ways:
   - **Pages that need no sign-in** (the public site) can be tested now: the phone, on the same
     Wi-Fi, opens the laptop's address on the local network.
   - **A public HTTPS tunnel to the laptop** (Cloudflare Tunnel, Tailscale Funnel or ngrok) gives
     the dev server a real `https://` address. Register that address's callback with Google once,
     point `GOOGLE_REDIRECT_URI` at it, and a phone anywhere signs in to the laptop. A tunnel with
     a fixed address avoids re-registering it each session.
   - **Deploy** a staging copy and test there.

   *Decided 2026-09-29*: **the ngrok tunnel** — set up and proven that day (sign-in through the
   tunnel works; the tunnel support merged as PR #51). Samsung Internet is on the device
   checklist. **Galaxy testers** *(2026-09-28)*: Sean Aman and Margaret Mathews have Samsung
   phones; Rich will add them as test users of the club's Google sign-in so they can sign in
   before it is published.
7. **Pages outside the volunteer route groups** — *decided 2026-09-28*:
   - **The sign-in page** (`/login`): the **public menu bar** on top; beneath it, two blocks side by
     side of about the same height — the club's logotype (`public/CDR_Logotype_4Color.svg`) on the
     left, and the sign-in content (today's `<main>`) on the right. On a narrow screen the blocks
     wrap, logotype above; the logotype scales so it never exceeds the screen's width. "Staff"
     becomes **"Volunteer"** in its wording ("Volunteer sign-in", "Volunteer areas require …").
     Four additions *(decided 2026-09-28)*: a line saying who it is for ("For club volunteers.
     Dancers don't need to sign in."); a **"Can't sign in?"** link to the Contact Us page; a
     shared-phone reminder ("On a shared phone, sign out when you're done"); and **Google's
     standard sign-in button**, with its "G" mark, in place of today's text link.
   - **The route index** (`/dev/routes`, Super-user only): **no styling** — YAGNI.
8. **Keyboard and screen readers** — *decided 2026-09-28: yes to both.* The public menu is already
   accessible except its home link on wider screens (backlog B65).
   - **8a — the grouped menu.** Should the menu be fully usable without a mouse or touch: each
     group opens with Enter or Space, the arrow keys move within it, Escape closes it, and a screen
     reader is told whether a group is open? *Suggested: yes* — the menu is how every volunteer
     reaches their work. **Decided: yes.**
   - **8b — the one dialog.** Should the dialog keep keyboard focus inside itself while it is open
     (Tab cycles through its own controls), and put focus back on the button that opened it when it
     closes? Today Tab can wander out onto the page behind a dialog. *Suggested: yes* — it is
     cheaper built into the one shared dialog than fixed in four. **Decided: yes** — Tab stays in
     the open dialog until it is closed.
9. **Above Booking Central's cards** — *decided 2026-09-28*:
   - **At phone width**: one line, **"Booking Central — {series name}"**, and a **Performers**
     button that opens a dialog holding the performer-and-band search and the performers who need
     a contact — nothing else.
   - **At desktop width**: the search and the "performers need a contact" count **stay in view**
     above the table — the count is there to prompt action, and a button would hide it.
   - **The title at every width** is the one line **"Booking Central — {series name}"**; the
     separate series heading beneath the page title goes.
   - **At every width**: the list **scrolls both ways** — up into the future, down into the past —
     opening with about ten dances, the default dance at the bottom of the window. **"Showing
     dances from" is retired** (§4.5). This needs the hub's read to page **forwards** from a dance
     as well as backwards; today it pages backwards only, below an upper date bound.
10. **Smaller points** — *decided 2026-09-28*: **dark mode is out** (YAGNI) — volunteer pages are
    light-only. **Automated in-browser testing** — *open*: there is none today, so layout is checked
    by hand and the device checklist carries the weight; whether to add it is a separate decision
    (see the review notes).
