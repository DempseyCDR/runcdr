# Contract: the one dialog

**Component**: `src/app/_components/Dialog.tsx` (default export `Dialog`), plus the hook
`useDialogSaved` from the same module. **Stack**: `src/app/_components/dialogStack.ts`.

## Props

```ts
type DialogProps = {
  heading: string;          // shown at the top; the dialog's accessible name
  onClose: () => void;      // called after the shell decides to close (after any discard question)
  actions?: React.ReactNode; // the dialog's own buttons, main action LAST; omitted → Close alone
  message?: React.ReactNode; // shown just above the bar — why a Save was refused, always in view
  settled?: boolean;        // the dialog's business is done: closing loses nothing, so never asks
  children: React.ReactNode; // the body — the only part that scrolls
};
```

`label` is **retired** (research R4). An owner that passed `label` and `heading` keeps `heading`.

```ts
function useDialogSaved(): () => void; // call after a save that leaves the dialog open
function useInDialog(): boolean;       // a shared form drops its own Cancel inside a dialog

// Buttons owned by a component inside the body (a form several dialogs share): inside a dialog they
// render in its bar, after `actions`; outside one they render in place. `secondary` ones (Archive,
// Restore) sit before the main ones (Save), whatever order they mount in.
function DialogActions(props: { secondary?: boolean; children: React.ReactNode }): JSX.Element;
```

These three were added during implementation (research R13): PerformerForm, VenueForm, BandRoster,
ArchiveControl and RecordView each keep their Save or Archive inside a component that is also used
outside dialogs, and lifting every save out of them would have been a rewrite.

## Structure (what tests may rely on)

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` → the heading element (an `h2`).
- The heading comes first, then the body, which scrolls, then an `ActionBar`
  ([action-bar.md](./action-bar.md)) holding **Close** first, then `actions`.
- **No other element in `src/app` carries `role="dialog"`** (guard test `oneDialog.test.ts`).

## Behaviour

| # | When | Then | Spec |
|---|---|---|---|
| D1 | It opens | Focus goes to its first `input[type="search"]`, otherwise its first field or control in the body | FR-010 |
| D2 | Tab / Shift-Tab | Focus cycles through the dialog's own focusable elements only, wrapping at both ends | FR-011 |
| D3 | Close, or Escape | A close request (D6) | FR-008 |
| D4 | Back (a `popstate` for its history entry) | A close request (D6) for the **top** dialog only | FR-008b |
| D5 | A tap on the backdrop (≥ 40rem) | A close request if `actions` is absent; otherwise nothing | FR-008a |
| D6 | A close request, unchanged | `onClose()` at once | FR-012a |
| D6a | A close request, changed | The bar shows "Discard your changes?" with **Keep editing** (focused) and **Discard**. Keep editing restores the bar, and after Back re-pushes the entry. Discard calls `onClose()` | FR-012a |
| D7 | The first `input`/`change` event in the body from anything but a search box | Changed | FR-012a |
| D8 | `useDialogSaved()()` | Unchanged | FR-012a |
| D9 | It closes by any means, or the owner unmounts it | Focus returns to the element focused when it opened — read on the first render, before a field inside can focus itself — if it is still on the page and nothing else has taken focus on purpose (payments' "Change the number" puts it in the number field). Its history entry is removed (reconciled once per render; not if the address changed) | FR-012, FR-013 |
| D10 | Another dialog opens over it | Only the new one answers D2–D5. When it closes, focus returns into this one | FR-013 |
| D11 | Any dialog is open | The page behind does not scroll | FR-009 |
| D12 | Anything inside the dialog | Controls meet `--tap-min` and text is at least 16px, however the owning page styles them: a `:where()` floor on the body's controls, `<small>` at full size, and `--fs-sm` redefined as `1rem` inside the dialog | FR-001, FR-022 |

## Layout

| Width | Layout | Spec |
|---|---|---|
| < 40rem | Fills the screen (`inset: 0`, `100dvh`). The bar is pinned at the foot, clear of the home indicator | FR-007, FR-015, FR-016 |
| ≥ 40rem | Centred over a backdrop, as wide as its content up to 40rem, no taller than the screen less a margin; the bar is pinned at its foot | FR-007, FR-015 |

## What changes for each owner

- **Pass `heading`, not `label`.**
- **Move the buttons into `actions`, main action last.** Delete the dialog's own Close or Cancel;
  the bar's Close replaces it.
- **Stays open after saving?** Call `useDialogSaved()` after each successful save.
- **A viewer who may only read:** leave out the actions they may not use; with none left, omit
  `actions`, so the bar holds Close alone and a tap outside closes it (FR-019, FR-008a).
- **Body text and fields at least 16px** (FR-022), including a body styled by a page not yet
  converted.
- **Delete own shell code:** the backdrop, panel, Escape handler and focus effect.
- **Remove a duplicate heading:** where the body began with its own heading (Booking Central's
  panels), it goes, because the shell's heading replaces it.
