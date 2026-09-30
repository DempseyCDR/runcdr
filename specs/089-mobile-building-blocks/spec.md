# Feature Specification: Mobile building blocks for volunteer pages

**Feature Branch**: `089-mobile-building-blocks`

**Created**: 2026-09-29

**Status**: Draft

**Input**: User description: "mobile-volunteer-conventions" — the shared building blocks of the
mobile conventions reviewed 2026-09-27 to 2026-09-29
(`specs/phase-8-requirements/mobile-volunteer-conventions.md`). That review split the conventions
into two features: this one, and the volunteer frame (the menu, the volunteer home page, the
sign-in page), which follows it.

Volunteers do the club's work on their phones — at the door, at the gate, paying performers — and
the Booker increasingly from a phone too. The volunteer pages were built over two years, one feature
at a time, and it shows: two different minimum sizes for a tap, one control smaller than either,
four different kinds of pop-up dialog that each close, scroll and size themselves differently, and
page layouts that change at whatever width each page happened to choose.

This feature makes those four things one each: **one minimum tap size, one dialog, one action bar,
and one set of widths at which a layout changes.** It is groundwork. It converts the pages that
already live on a phone — check-in, the gate, payments and the gate report — and every dialog, and
leaves every other page's redesign to the features that follow (the frame, Booking Central's cards,
and the rest), which will then only have to use what this one builds.

The thing to hold on to: **the volunteer should notice nothing but that everything is easier to
hit, and behaves the same way everywhere.** No workflow changes here; only how the controls are
sized, placed and behave.

## Clarifications

### Session 2026-09-29

- Q: Does a dialog's action bar stay in view while its content scrolls? → A: Yes — it stays pinned
  at the foot of the dialog at every width, and the content scrolls above it.
- Q: Does tapping outside a dialog close it? → A: Only a dialog with nothing to save (Close alone
  in its bar); a tap outside a dialog with a Save does nothing.
- Q: What does the phone's Back gesture do while a dialog is open? → A: It closes the top dialog,
  just as Close would; a second Back then leaves the page as usual.
- Q: Closing a dialog that has unsaved changes? → A: If anything has been changed, ask "Discard your
  changes?" before closing, however it was closed (Close, Escape, Back, a tap outside); otherwise
  close at once.
- Q: At what width does a dialog stop filling the screen? → A: At the first named width, 40rem
  (about 640 pixels): full screen below it (phones), centred from it up (tablets, computers).

### Session 2026-09-30

- Q: After testing on an iPhone 15 Pro Max and a Galaxy S23 Ultra, what should the tap minimum be?
  → A: 44 pixels (it was 48).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every control is easy to hit (Priority: P1)

Meg is checking dancers in at the door with a phone in one hand and a clipboard in the other.
Every button, link, checkbox and field on the volunteer pages she uses is large enough to hit first
time with a thumb — the same generous size everywhere, with room between neighbours.

**Why this priority**: it is the most frequent source of error on a phone, and the door, gate and
payments pages are used standing up, under time pressure.

**Independent Test**: on a phone-sized screen, measure every control on check-in, the gate,
payments, the gate report and every dialog; none is smaller than the minimum.

**Acceptance Scenarios**:

1. **Given** check-in, the gate, payments or the gate report on a phone, **When** any control is
   measured, **Then** it is at least 44 × 44 CSS pixels, including the one check-in control that is
   36 pixels high today.
2. **Given** two neighbouring controls, **When** measured, **Then** at least 8 pixels separate them.
3. **Given** a control whose visible mark is small by design (a status letter, a gap mark), **When**
   it is tapped anywhere within 44 × 44 pixels around the mark, **Then** it responds.
4. **Given** the public site, **When** its controls are measured, **Then** they are unchanged at 44
   pixels — the public site is not part of this work.

---

### User Story 2 - One dialog that behaves the same everywhere (Priority: P1)

Whenever a volunteer page opens something over itself — a booking, a payment, a check-in
correction, a merge — it opens the same kind of dialog: on a phone it fills the screen; it has its
own heading and a way to close it; its content scrolls inside it; the cursor starts where the typing
starts; and the keyboard stays inside it until it is closed.

