# Quickstart: validating the mobile building blocks

**Feature**: 089-mobile-building-blocks

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

Expected:

- `tests/component/dialog.focus.test.tsx`, `dialog.close.test.tsx` and `actionBar.test.tsx` are
  green, as are `tests/unit/volunteerViewport.test.ts` and the gate report's print assertions in
  `tests/component/treasurer.gateReport.test.tsx`.
- The two guards are green: `volunteerStyle.test.ts` and `oneDialog.test.ts`.
- Every existing dialog test is green against the new shell.

## 2. Measuring the controls (SC-001)

Start the dev server. Open each converted page (check-in, the gate, payments, the gate report) at
390 × 844, then open each of the 29 dialogs listed below. Run this in the browser console. It lists
every visible control smaller than 44 × 44 (the tap minimum, `--tap-min`); a checkbox or radio is
measured by its label, because the label is what is tapped.

```js
[...document.querySelectorAll('button, a[href], input, select, textarea, summary, [role="button"]')]
  .filter((el) => el.offsetParent !== null && el.type !== "hidden")
  .map((el) => {
    const target = ["checkbox", "radio"].includes(el.type) ? el.closest("label") ?? el : el;
    const r = target.getBoundingClientRect();
    return { el: target, w: Math.round(r.width), h: Math.round(r.height) };
  })
  .filter(({ w, h }) => w < 44 || h < 44);
```

Expected: an empty list on every converted page and in every dialog. Record the result for each in
`baseline.md`.

The 29 dialogs, by the shell they used before this feature:

- **Shared dialog (15):**
  - the Booker's booking and event editors;
  - payments: add performer, confirm (two), delete, earlier booking, edit payment, several
    performers, substitute, void, the performer editor and the donated fee;
  - the gate's counting dialog;
  - the sale-or-check dialog.
- **Booking Central's panel (7):** venue, band lineup, performers needing a contact, performer
  card, band card, book a caller, book music.
- **Check-in (3):** correction, checked in, add contact.
- **Contacts (4):** record editor, add contact, held-merge chooser, merge comparison.

## 3. The widths (SC-005)

View each converted page and a long dialog at each size below: phones in portrait (320 × 640,
360 × 780, 390 × 844, 430 × 932) and tablets (768 × 1024, 820 × 1180, 1024 × 768).

Expected:

- **No sideways scroll:** `document.documentElement.scrollWidth <= innerWidth`.
- **Dialogs:** a dialog fills the screen below 640px and is centred from 640px up.
- **Enlarged text:** repeat at 390 × 844 in desktop Chrome with Settings → Appearance → Font size
  set so the default is 32px (200%). The two widths move with it, no label is clipped, and controls
  grow with their labels. On the phones, the larger-text setting behaves like zoom rather than font
  size: check only that no label is clipped.

## 4. Dialog behaviour with a keyboard (SC-003, SC-008)

Open each of these at desktop width:

- a booking from a band's lineup (a nested dialog);
- a check-in correction from the checked-in list (nested);
- a payment edit;
- the gate's counting dialog;
- a contact's record.

For each one:

1. **First focus:** focus starts in the search box or the first field.
2. **The trap:** Tab 30 times, then Shift-Tab 30 times. Focus never leaves the top dialog.
3. **Escape:** closes the dialog, and focus returns to the control that opened it (in a nested
   case, into the dialog beneath).
4. **Discard question:** type in a field, then press Escape. "Discard your changes?" appears.
   - Keep editing leaves the typing in place.
   - Discard closes the dialog.
5. **Search is not a change:** type only in a search box, then press Escape. It closes without
   asking.
6. **Back:** reopen the dialog and press the browser's Back.
   - Only the top dialog closes, and the address is unchanged.
   - Pressing Back again closes the next dialog down, or leaves the page if none is open.
7. **Tap outside:** click the backdrop. A dialog with a Save stays open; a dialog with only Close
   closes.

## 5. The action bar (SC-004)

- **Order:** in every dialog, Close is first and Save (or the main action) is the bottom-right
  control.
- **One line:** at 320px, Booking Central's event dialog keeps its buttons on one line, with the
  labels wrapped inside the buttons.
- **Gate page:** Save stays pinned at the bottom while scrolling. Focusing the last field scrolls it
  clear of the bar.
- **Gate report:** Print stays pinned at the bottom right while scrolling. Print opens the print
  screen, and the print preview shows the report without the action bar.

## 6. On the phones (SC-006), through the tunnel

Start ngrok and sign in on the phone (see `.env.example`). Use one iPhone (Safari) and one Galaxy
(Samsung Internet; Sean Aman or Margaret Mathews). On every converted page and dialog, check:

- [ ] Every control is hit the first time with a thumb.
- [ ] Tapping a text field does not zoom the page.
- [ ] With the keyboard open, the field being typed in is visible, never under the bar or the
      keyboard.
- [ ] The gate's pinned Save and each dialog's bar clear the home indicator.
- [ ] The gate report's Print opens the phone's print screen: Chrome on the iPhone, and Android's
      print screen in both Chrome and Samsung Internet; the printout is landscape letter, two
      columns, with no action bar. On Safari on the iPhone there is no Print — a note says to print
      from Chrome or a computer (B67).
- [ ] Android's Back gesture closes the top dialog. On the iPhone, an edge swipe does the same.
- [ ] A dialog fills the screen, and only its content scrolls; the page behind stays still.

## 7. Nothing else moved (SC-007, FR-005)

- **Workflows:** a check-in, a gate count and Save, a payment and a gate report complete in the same
  steps as before. The only new step is the discard question when leaving unsaved work.
- **Public site:** its controls still measure 44px.
