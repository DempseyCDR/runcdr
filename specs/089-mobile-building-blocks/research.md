# Research: Mobile building blocks for volunteer pages

**Feature**: 089-mobile-building-blocks | **Date**: 2026-09-29

What was found in the code on 2026-09-29, and what was decided because of it.

## What exists today

| Shell | Where | Instances | Escape | Tap outside | First focus | Trap | Focus return | Name |
|---|---|---|---|---|---|---|---|---|
| Shared `Dialog` | `src/app/_components/Dialog.tsx` | 15 | closes | nothing | search, else first field | no | no | `label` (heading may differ) |
| Booking Central `Panel` | `bookings/page.tsx` | 7 | closes | **closes** | search only | no | no | `label`, no heading |
| Check-in's own | `CorrectionModal`, `CheckedInDialog`, `AddContactDialog` | 3 | 2 of 3 | nothing | varies | no | no | `aria-label` |
| Contacts' own | `contacts/page.tsx` ×2, `HeldMergeChooser`, `MergeCompare` | 4 | closes | nothing | varies | no | no | `aria-label` |

The tap minimums on the converted pages are `2.75rem` (44px) almost everywhere, plus `2.5rem`
(40px, `checkin.module.css:182`) and `2.25rem` (36px, `checkin.module.css:40`). Feature 060's
48px floor exists as `.touchTarget` in `AdminPage.module.css` (built on `--space-7`), but the door
and payments pages never adopted it.

The page-specific breakpoints are `max-width: 22.5rem` in check-in, the gate, payments and
`SaleOrCheckDialog`, and `max-width: 52.75rem` on the gate report. Below 52.75rem the gate report
also shrinks its text to 0.875rem.

---

## R1 — One shell: the shared `Dialog`, rebuilt in place

**Decision**: rewrite `src/app/_components/Dialog.tsx` as the only dialog shell, and move the other
three onto it. It is a `div role="dialog" aria-modal="true"` with its own focus handling, not the
native `<dialog>` element.

**Rationale**: the shared dialog already has the most users (15) and the right first-focus rule
(087). Replacing it in place means those users change least. A hand-built shell's behaviour is
ours, so the component tests prove it. jsdom, which runs the component tests, does not implement
the native element's top layer or inertness, so tests of `<dialog>` would test the test
environment.

**Alternatives considered**:

- **Native `<dialog>` with `showModal()`**: rejected for testability. It also brings its own Escape
  and `cancel` semantics, which would need overriding for the discard question anyway.
- **A focus-trap library**: rejected as a new dependency. The trap is about 20 lines, wrapping Tab
  and Shift-Tab between the first and last focusable element of the top dialog.

## R2 — The open-dialog stack, and Back

**Decision**: a module, `dialogStack.ts`, holds the open dialogs in order. Only the **top** dialog
responds to Escape, Tab and Back.

- **Opening** a dialog pushes a browser-history entry for the same address. Its state carries a
  marker, `{ runcdrDialog: id }`, alongside Next.js's own state.
- **Back** pops that entry. The `popstate` listener hands it to the top dialog as a close request,
  which may ask the discard question (R3). If the volunteer keeps editing, the entry is pushed
  again.
- **Any other close** (Close, Escape, a tap outside, the owner unmounting it after a save) removes
  the dialog from the stack. After the render, the stack reconciles once: if more entries are
  pushed than dialogs are open, it calls `history.go(-n)` a single time and ignores the one
  `popstate` that follows.
- **The address changed** (a link inside the dialog navigated away): the stack forgets its entries
  and does not go back. Going back then would undo the volunteer's navigation. The cost is one
  harmless same-address entry left in history.
- **The page is reloaded with a dialog open** (accepted): the dialog does not survive the reload,
  but its history entry does. The next Back lands on the same page and seems to do nothing; the one
  after it behaves normally. Clearing the entry on load would mean guessing whether it was ours
  from a previous visit, which is not worth the risk for a rare case.

The marker is written but never read back — nothing needs it but the tests — so no type guard was
needed after all (decided during implementation).

**Rationale**: FR-008b and the nested-dialog edge case. Reconciling in one place is what makes two
dialogs closing in one render safe: one `history.go(-2)`, not two racing `history.back()` calls.
Next.js 16's App Router accepts `window.history.pushState` and keeps its own state on the entry, so
an entry for the same address does not re-route. This is verified by the component tests and in
the browser (quickstart §4).

**Alternatives considered**:

