# Quickstart: a sign-out control for staff

**Feature**: 083-staff-sign-out | **Spec**: [spec.md](./spec.md) | **Contract**:
[contracts/sign-out.md](./contracts/sign-out.md)

## Prerequisites

- **Nothing running against the development database** while the suite runs.
- Two staff sign-ins, to play the hand-over: any two volunteer accounts will do. One may be the
  super-user.
- A phone-sized viewport (390 × 844) for §1, and a laptop for §3.

## Automated gates

```bash
pnpm tsc --noEmit
pnpm vitest run
pnpm build
pnpm lint:md
```

Plus `pnpm exec eslint` and `pnpm exec prettier --check` on the changed files only. No migration: this
feature adds no schema change.

## Manual pass

### 1. Signing out, on a phone (US1)

1. Sign in, open `/gate` at 390 × 844. *Expect*: the volunteer menu shows **Signed in as {your name}** and
   a **Sign out** button at its end, both reachable without zooming or sideways scrolling.
2. Tap **Sign out**. *Expect*: you arrive at the public home page, and the volunteer menu is gone.
3. Open `/gate` again. *Expect*: the sign-in page, not the gate.
4. Press **Back**, twice if need be. *Expect*: no staff page opens with your figures still on it. This is
   the browser behaviour of SC-002 that no test can settle (research R2) — if a stale page does paint,
   note what the browser and the page were and raise it.

### 1a. Signing in again asks which account (FR-011)

1. After signing out, choose **Sign in with Google**. *Expect*: the account chooser, including **Use
   another account** — not a silent return to the account you just left.

### 2. The hand-over (US2)

1. Sign in as the first volunteer on the phone and record something at the door — a check-in or a sale.
2. Hand it over: **Sign out**, then sign in as the second volunteer. *Expect*: the menu now names the
   second volunteer.
3. Record something else, then look at it on `/gate`. *Expect*: the two entries are attributed to the two
   different people ("recorded by", feature 082).

### 3. The awkward cases (US1, US3)

1. On `/gate`, type a figure and **do not save**, then tap **Sign out**. *Expect*: the browser's
   unsaved-work warning first. Cancel it. *Expect*: you are still signed in, with the figure still typed.
2. Sign out from a **public** page — `/whats-on`, say, while signed in. *Expect*: the volunteer menu and
   its control are there too, and signing out works from there.
3. Sign out in one tab while a second tab is open on a staff page. *Expect*: the second tab refuses the
   next action and asks for sign-in; signing out again from it is harmless.
4. While signed out, browse the public site. *Expect*: no volunteer menu, no name, no sign-out control.
5. Sign in as an account with different capabilities. *Expect*: the pages offer that account's controls —
   this is the occasion that raised B53.

## What is out of scope here

Signing every device out at once, and an administrator ending someone else's session: neither is built,
and neither should appear in the menu.
