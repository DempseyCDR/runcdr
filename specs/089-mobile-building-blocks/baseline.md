# Baseline: controls under 48 × 48 before feature 089

**Taken**: 2026-09-29 (T001), at 390 × 844 in the browser pane, signed in through the tunnel, with
the quickstart §2 script. Sizes are width × height in CSS pixels. Nothing scrolled sideways on any
page.

## Converted pages

| Page | Controls measured | Under 48 | What they are |
|---|---|---|---|
| Check-in | 10 | 8 | "Change" (event) 64×27; the search box 44 high; children 64×25; two checkboxes 36 high; the three action buttons 47 high |
| The gate | 13 | 12 | "Change" 64×27; eight money fields, Count, Add a sale and Save all 44 high |
| Payments | 27 | 27 | "Change" 64×27; every row's Edit, Void, Delete, Record, Donated, method radios and amount fields 44 high; the name buttons 41 wide; the four actions 44–47 high |
| The gate report | 5 | 5 | the event and series selectors 19 high; the two dates 22 high; Print 44 high |

## One dialog of each shell

| Shell | Dialog | Controls | Under 48 | What they are |
|---|---|---|---|---|
| Shared `Dialog` | Count the cash (gate) | 23 | 9 | the seven face buttons, Use as gross cash and Close, 44 high |
| Shared `Dialog` | Performer editor (payments → Edit) | 13 | 12 | fields and buttons 22 high, checkboxes 19 high, a link 19 high |
| Booking Central `Panel` | Performers needing a contact | 15 | 15 | every name button 25 high; **no Close control at all** |
| Check-in's own | Checked in | 8 | 8 | Close, the three sort buttons and the rows, 44 high |
| Check-in's own | Correct attendance (over Checked in) | 9 | 9 | every control 20–22 high, Close 50×22 |
| Contacts' own | Add contact | 18 | 11 | the eleven role checkboxes 25 high |

## Controls styled outside the files the plan named

The measurements found three shared styles the plan's file list did not name. Each is used on a
converted page or inside a dialog, so each is in scope (FR-001):

- **"Change"** — the event confirmation shared by check-in, the gate and payments
  (`src/app/_components/EventConfirm.module.css`).
- **The gate report's selectors** — the event, series and date controls.
- **The performer editor** — the form Booking Central and payments both open
  (`src/app/(admin)/_performers/`).

## After (T011, T024, T031, T036) — 2026-09-29

*Measured against the first minimum, 48px. Rich lowered it to 44px on 2026-09-30, so every control
counted here as meeting 48 meets 44.*

Measured the same way, at 390 × 844 unless a size is given.

| Where | Controls | Under 48 | Text under 16px |
|---|---|---|---|
| Check-in | 10 | 0 | none |
| The gate | 13 | 0 | none |
| Payments | 27 | 0 | none |
| The gate report | 5 | 0 | none |

| Dialog (shell before) | Controls | Under 48 | Bar |
|---|---|---|---|
| Checked in (check-in) | 8 | 0 | Close |
| Correct attendance, over Checked in (check-in) | 9 | 0 | Close · Delete attendance |
| Count the cash (shared) | 23 | 0 | Close · Use as gross cash |
| Add a sale (shared) | 10 | 0 | Close · Record |
| Add a performer (shared) | 2 | 0 | Close (Add once a performer is picked) |
| Substitute a performer (shared) | 4 | 0 | Close · Substitute |
| One check, several performers (shared) | 6 | 0 | Close · Record check |
| Pay an earlier booking (shared) | 2 | 0 | Close |
| Performer editor (shared) | 13 | 0 * | Close · Archive · Save |
| Void check (shared) | 3 | 0 | Close · Void check |
| Delete payment (shared) | 3 | 0 | Close · Void · Delete |
| Edit payment (shared) | 9 | 0 | Close · Save |
| Donated fee (shared) | 2 | 0 | Close · Confirm donation |
| Booking (shared, Booker) | 6 | 0 | Close · Save |
| Event (shared, Booker) | 11 | 0 | Close · Cancel this dance… · Delete this dance… · Save |
| Performers needing a contact (panel) | 16 | 0 | Close |
| Performer card (panel) | 8 | 0 | Close · Archive |
| Caller or instructor (panel) | 3 | 0 | Close |
| Book music (panel) | 2 | 0 | Close |
| Band lineup (panel) | 9 | 0 | Close |
| Add contact (contacts) | 19 | 0 | Close · Create |
| Contact record (contacts) | 14 | 0 | Close · Archive |

\* One link inside a sentence ("David holds this performer's email…", 41×19) is exempt — research
R13.

**Not measured in the browser** (no data in the development database to open them, or reached only
through a flow not walked): the venue card, the band card, check-in's Add contact, the held-merge
chooser and the merge comparison. Each uses the same shell and the same body floor as those above,
and each is covered by its component tests.

**Widths (T036)**: check-in, the gate, payments and the gate report have no sideways scroll at 320,
360, 390 and 430 wide and at 768 × 1024, 820 × 1180 and 1024 × 768; with the page's text doubled,
none at the phone widths either. At tablet widths with doubled text the public menu bar overflows
(out of scope — research R13); doubling the page's font does not move `rem` breakpoints, so the
true 200% check is the browser's own font-size setting (quickstart §3).

**Dialogs at 1024 × 768**: centred, 640px wide; a tap outside one with actions leaves it open;
Escape closes it and focus returns to the control that opened it. **Back** (real browser, Next.js
router): closes only the top dialog of two, the address unchanged; the page scrolls again after
the last. **Tab**: 30 real presses stay inside the counting dialog.

**The event dialog at 320 wide**: one row — Close, then "Cancel this dance…" and "Delete this
dance…" wrapping inside their buttons, Save bottom right.