- **The `CloseWatcher` API**: Android Chrome only. It does nothing for an iPhone's edge swipe or
  Samsung Internet.
- **A `#dialog` hash**: changes the address a volunteer might copy or reload, and reloading would
  land on a page with no dialog open.

## R3 — Unsaved changes, and the "Discard your changes?" question

**Decision**:

- **What counts as a change:** the shell marks itself changed on the first `input` or `change`
  event from inside its body. Search boxes (`input[type="search"]`) do not count; typing a search
  is not work to lose.
- **Closing when changed:** a close by any means (Close, Escape, Back, a tap outside) first swaps
  the action bar for **"Discard your changes?" — [Keep editing] [Discard]**, with focus on Keep
  editing.
- **Staying open after a save:** a dialog that stays open after saving calls the
  `useDialogSaved()` hook, which marks the shell unchanged again. Examples are a booking saved from
  a band's lineup and a check-in correction.
- **Closing after a save:** a dialog that closes on save needs nothing. The owner unmounts it, and
  that is not a close request.

**Rationale**: one rule and one implementation for 29 dialogs (FR-012a). Forgetting
`useDialogSaved()` only asks a question needlessly, which is the safe direction. The question
appears **inside the dialog**, not as `window.confirm`, for three reasons:

- it stays inside the focus trap;
- its buttons are 48px;
- it can be tested in jsdom, where `window.confirm` is not implemented.

The gate page's own page-level warning when leaving (`beforeunload`, FR-008 of 082) is untouched.

**Alternatives considered**:

- **A required `dirty` prop on every dialog**: rejected. That is 29 change trackers (Complexity
  Tracking).
- **`window.confirm`**: rejected. It escapes the trap, is unstyled, and cannot be tested.

## R4 — The heading is the accessible name

**Decision**: the shell labels itself with `aria-labelledby` pointing at its heading. The separate
`label` prop is retired; there is only a `heading`.

**Rationale**: FR-008 ("its own heading, which is also its accessible name"). Feature 087 kept a
short name ("Booking") under a fuller heading ("Booking — Ann Fiddle"). Tests that find a dialog by
the short name move to the heading, or to a pattern such as `/^Booking/`. Booking Central's panels
had no heading of their own; their content's first heading becomes the shell's heading, so it is
not shown twice.

## R5 — The action bar

**Decision**: an `ActionBar` component.

- **Order:** **Close first (left)**, then the owner's actions in the order given, and the main
  action last (bottom right).
- **Inside a dialog:** the shell renders the bar and puts Close in it. The owner passes its actions
  as the `actions` prop, and a dialog with no `actions` shows Close alone (FR-019).
- **On a page:** the bar is used directly with `pinned`. It is `position: sticky; bottom: 0`, with
  padding of at least `env(safe-area-inset-bottom)`. The page sets
  `scroll-padding-block-end` to the bar's height, so a field scrolled into view is never left under
  it (FR-018).
- **One line:** `flex-wrap: nowrap`. Each button may shrink to `--tap-min` wide and wraps its own
  label (`white-space: normal`), so buttons never wrap onto a second row (FR-017).

**Rationale**: in a dialog the bar sits outside the scrolling body, so it cannot cover a field
there. The widest bar today is Booking Central's event dialog: Delete, Cancel this dance, Close and
Save, four buttons. At 320px each button gets about 70px, and the longest label wraps to two lines.

## R6 — The tap minimum, defined once

**Decision**: add `--tap-min` to `globals.css` — first `48px`; **`44px` since 2026-09-30**, when
Rich set it after testing on an iPhone 15 Pro Max and a Galaxy S23 Ultra (feature 060's shared floor
follows the token, so it is 44px too). Point feature 060's `.touchTarget` and `TriageList`'s rows at
it. Replace every `2.75rem`, `2.5rem` and `2.25rem` minimum on the converted pages, in
`SaleOrCheckDialog` and in the dialog shells with `var(--tap-min)`.

- **Small marks (FR-003):** a mark smaller than the minimum gets its hit area from padding, or from
  a transparent `::before` covering the tap minimum both ways. Examples are a status letter and the
  tick in check-in's results.
- **Spacing (FR-002):** controls are spaced with `gap: var(--space-2)` (8px).

**Rationale**: FR-004. `globals.css` stays vocabulary only, as its contract says; a token is
vocabulary. The public site uses its own literal `44px` in `PublicNav.module.css` and never reads
the token, so FR-005 holds by construction.

