# Contract: the volunteer menu

**Server**: `menuFor(actor)` in `src/server/auth/nav.ts` (shape in
[data-model.md](../data-model.md)). **Presenter**: `src/app/VolunteerNav.tsx`, rendered by `Nav` in
the `(admin)`, `(door)`, `dev` and `(public)` layouts — never by the root layout.

## Structure (what tests may rely on)

- `<nav aria-label="Main">`, the band colour, first on every volunteer page.
- A **"Volunteer"** link to `/volunteer`, and a **"Club site"** link to `/`.
- **Flat menu:** each destination is a link.
- **Grouped menu:** Tonight's destinations are links; every other group of two or more is a
  `<button aria-expanded aria-controls>` named after the group, controlling a list of its links; a
  group of one is a link.
- **The current page's link** has `aria-current="page"`.
- **Signing out:** "Signed in as {name}" and a Sign out form (a POST to `/api/auth/signout`), as
  feature 083 built it.
- **Below 48rem:** the name, and a **Menu** button (`aria-expanded`, `aria-controls`) controlling
  one panel. The panel lists Tonight's links first, open under a heading; then each other group as
  its button, collapsed, its list opening in place; then Sign out and Club site. A flat menu lists
  every link. *(Amended 2026-10-01: groups were listed open.)*

## Behaviour

| # | When | Then | Spec |
|---|---|---|---|
| M1 | A group's button is pressed (click, Enter, Space) | Its panel opens, `aria-expanded="true"`; any other open group closes | FR-008 |
| M2 | Down on an open group's button, or on a link in it | Focus moves to the next link; Up to the previous; Home and End to the first and last | FR-008 |
| M3 | Escape in an open group | It closes; focus returns to its button | FR-008 |
| M4 | A link is chosen, the route changes, or there is a click outside | Any open group or Menu closes | FR-012 |
| M5 | The Menu button is pressed | The Menu panel opens or closes; `aria-expanded` follows; any open group closes | FR-010, FR-012 |
| M6 | Escape in the open Menu | It closes; focus returns to the Menu button | FR-012 |
| M7 | No JavaScript | The Menu panel and, on a computer, every group's panel are shown open (`<noscript>`); Sign out still works | Edge cases |
| M8 | Any width | Every control meets `--tap-min`; the bar never scrolls sideways; below 48rem it is one line at 320px | FR-013 |
| M9 | A group's button is tapped inside the open Menu (below 48rem) | Its list opens in place beneath it, the others close, and the Menu stays open; Escape closes the group first, then the Menu | FR-012 |

Hover opens nothing.
