# Contract: the one action bar

**Component**: `src/app/_components/ActionBar.tsx` (default export `ActionBar`)

```ts
type ActionBarProps = {
  lead?: React.ReactNode;    // first, beside the rest: a dialog's Close, or the discard question
  pinned?: boolean;          // a page's bar, pinned to the bottom of the screen
  children?: React.ReactNode; // the buttons, flush right, in order — the main action LAST
};
```

## Structure (what tests may rely on)

- The bar is one `role="group"` element named "Actions" (`aria-label="Actions"`), holding the
  buttons in order.
- A pinned bar carries `data-pinned` (position itself cannot be seen in jsdom).

## Rules

| # | Rule | Spec |
|---|---|---|
| A1 | Buttons appear in the order given; the last is the main action and sits bottom right. The whole bar sits flush right, Close first and beside the others (Rich, 2026-09-30); a bar holding a single button (the gate's Save, the report's Print) places it at the right | FR-014 |
| A2 | One line only. Buttons never wrap to a second row; a long label wraps inside its button. Each button is at least `--tap-min` in both directions | FR-017, FR-001 |
| A3 | Buttons are at least 8px apart | FR-002 |
| A4 | **In a dialog** the shell renders the bar at its foot, with **Close first**. The bar is outside the scrolling body, so it never covers a field | FR-015, FR-018 |
| A5 | **`pinned`** (a page): sticky at the bottom of the screen, padded by at least `env(safe-area-inset-bottom)`. The page reserves the bar's height with `scroll-padding-block-end` | FR-016, FR-018 |
| A6 | Holds no text under 16px | FR-022 |

## Users in this feature

- **Every dialog, through the shell** ([dialog.md](./dialog.md)).
- **The gate page's Save** (`src/app/(door)/gate/page.tsx`, today's `.save` block), as
  `<ActionBar pinned>`.
- **The gate report's Print** (`src/app/(admin)/treasurer/page.tsx`, today's `.printButton`), as
  `<ActionBar pinned>` holding the one Print button, which calls `window.print()` as it does now.
  The bar stays **outside** the `data-printable-report` article, so the report's existing print
  rules (hide everything, then reveal only the report) leave it off the printout. No new print rule
  is needed (research R12).
