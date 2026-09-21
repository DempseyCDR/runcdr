# Contract: signing out

**Feature**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md)

*Two contracts: the route, which feature 015 already fixed and this feature does not touch, and the menu,
which is what this feature adds.*

## `POST /api/auth/signout` — unchanged

| Aspect | Contract |
|---|---|
| Method | **POST only.** No GET: a prefetch or an `<img>` must not be able to end a session (FR-006) |
| Body | None |
| Authentication | None required — it reads the sign-in cookie if there is one |
| Effect | Deletes the session row matching that cookie's token; logs `auth.signout` when a row was deleted |
| Response | `303` to `/`, with the sign-in cookie cleared |
| Already signed out | Same response. No row deleted, nothing logged, no error (FR-002's idempotence) |
| Other devices | Untouched — only the session presented by the cookie ends (FR-008) |

## `GET /api/auth/google` — changed

| Aspect | Contract |
|---|---|
| Authorization request | Carries **`prompt=select_account`**, so the identity provider asks which account rather than returning the one it already holds (FR-011) |
| Everything else | Unchanged: the same scopes (`openid email`), PKCE and `state`, the same callback, the same identity matching |

## The volunteer menu — new

The menu (`aria-label="Main"`) renders from the root layout on every page, and only when someone is
signed in.

| Element | Contract |
|---|---|
| Whose session | The signed-in volunteer's display name, beside the control: **"Signed in as {name}"** (FR-005) |
| Control | A button labelled **Sign out**, the last item in the menu, after the destinations (FR-001, and the mis-tap edge case) |
| Submission | A form posting to `/api/auth/signout` — a real submission, so it works with no JavaScript and fires the page's unsaved-work warning (research R5) |
| Touch target | At least **2.75rem** high, matching the project's phone minimum (FR-007) |
| Anonymous | The whole menu is absent, so there is no control and no name (FR-004) |
| Authorization | None. The menu shows the control to every signed-in volunteer: ending your own session needs no capability |
| The site menu | Unchanged. It still makes no authorization decision and renders identically signed in or out (FR-010) |

## What a test may rely on

- The presenter renders a `navigation` landmark named **Main** containing a **Sign out** button whose form
  has `method="post"` and `action="/api/auth/signout"`, plus the text **Signed in as {name}**.
- The loader passes the signed-in volunteer's display name to the presenter, and still renders nothing
  for an anonymous visitor.
- A request carrying a valid session cookie to the route leaves that session unusable: the next
  authenticated request with the same cookie is refused **401**.
