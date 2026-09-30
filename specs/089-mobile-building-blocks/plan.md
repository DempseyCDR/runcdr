# Implementation Plan: Mobile building blocks for volunteer pages

**Branch**: `089-mobile-building-blocks` | **Date**: 2026-09-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/089-mobile-building-blocks/spec.md`

## Summary

Make four things one each on the volunteer pages: **one tap size, one dialog, one action bar, one
pair of widths**. The shared `Dialog` is rebuilt as the only dialog shell. It fills a phone's screen
and sits centred from 40rem up. Its accessible name is its heading. It traps Tab, returns focus to
its opener, closes on Back, asks before discarding unsaved work, and pins its action bar at its
foot. The other three shells are replaced by it: Booking Central's `Panel`, check-in's three
hand-built dialogs, and the contacts pages' four. That makes 29 dialogs in all.

An `ActionBar` component holds Close first and the main action last. In a dialog it sits at the
dialog's foot; on the gate page (Save) and the gate report (Print) it is pinned to the screen. One
token, `--tap-min` (44px since the phone tests; first 48px), replaces the 44px, 40px and 36px
minimums on check-in, the gate, payments and the gate report. Two literal widths, `40rem` and
`48rem`, replace those pages' own breakpoints. No data, route or permission changes.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 24

**Primary Dependencies**: Next.js 16 (App Router), React 19, CSS Modules. **No new dependency.**

**Storage**: none. No migration, and no server code changes.

**Testing**: Vitest.

- **Component tests (jsdom, Testing Library, user-event)** cover every dialog behaviour: focus,
  trap, return, Escape, Back, tap outside, and discard.
- **Unit guard tests** scan the CSS and the source for the conventions: the tap token, the two
  widths, 16px text, and one dialog shell.
- **Sizes and layout are measured in a real browser and on the two phones.** jsdom has no layout
  engine, and automated browser tests are backlog B66.

**Target Platform**: the volunteer pages in current Safari (iPhone), Chrome and Samsung Internet
(Android), and desktop browsers. Phones are supported in portrait only; tablets in both
orientations.

**Project Type**: web application (single Next.js project, `src/app` + `src/server`)

**Performance Goals**: none new. Opening a dialog must feel instant, which it already does.

**Constraints**:

- The public site is unchanged (44px, its own breakpoints, no viewport change).
- No workflow change except the "Discard your changes?" question (FR-012a, FR-023).
- The dev server must be stopped while the suite runs.

**Scale/Scope**:

- 4 dialog shells become 1, covering 29 dialog instances in 20 files:
  - 15 already on the shared `Dialog`.
  - 7 on Booking Central's `Panel`.
  - 3 in check-in.
  - 4 in contacts.
- 4 converted pages (check-in, gate, payments, gate report) and 1 shared dialog body
  (`SaleOrCheckDialog`).
- About 107 component-test queries find dialogs by role.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| **I. Test-First** | Pass. Each behaviour of the shell gets a failing component test before the shell changes: heading as name, first focus, Tab trap, focus return, Escape, Back, tap outside, discard, nested dialogs, and the action bar's order. The conventions get failing guard tests before any CSS moves: no literal tap minimum, only `40rem`/`48rem` breakpoints, no text under 16px on the converted pages, and no `role="dialog"` outside the shell. Each shell migration moves its existing component tests first and sees them fail against the old shell. |
| **II. Simplicity / YAGNI** | Pass, with three additions (see Complexity Tracking). **No new dependency:** no focus-trap library and no PostCSS plugin. **No print rules** (Rich, 2026-09-29: hiding bars in print is YAGNI; research R12). **No dark mode, no landscape phone layout.** The shell is rewritten in place, not added beside the old one. |
| **III. Type Safety** | Pass. No casts. DOM lookups use the typed `querySelectorAll<HTMLElement>` form, and event targets are narrowed with `instanceof`. The history state is typed and checked with a type guard before use (research R2). |
| **IV. Observability** | Pass. No new request path, server code or write. All of this runs in the browser; the saves a dialog makes go through routes that already log. |

**Post-design re-check**: unchanged. Phase 1 added no dependency, route or server code. The
contracts ([dialog](./contracts/dialog.md), [action bar](./contracts/action-bar.md),
[style tokens](./contracts/style-tokens.md)) describe components and CSS only.

## Project Structure

### Documentation (this feature)

```text
specs/089-mobile-building-blocks/
├── plan.md              # This file
├── research.md          # R1–R12: shell, Back, discard, name, action bar, tokens, widths, …
├── data-model.md        # no stored data — the dialog's states and the open-dialog stack
├── quickstart.md        # measuring in the browser, the widths, the keyboard, the two phones
├── contracts/
│   ├── dialog.md        # the one dialog: props, behaviour, what each dialog owner supplies
│   ├── action-bar.md    # the one action bar: order, one line, dialog foot vs pinned page
│   └── style-tokens.md  # --tap-min, the two widths, 16px text — and the guard tests
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks — not created by /speckit-plan
```

### Source Code (repository root)

```text
src/app/globals.css                              # + --tap-min: 44px (vocabulary only; first 48px)
src/app/_components/Dialog.tsx                   # REWRITTEN — the one shell (R1–R4, R9)
src/app/_components/Dialog.module.css            # full screen < 40rem, centred ≥ 40rem, pinned foot
src/app/_components/dialogStack.ts               # NEW — the open-dialog stack + Back (R2)
src/app/_components/ActionBar.tsx                # NEW — Close first, main action last (R5)
src/app/_components/ActionBar.module.css         # one line, wrapping labels, pinned variant
src/app/EventSelector.tsx (+ .module.css)        # found by the baseline: inline styles → --tap-min, 16px
src/app/_components/{EventConfirm,AttendanceBreakdownView,ContactName,PaymentSummaryView}.module.css
src/app/(admin)/_performers/PerformerForm.tsx, venues/VenueForm.tsx, bookings/{BandRoster,Lineup,
    PerformerCard}.tsx, ArchiveControl.tsx, _components/RecordView.tsx   # DialogActions (R13)