**Why this priority**: four dialogs that each behave a little differently are four things to learn,
and the keyboard today can wander out of an open dialog onto the page behind it.

**Independent Test**: open every dialog on the volunteer pages — at phone width, at tablet width,
and with a keyboard — and confirm each behaves identically.

**Acceptance Scenarios**:

1. **Given** any dialog on a volunteer page, **When** it opens on a phone, **Then** it fills the
   screen, with its heading at the top and its content scrolling within it.
2. **Given** a dialog that opens on a search box, **When** it opens, **Then** the cursor is in the
   search box; **Given** any other dialog, **Then** the cursor is in its first field or control.
3. **Given** an open dialog, **When** the volunteer presses Tab repeatedly, **Then** focus moves
   only among the dialog's own controls and never reaches the page behind it.
4. **Given** an open dialog, **When** it is closed — by its Close control or the Escape key —
   **Then** focus returns to the control that opened it.
5. **Given** a dialog centred over the page on a tablet or computer, **When** the volunteer taps
   outside it, **Then** it closes if it has no actions of its own, and otherwise nothing happens.
6. **Given** a dialog with a change not yet saved, **When** it is closed by any means, **Then** the
   volunteer is asked "Discard your changes?"; declining keeps everything as it was; **Given** a
   dialog with nothing changed, **Then** it closes at once.
7. **Given** a screen reader, **When** a dialog opens, **Then** it is announced as a dialog with its
   heading as its name.

---

### User Story 3 - Actions in one place, Save always bottom right (Priority: P2)

A form's actions — Archive, Close, Cancel this dance, Mark reviewed and the like — sit together in
one bar, with Save last, at the bottom right. In a dialog, the bar is at the foot of that dialog; on
a page, it is pinned to the bottom of the screen. The volunteer never hunts for Save.

**Why this priority**: it removes the "where is the button" pause on every form, and on a phone it
keeps Save within reach of the thumb.

**Independent Test**: open every dialog with actions, and the gate page; confirm the bar's position
and order, and that it never covers what is being typed.

**Acceptance Scenarios**:

1. **Given** a dialog with actions, **When** it opens, **Then** its actions are together in one bar
   at the foot of the dialog, with Save (or the dialog's main action) last, at the bottom right.
2. **Given** a narrow screen and long labels, **When** the bar is shown, **Then** it stays on one
   line: a label wraps inside its button rather than the buttons wrapping onto a second row.
3. **Given** the gate page on a phone, **When** the volunteer scrolls, **Then** its Save stays
   pinned at the bottom right of the screen, clear of the iPhone's home indicator.
4. **Given** a field near the bottom of a form, **When** the volunteer types in it with the
   on-screen keyboard open, **Then** the field is not hidden by the action bar.
5. **Given** a dialog, **When** its action bar is used, **Then** it acts on that dialog only.
6. **Given** a dialog longer than the screen, **When** the volunteer scrolls its content, **Then**
   the action bar stays in view at the foot of the dialog.
7. **Given** the gate report on screen, **When** the volunteer scrolls, **Then** its Print stays
   pinned at the bottom right; **When** Print is pressed — on a computer or a phone — **Then** the
   device's print screen opens, and the printout holds the report without the action bar.

---

### User Story 4 - Layouts change at the same widths everywhere (Priority: P3)

The volunteer pages change their layout at the same two named widths — a phone, a large phone or
small tablet, and wider — measured so that they respond to the browser's font size. A page never
scrolls sideways on any supported screen, including a small phone and a tablet.

**Why this priority**: it is what makes the later page conversions consistent; on its own the
volunteer notices only that nothing overflows.

**Independent Test**: view each converted page at 320, 360, 390 and 430 pixels wide, and on a
tablet at 768 × 1024, 820 × 1180 and 1024 × 768; nothing scrolls sideways and each page changes
layout only at the named widths.

**Acceptance Scenarios**:

1. **Given** a converted page at any supported width, **When** viewed, **Then** it has no sideways
   scroll.
2. **Given** a browser whose font size is set to 200%, **When** a converted page is viewed,
   **Then** no label overlaps or is clipped, and the layout changes at the same point relative to
   the text; **Given** a phone's own larger-text setting, **Then** no label is clipped.
3. **Given** the converted pages, **When** their layouts are compared, **Then** they change only at
   the two named widths, not at page-specific ones.

### Edge Cases

- **A dialog opened from inside a dialog.** A booking opened from a band's lineup (feature 087)
  opens over the lineup; focus stays in the top dialog, and closing it returns focus to the lineup
  control that opened it.
- **Back with a dialog over a dialog.** Back closes only the top one (a booking opened from a
  lineup), returning to the dialog beneath; a further Back closes that; only then does Back leave
  the page.
- **A dialog with no actions.** A dialog that only shows something (a list, a read-only record)
  has just its Close, in the action bar's place.
- **A read-only viewer.** A volunteer who may only read sees the dialog without Save; the bar holds
  Close alone.
- **Printing.** The gate report prints as it does today. Its Print moves into its action bar,
  because a phone's own print is buried in a menu (iPhone: Share → Print; Galaxy: the browser menu);
  the bar itself never appears on the printout.
- **Enlarged text.** At 200% text a 44-pixel control grows with its label rather than clipping it.
- **Phones in landscape.** Not supported (decided 2026-09-28): phones are checked in portrait only.
- **Dark mode.** Not supported: volunteer pages stay light (decided 2026-09-28).

## Requirements *(mandatory)*

### Functional Requirements

#### Touch targets

- **FR-001**: Every interactive control on the volunteer pages this feature converts — check-in,
  the gate, payments, the gate report — and in every dialog MUST be at least 44 × 44 CSS pixels.
- **FR-002**: Neighbouring controls MUST be at least 8 CSS pixels apart.
- **FR-003**: A control whose visible mark is smaller than 44 pixels MUST respond anywhere within a
  44 × 44 area around it.
- **FR-004**: The minimum MUST be defined once and used everywhere, so that changing it is a single
  change.
- **FR-005**: The public site's controls MUST be unchanged (they stay at 44 pixels).

#### The one dialog

- **FR-006**: Every dialog on the volunteer pages MUST be the same dialog. The four kinds in use
  today — the shared one, Booking Central's panel, check-in's own and the contacts pages' own — MUST
  be replaced by it.
- **FR-007**: Below the first named width, 40 rem (FR-020), the dialog MUST fill the screen; from
  that width up — every supported tablet and computer — it MUST sit centred over the page, no wider
  than its content needs.
- **FR-008**: The dialog MUST have its own heading, which is also its accessible name, and a Close
  control; Escape MUST close it.
- **FR-008a**: A tap outside the dialog (where it does not fill the screen) MUST close it only when
  it has no actions of its own — its action bar holds Close alone (FR-019). A tap outside a dialog
  with any action of its own (Save, Merge, Delete, …) MUST do nothing, so half-entered work is never
  lost to a stray tap.
- **FR-008b**: The browser's or phone's Back (Android's Back gesture or button, an iPhone's edge
  swipe, the browser's Back button) MUST close the top open dialog exactly as its Close does, and
  MUST NOT leave the page while a dialog is open. With no dialog open, Back behaves as it does
  today.
- **FR-009**: Its content MUST scroll within it, never the page behind it.
- **FR-010**: On opening, focus MUST move to its search box if it has one, otherwise to its first
  field or control.
- **FR-011**: While open, keyboard focus MUST stay within the dialog; Tab and Shift-Tab cycle
  through its own controls only.
- **FR-012**: On closing, focus MUST return to the control that opened it.
- **FR-012a**: If anything in the dialog has been changed and not saved, closing it — by Close,
  Escape, Back or a tap outside — MUST first ask "Discard your changes?". Declining keeps the dialog
  open with everything as it was; accepting closes it and discards the changes. A dialog with no
  unsaved changes MUST close at once, without asking.
- **FR-013**: A dialog opened over another dialog MUST hold focus until it closes, then return it to
  the dialog beneath.

#### The action bar

- **FR-014**: A form's actions MUST be grouped in one action bar, with Save — or the form's main
  action — last, at the bottom right.
- **FR-015**: In a dialog the action bar MUST be pinned at the foot of that dialog, at every width,
  and act on it alone; the dialog's content scrolls above it, so the bar is always in view.
- **FR-016**: On a page with page-level actions, the action bar MUST be pinned to the bottom of the
  screen, clear of the iPhone's home indicator. Two converted pages have one: the gate page (Save)
  and the gate report (Print).
- **FR-017**: The action bar MUST stay on one line; when space is short, a label wraps inside its
  button rather than the buttons wrapping onto a second row.
- **FR-018**: The action bar MUST never hide the field being typed in.
- **FR-019**: A dialog with no actions of its own — one that only shows something, or one opened by
  a volunteer who may only read — MUST show only Close in its action bar.

#### Widths

- **FR-020**: The converted pages and every dialog MUST change layout only at two named widths —
  40 rem (about 640 pixels) and 48 rem (about 768 pixels) — measured in text-relative units so they
  respond to the browser's font-size setting. The page-specific widths in use today on the converted
  pages MUST be replaced by them. The other volunteer pages adopt the two widths when they are
  converted.
- **FR-021**: The converted pages MUST have no sideways scroll at 320, 360, 390 and 430 pixels wide
  in portrait, and on tablets at 768 × 1024, 820 × 1180 (portrait) and 1024 × 768 (landscape).
- **FR-022**: Text on the converted pages and in every dialog MUST be at least 16 pixels, and every
  text field there at least 16 pixels (a smaller field makes an iPhone zoom the page when it is
  tapped).

#### What does not change

- **FR-023**: No workflow, permission or data MUST change. Every action a volunteer can take today
  on these pages stays, in the same order of steps. The one addition is the "Discard your changes?"
  question (FR-012a), which appears only when unsaved work would otherwise be lost.
- **FR-024**: Reports MUST print as they do today. The gate report's Print MUST be in its pinned
  action bar, and MUST open the device's print screen on a computer and on a phone; the action bar
  MUST NOT appear on the printout. **Except Safari on the iPhone**, which cannot print the report as
  landscape letter: there Print MUST give way to a note saying to print from Chrome or a computer
  *(decided 2026-09-30; a PDF that prints the same everywhere is backlog B67)*.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the controls on check-in, the gate, payments, the gate report and every
  dialog measure at least 44 × 44 CSS pixels at phone width.
- **SC-002**: The volunteer pages use exactly one kind of dialog (from four today).
- **SC-003**: In every dialog, pressing Tab 30 times in a row never moves focus onto the page behind
  it, and closing the dialog returns focus to the control that opened it.
- **SC-004**: In every dialog with actions, Save (or its main action) is the bottom-right control.
- **SC-005**: None of the converted pages scrolls sideways at any of the supported widths listed in
  FR-021, including with the browser's font size at 200%.
- **SC-006**: On one iPhone and one Galaxy phone — Samsung Internet included — every converted page
  and dialog passes the device check: every control hit first time, no zoom on tapping a field, no
  field hidden by the keyboard or the action bar, Save within reach at the bottom right.
- **SC-007**: Every workflow on the converted pages completes in the same steps as before.
- **SC-008**: With a dialog open, Back never leaves the page; and in every dialog holding an unsaved
  change, all four ways of closing it (Close, Escape, Back, a tap outside) ask before discarding.

## Assumptions

- **Scope of pages.** This feature converts only the pages already built for a phone — check-in,
  the gate, payments, the gate report — plus every dialog, wherever it is. The volunteer menu, the
  volunteer home page and the sign-in page belong to the volunteer frame; Booking Central's cards,
  and the remaining volunteer pages, to the conversions that follow.
- **Device testing** is done through the development tunnel (merged 2026-09-29) on real phones; the
  Galaxy testers are Sean Aman and Margaret Mathews.
- **The minimum is 44 pixels** on volunteer pages, the same as the public site *(decided
  2026-09-30, after the phone tests; it was 48, decided 2026-09-28)*. It is set in one place, so
  changing it again is one change.
- **The feature 060 patterns** — Record mode and Triage mode — are kept; this feature changes their
  controls' size and their dialogs, not their layout.
- **No automated in-browser tests exist** (backlog B66), so layout and sizing are verified by
  measuring in the browser and on the devices, alongside the existing tests for behaviour.
- **Dependencies**: none on other features. The volunteer frame and the page conversions depend on
  this one.