**Alternatives considered**: reusing `--space-7` directly. Rejected because it is a spacing step
that happens to be 48px. Changing the tap size must not move every 48px gap.

## R7 — The two widths

**Decision**: media queries on the converted pages and in the shared components are mobile-first,
`@media (min-width: 40rem)` and `@media (min-width: 48rem)`, written as those literals. `@media
print` stays where it already is (the gate report).

- **Check-in, the gate, payments, `SaleOrCheckDialog`:** the `max-width: 22.5rem` rules turn inside
  out. The one-column layout becomes the base, and two columns begin at `40rem`.
- **The gate report:** `52.75rem` becomes `48rem`, and the rule that shrank its text is removed
  (R11).

A guard test fails on any other width in those files (contracts/style-tokens.md).

**Found in implementation**: check-in's action row and the gate's, payments' and the sale dialog's
two-column grids only ever needed their `22.5rem` rule as a tiny-phone fallback. They now use
`repeat(auto-fit, minmax(6rem | 9rem, 1fr))` — as many columns as fit — and need no media query at
all; only the gate report switches layout, at `48rem`.

**Rationale**: FR-020. A CSS custom property cannot be used inside a media query. `@custom-media`
would need a PostCSS plugin and a PostCSS configuration replacing Next.js's default, which is a new
dependency for two numbers. The guard test gives the "defined once" safety instead.

## R8 — The on-screen keyboard and the home indicator

**Decision**: the `(admin)` and `(door)` layouts export a Next.js `viewport` with
`interactiveWidget: "resizes-content"` and `viewportFit: "cover"`. The root layout, and so the
public site, is untouched.

**Rationale**:

- **`resizes-content`:** Android browsers then shrink the page when the keyboard opens. A pinned
  bar rises above the keyboard instead of hiding under it, and the focused field is scrolled into
  the space that is left.
- **iPhone:** Safari lays the keyboard over the page rather than resizing it. The bar is hidden
  behind the keyboard; it does not cover the field (FR-018).
- **`viewportFit: "cover"`:** makes `env(safe-area-inset-bottom)` report the home indicator's
  height, so the pinned bar clears it (FR-016).

## R9 — Only the dialog scrolls

**Decision**: while any dialog is open, the stack sets `overflow: hidden` on the document element,
and removes it when the last one closes. The dialog's body is the only scroller, with
`overscroll-behavior: contain`.

**Rationale**: FR-009. Today the backdrop scrolls, and on a phone a flick at the end of a dialog
scrolls the page beneath it.

## R10 — What the dialog looks like at each width

**Decision**:

- **Below 40rem:** the panel is `position: fixed; inset: 0`, `100dvh` high, a column of heading,
  scrolling body and action bar, with no radius and no backdrop visible.
- **From 40rem:** it is centred over a backdrop, as wide as its content up to `40rem`, no taller
  than the screen less a margin, and its bar is still pinned at its foot (clarification 1).
- **Tap outside:** a tap on the backdrop closes the dialog only when it has no `actions` (FR-008a).

## R11 — Text at least 16px on the converted pages and in every dialog

**Decision**: no `font-size` below `1rem`, and no `var(--fs-sm)`, in the converted pages' modules,
the shell or the action bar (held by the style guard). In the dialogs whose bodies are styled by
pages not yet converted — Booking Central (`hub.module.css`, the performer card, band roster and
lineup) and contacts (`contacts.module.css`) — the rules those bodies use are raised to 1rem as each
dialog moves onto the shell, and checked in the browser (FR-022 now covers every dialog); those
files join the guard when their pages are converted. The gate report's 0.875rem shrink below
52.75rem goes. Its wide tables keep their own sideways scroll inside their frame. The page itself
never scrolls sideways (FR-021), and reshaping the report's tables belongs to a later conversion.

**Rationale**: FR-022. A text field under 16px makes an iPhone zoom the page when it is tapped.

## R12 — Printing