src/app/(admin)/layout.tsx, src/app/(door)/layout.tsx  # viewport: resizes-content, cover (R8)
src/app/(admin)/_components/AdminPage.module.css # .touchTarget → var(--tap-min)
src/app/(admin)/_components/TriageList.module.css # min-block-size → var(--tap-min)

# Shell 1 — already on Dialog: move actions into the bar, drop own Close/Cancel
src/app/(admin)/_modals/BookingModal.tsx, EventModal.tsx
src/app/(admin)/payments/{AddPerformer,Confirm,Delete,EarlierBooking,EditPayment,
    SeveralPerformers,Substitute,Void}Dialog.tsx, page.tsx
src/app/(door)/gate/CountDialog.tsx
src/app/_components/SaleOrCheckDialog.tsx (+ .module.css)

# Shell 2 — Booking Central's Panel (7 uses) → Dialog
src/app/(admin)/bookings/page.tsx, hub.module.css (Panel, .backdrop/.panel removed)

# Shell 3 — check-in's own
src/app/(door)/checkin/{CorrectionModal,CheckedInDialog,AddContactDialog}.tsx

# Shell 4 — contacts' own
src/app/(admin)/contacts/page.tsx (record editor, add contact)
src/app/(admin)/contacts/_components/{HeldMergeChooser,MergeCompare}.tsx, contacts.module.css

# Converted pages — tap token, two widths, 16px text
src/app/(door)/checkin/checkin.module.css        # 36px and 40px controls → --tap-min; 22.5rem → 40rem
src/app/(door)/gate/page.tsx, gate.module.css    # Save → pinned ActionBar; 22.5rem → 40rem
src/app/(admin)/payments/payments.module.css     # 22.5rem → 40rem
src/app/(admin)/treasurer/page.tsx, treasurer.module.css  # Print → pinned ActionBar; 52.75rem → 48rem;
                                                 # no 0.875rem shrink; print rules unchanged

tests/component/dialog.focus.test.tsx            # NEW — name, first focus, trap, return, nesting
tests/component/dialog.close.test.tsx            # NEW — Escape, Back, tap outside, discard, scroll
tests/component/actionBar.test.tsx               # NEW
tests/unit/volunteerStyle.test.ts                # NEW — guard: token, widths, 16px (style-tokens)
tests/unit/oneDialog.test.ts                     # NEW — guard: role="dialog" only in Dialog.tsx
tests/unit/volunteerViewport.test.ts             # NEW — the volunteer layouts' viewport (R8)
tests/component/treasurer.gateReport.test.tsx    # + Print in a pinned bar, outside the report
tests/component/**                               # existing dialog tests follow the shell
```

**Structure Decision**: the existing single Next.js project. The new shared pieces sit beside the
existing shared `Dialog` in `src/app/_components/`, because both the `(door)` and `(admin)` groups
use them. `dialogStack.ts` is a plain module with no JSX, so the shell and its tests share one
stack.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|---|---|---|
| `dialogStack.ts` (module-level stack of open dialogs) | Nested dialogs (a lineup under a booking; check-in's correction under the checked-in list) need exactly one dialog to own Escape, Tab and Back, and closes must be reconciled with browser history in one place (R2) | Each dialog handling its own keys is today's bug: the dialog beneath also reacts. Each dialog calling `history.back()` for itself breaks when two close in one render. |
| `ActionBar` as its own component | The spec names it as a building block. It is used by every dialog (through the shell) and directly by the gate page and the gate report, and the frame and later conversions will reuse it | Styling each dialog's `.buttons` row separately is the four-behaviours problem this feature exists to remove |
| `DialogActions` / `useInDialog()` (R13) | Five shared forms own their Save or Archive and are also used outside dialogs; their buttons must reach the bar | Lifting every save out of PerformerForm, VenueForm, BandRoster, ArchiveControl and RecordView is a rewrite of five working forms |
| `useDialogSaved()` hook | A dialog that stays open after saving must tell the shell its changes are no longer unsaved, or Close would ask needlessly (R3) | A required `dirty` prop on all 29 dialogs means 29 hand-written change trackers, and each is a place to get it wrong |
