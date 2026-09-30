# Data model: Mobile building blocks for volunteer pages

**Feature**: 089-mobile-building-blocks | **Date**: 2026-09-29

**No stored data changes.** There is no migration, table, column or server code. What follows is
the state the browser keeps while dialogs are open, because the discard question and Back depend
on it.

## The open-dialog stack (`dialogStack.ts`)

The dialogs open right now, bottom to top. It lives in the page's memory and is gone on reload.

| Field | Meaning |
|---|---|
| `entries` | Open dialogs in order; the last is the **top**, the only one that answers Escape, Tab and Back |
| `pushed` | How many browser-history entries the stack has pushed and not yet removed |
| `address` | The page address when the first entry was pushed; if it changes, the stack stops managing history (research R2) |
| `ignorePops` | How many `popstate` events the stack caused itself and must ignore |

**Rules**:

- **Push and pop together:** opening a dialog adds one entry and pushes one history entry;
  removing it (by any means) removes one.
- **Reconcile once:** after each render, if `pushed` is greater than the number of open dialogs,
  the stack goes back by the difference in a single step.
- **Scroll lock:** while there is at least one entry, the document does not scroll (research R9).

## One dialog's states

```text
             open
  (closed) ────────▶ UNCHANGED ──first input/change (not a search box)──▶ CHANGED
                        ▲                                                   │
                        └─────────────── useDialogSaved() ◀─────────────────┤
                                                                            │
  close request (Close · Escape · Back · tap outside*)                      │
     UNCHANGED ─────────────────────────────────────────────────▶ (closed)  │
     CHANGED ──▶ ASKING "Discard your changes?" ◀───────────────────────────┘
                   ├─ Keep editing ─▶ CHANGED  (Back's history entry is pushed again)
                   └─ Discard ──────▶ (closed)

  The owner unmounting the dialog (after a save) ─────────────────▶ (closed), never asks

  * a tap outside is a close request only for a dialog with no actions (FR-008a)
```

**On closing**: focus returns to the element that had it when the dialog opened, if that element is
still on the page (FR-012). Beneath a nested dialog, that is the control in the dialog beneath
(FR-013).

## What a dialog owner supplies

| Item | Required | Meaning |
|---|---|---|
| `heading` | yes | Shown at the top and used as the accessible name (research R4) |
| `onClose` | yes | Called once the shell has decided to close (after any discard question) |
| `actions` | no | The dialog's buttons, main action last; absent means Close alone (FR-019) |
| `useDialogSaved()` | when it stays open after a save | Marks the dialog unchanged again |

The full component contract is in [contracts/dialog.md](./contracts/dialog.md).