**Decision**: the gate report's existing Print button (`window.print()`) moves into a pinned
`ActionBar` (Rich, 2026-09-29: "on display, the gate report has to show an action bar with a print
button … the printout must not have an action bar"). **No print rule is added.**

- **Why it needs no new rule:** the report's `@media print` block already hides everything on the
  page and then reveals only `[data-printable-report]`. The bar sits outside that article, so it
  drops off the printout as the old button did.
- **General print hiding stays out:** hiding the menu and bars in print on every volunteer page is
  still YAGNI (Rich, 2026-09-29).

**Why the button, when browsers can print on their own**: on a computer the browser's Print is one
keystroke away. On a phone it is buried in a menu:

- iPhone Safari: Share → Print.
- Android Chrome: ⋮ → Share → Print.
- Samsung Internet: ☰ → Print/PDF.

`window.print()` opens the same print screen directly in Safari and Chrome, including printing to a
printer or saving a PDF. Samsung Internet is built on Chrome's engine and is expected to do the
same; this is confirmed on a Galaxy (quickstart §6). Safari on the iPhone may not follow the
report's `@page` landscape size and leaves orientation to its print sheet.

## Testing approach

- **Component tests (jsdom)** for the shell (`tests/component/dialog.focus.test.tsx` and
  `dialog.close.test.tsx`) and the bar (`tests/component/actionBar.test.tsx`).
  - jsdom's `history.pushState` and `popstate` are real enough for the Back tests. Where timing
    matters, a test dispatches a `PopStateEvent` itself.
  - Each migrated dialog's existing tests move first: new name, Close in the bar, and the discard
    question where a test types and then closes.
- **Guard unit tests**:
  - `volunteerStyle.test.ts`: the tap token, the two widths and 16px text in the named files.
  - `oneDialog.test.ts`: no `role="dialog"` anywhere in `src/app` except `Dialog.tsx`. This is
    SC-002, and it catches a fifth shell being added later.
- **In the browser and on the phones**: a measuring script, the width sweep and the keyboard pass
  (quickstart). This stands in for B66's automated browser tests until they exist.

## R13 — Found in implementation (2026-09-29)

- **`DialogActions` and `useInDialog()`.** PerformerForm, VenueForm, BandRoster, ArchiveControl and
  RecordView keep their Save or Archive inside components also used outside dialogs. Instead of
  lifting every save out, a body component wraps its buttons in `<DialogActions>`; inside a dialog
  they render in the bar (a portal into it), outside one they render in place. A submit button
  that moves keeps its form through the `form` attribute. `useInDialog()` lets a shared form drop
  its own Cancel where the bar's Close stands for it.
- **`message`.** Feature 087 put "why Save refused" beside Save. With Save in the pinned bar, the
  reason sits just above it, in the dialog's foot — always in view.
- **`settled`.** Check-in's Add contact ends with "that person is already checked in": the typed
  details no longer matter, so Close must not ask to discard them. The owner says so.
- **Focus return.** The opener is read on the first render (the sale dialog's first field focuses
  itself before the shell's effect runs), and focus goes back only if nothing else took it on
  purpose (payments' "Change the number").
- **No text under 16px in any dialog, cheaply.** Most small print is `var(--fs-sm)`; the dialog
  redefines `--fs-sm` as `1rem` inside itself, and `<small>` inherits. The pages' own small print
  outside dialogs is untouched.
- **MergeCompare's answers stay in its body.** "Keep A, retire B", "Share A's email" and "Not
  duplicates" each sit beside the text that explains them — they are the question's answers, not a
  form's actions; the bar holds Close.
- **Exempt: a link inside a sentence.** The performer editor's "David holds this performer's email
  and telephone" link is 19px high. WCAG 2.5.8 exempts inline links; padding it to 48px would make
  it steal taps from the lines around it.
- **Out of scope, recorded.** Booking Central's table (708px) scrolls sideways at 320px — its cards
  come in a later conversion. The public menu bar on volunteer pages overflows at 200% text on a
  tablet — the frame feature removes it from volunteer pages.

### From Rich's iPhone 15 Pro Max test (2026-09-30)

- **Close sits beside the other actions.** At the left edge it was a long reach from the rest; the
  whole bar is now flush right, Close first and the main action still last, bottom right.
- **Counting the cash fits the screen.** The keypad ran below the action bar, so counting meant
  scrolling. The bill rows were already at the 48px minimum with no padding to trim, so the
  denominations now sit two to a row wherever two fit (`minmax(10rem, 1fr)` — one column on a
  320px phone), four rows instead of seven, and the total lost its margins: about 180px back, every
  row still 48px (Rich chose this over shorter rows, which would have broken FR-001).

### From Rich's Galaxy S23 Ultra test (2026-09-30)

- **Check-in keeps the results above the keyboard.** The results came after the extras and five
  buttons, and Chrome scrolled only far enough to show the search box, so the keyboard covered
  them. Now: the event, the search box, the extras line, the results — and the buttons below the
  results (Rich's layout). Typing scrolls the search box to the top.
- **The event line is one line shorter.** "Not today" and Change share the line under the heading;
  the warning no longer repeats the date the heading already shows, and the line is tucked up
  against the heading. Shared by check-in, the gate, payments and the gate report.
- **The contacts search does the same** (Rich, 2026-09-30): typing a name scrolls it to the top.
  Only the search box changed; the rest of the contacts page waits for its own conversion.
- **Less space around the extras.** The children box, the checkboxes and the search box are each at
  the 48px minimum and 8px apart, so they keep their size; the padding around the extras line goes.

### The search boxes and the printed gate report (Rich, 2026-09-30)

- **Room to scroll into.** With one result, check-in's page was too short for the search box to
  reach the top, and the result sat under the iPhone's keyboard (which lies over the page rather
  than shrinking it). While a name is typed, the part of the page from the search box down is now
  at least a screen tall (`min-height: 100dvh`), and the scroll happens after that room exists.
  Contacts does the same. The style guard skips such screen heights — they size a region, not a
  control.
- **The printed gate report has one fixed layout**, whatever the data: a two-by-two grid —
  Receipts beside Expenses, then Deposits beside Notes, the second row starting below the taller of
  the first. Each is held to its own half (a fixed table layout, fixed widths for the figures, long
  names wrapping within their column). It was two independent columns — Receipts over Deposits,
  Expenses over Notes — so Deposits and Notes started wherever the data above them ended. The page
  is written in the phone's order (Receipts, Deposits, Expenses, Notes), which Rich accepted; the
  print rules state the grid themselves, so paper never depends on the screen's width. Landscape
  letter is unchanged.
- **Printing from a phone** (Rich, the September 10 TNC report): the receipts still crossed the
  gutter from the iPhone, though not from desktop Chrome. The likely cause: a phone lays the printed
  page out narrower than 48rem, so the phone rules applied, and the figures' columns were fixed
  lengths (rem) that no longer fit a half. Now the print rules restate the whole layout in paper
  units (in, pt) and shares of the page, the columns are percentages of their table (first Qty 7%,
  each figure 15%, the name the rest), and every cell may wrap anywhere — so a table cannot be wider
  than its half at any width a device lays the page out at. The grid-area names also moved into the
  wide and print rules: on a phone screen, with no grid areas defined, they would have stacked all
  four sections in one cell. (Then dropped: the report is now written row by row — Receipts,
  Expenses, Deposits, Notes — so the two-column grid fills itself and a phone shows the same order,
  Rich's correction.)
- **iPhone Safari ignores the print rules.** Desktop Chrome and iPhone Chrome print the letter
  layout; iPhone Safari lays the printout out at the phone's width and prints the phone layout,
  enlarged. So Print now marks the page (`html[data-print-layout="letter"]`) and the stylesheet lays
  it out as landscape letter on screen as well — the report alone, 10.2in wide, two columns, in
  paper units — before opening the print sheet; the mark comes off on `afterprint`, or on the next
  tap if the browser never fires it. This covers the Print button, not Safari's own Share → Print,
  and it is proved only on the iPhone (Rich chose this over a server-made PDF, 2026-09-30). The
  on-screen letter rules repeat the print rules and must be kept in step with them.
- **…and Safari enlarged the type.** With the letter layout in place (two columns, the right order),
  Safari's printout still set the line items 2pt or more larger than both Chromes, so the amounts
  wrapped and Deposits and Notes fell off the page. iOS enlarges the text of a page laid out wider
  than its screen; `text-size-adjust: 100%` on the root, while the page is marked and in print,
  keeps the type at its point sizes. An amount also never wraps now (`white-space: nowrap`), and
  the money columns are 17% of their table (Qty 6%), enough for "$1,234.00" at 10pt.
- **Given up on iPhone Safari (Rich, 2026-09-30).** Even so it was "no good". The letter layout on
  screen and the text-size setting were removed; on iPhone Safari the Print button gives way to a
  note — print from Chrome or a computer. Desktop Safari and Chrome on the iPhone, Android and the
  desktop print the report properly with the print rules alone. A server-made PDF, the same on every
  device, is backlog **B67**.

### Known quirk, left alone (Rich, 2026-09-30)

- **Chrome on the iPhone reports a React hydration error** naming the attribute
  `__gcrremoteframetoken`. Chrome for iOS stamps it onto the page itself after the server sends it;
  React sees an attribute it never rendered. Safari and desktop Chrome do not add it. The overlay is
  development-only and the page works the same, so it is not silenced.
