# Contract: the pages

## `/volunteer` — the volunteer home page

- **Place and access:** under `(admin)`, so staff only (the layout's `requireStaff`).
- **Title:** "Volunteer home", through `AdminPage`.
- **Content:** exactly the `menuFor(actor)` result as a page. Groups are sections under their
  headings, Tonight first; each destination is a tap target of at least `--tap-min`. A flat menu is
  one list.
- **Styles:** its stylesheet joins feature 089's style guard.

## Landing after sign-in

- **No page asked for:** the Google callback redirects to `/volunteer` (`safeNextPath(next,
  "/volunteer")`).
- **A page asked for:** a safe `next` is honoured as today.
- **Refusals:** `/login?error=access_denied`, as today.

## `/login` — the sign-in page

| Element | Content |
|---|---|
| Top | `PublicNav` |
| Layout | Two blocks of about the same height: the logotype image (never wider than the screen), and a `<main>` with the sign-in. They stack below 40rem, logotype first |
| Heading | "Volunteer sign-in" |
| Lines | "For club volunteers. Dancers don't need to sign in."; "Volunteer areas require a CDR volunteer account."; the existing note on which Google account to use; "On a shared phone, sign out when you're done." |
| Sign-in control | A link styled as Google's standard light button: the four-colour "G" (inline SVG) and "Sign in with Google", to `/api/auth/google` (with `?next=` as today) |
| Help | "Can't sign in?" linking to `/contact-us` |
| Refusal | The existing generic `role="alert"` message, unchanged |

## `/organizer` — the organizer landing

- **What it is:** a server component that redirects to `/organizer/{organizerLandingKey(...)}`
  (see [data-model.md](../data-model.md)). The menu's "Organizer report" points here.

## `/organizer/[seriesKey]` — the report

- **The selector:** a labelled series `<select>` ("Series") listing every series; choosing one goes
  to `/organizer/{key}`.
- **Printing:** the report is wrapped in `data-printable-report`. `PrintBar` is below it; the
  printout is the report alone, on landscape letter, with its per-dance table fitted to the page.

## `PrintBar` — `src/app/_components/PrintBar.tsx`

- **Everywhere but iPhone Safari:** `<ActionBar pinned>` with **Print** (`window.print()`).
- **On iPhone Safari:** the note "Safari on the iPhone cannot print this report properly — print it
  from Chrome or a computer." (B67). Detection runs after hydration, so the server's page always
  shows Print.
- **Shared print rules:** `@page { size: letter landscape }`; hide everything, then reveal only
  `[data-printable-report]`.
- **Users:** the gate report (moved from its page) and the organizer report.
