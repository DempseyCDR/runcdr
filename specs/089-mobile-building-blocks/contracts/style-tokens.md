# Contract: the style conventions and their guard

## The tap minimum

```css
/* src/app/globals.css — vocabulary only */
--tap-min: 44px; /* 48px until 2026-09-30 */
```

- **Every minimum size of an interactive control** on a converted page, in the dialog shell or in
  the action bar is `var(--tap-min)`. This covers `min-height`, `min-width`, `min-block-size` and
  `min-inline-size`.
- **Feature 060's shared rules follow the token:** `.touchTarget` (`AdminPage.module.css`) and
  `TriageList`'s rows.
- **The public site does not read it** and keeps its literal `44px` (FR-005).

## The two widths

- **Only two widths:** media queries in the files below are `@media (min-width: 40rem)` or
  `@media (min-width: 48rem)`, written as those literals, since a custom property cannot be used in
  a media query (research R7).
- **Print:** `@media print` is allowed where it already exists.
- **Mobile-first:** the phone is the base, so no `max-width` queries.
- **No breakpoint where none is needed:** a grid that only needed a tiny-phone fallback uses
  `repeat(auto-fit, minmax(…, 1fr))` instead — as many columns as fit, following enlarged text
  (research R7).

## Text size

- **No text below 16px:** no `font-size` below `1rem`, and no `var(--fs-sm)`, in the files below
  (FR-022).

## Files the guard checks (`tests/unit/volunteerStyle.test.ts`)

```text
src/app/_components/ActionBar.module.css
src/app/_components/AttendanceBreakdownView.module.css   # found by the baseline (T001)
src/app/_components/ContactName.module.css               # found by the baseline
src/app/_components/Dialog.module.css
src/app/_components/EventConfirm.module.css              # found by the baseline
src/app/_components/PaymentSummaryView.module.css        # found by the baseline
src/app/EventSelector.module.css                         # new: its inline styles moved here
src/app/_components/SaleOrCheckDialog.module.css
src/app/(door)/checkin/checkin.module.css
src/app/(door)/gate/gate.module.css
src/app/(admin)/payments/payments.module.css
src/app/(admin)/treasurer/treasurer.module.css
```

For each file the guard fails on:

1. **A literal minimum:** a `min-height`, `min-width`, `min-block-size` or `min-inline-size` with a
   literal length other than `0`. It must be `var(--tap-min)`, or a larger `calc()` built on it.
2. **Another width:** an `@media` rule other than `(min-width: 40rem)`, `(min-width: 48rem)` or
   `print`.
3. **Small text:** a `font-size` below `1rem` or `16px`, or `var(--fs-sm)`.

**The second guard** (`tests/unit/oneDialog.test.ts`) fails on `role="dialog"` in any file under
`src/app` other than `src/app/_components/Dialog.tsx` (SC-002).

**Dialogs styled by pages not yet converted** (Booking Central's `hub.module.css` and its
performer card, band roster and lineup; contacts' `contacts.module.css`): FR-001, FR-020 and
FR-022 apply to their dialogs now, but their files are not in the guard's list, because the rest of
those pages is not converted. They are checked in the browser instead: the measuring script in all
29 dialogs (quickstart §2) and the width sweep (quickstart §3).

**Extending the list:** a later conversion (the frame, Booking Central's cards) adds its files to
the list. That is how "converted" is recorded.
