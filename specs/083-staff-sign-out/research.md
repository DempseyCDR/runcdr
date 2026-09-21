# Phase 0 research: a sign-out control for staff

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-21

Every question below was answered by reading the code on `main` at `22c0819`, not by assumption.

## R1 — Where does the volunteer menu actually render?

**Decision**: put the control in the **volunteer menu** (`Nav.tsx` → `VolunteerNav.tsx`), which the root
layout renders on **every** page — public pages included — and which renders nothing at all for an
anonymous visitor.

**Rationale**: `src/app/layout.tsx` renders `<PublicNav/>` then `<Nav/>` for every route. `Nav` is a
server component that calls `getActor()` and **returns `null` when nobody is signed in**. So FR-001 ("on
every page where they can be working") and FR-004 ("not offered when nobody is signed in") are both
satisfied by where the menu already lives, with no new state and no authorization decision moved to the
client.

**Corrects the spec**: the placement assumption said a volunteer on a public page would have to "walk back
to a staff page to sign out". That is wrong — the volunteer menu is on the public pages too whenever
someone is signed in. The spec's Assumptions and FR-010 are corrected; the decision itself (leave the site
menu alone) is unchanged and now costs nothing.

**Alternatives considered**: the site menu (`PublicNav`) — rejected, and by the answer to Q1: it is
documented twice over as presentation that makes no authorization decision and renders the same entries
signed in or out. A new standalone header control — rejected as a third navigation landmark for one
button.

## R2 — What does signing out have to do so that Back cannot open a staff page?

**Decision**: rely on the existing server guards, and prove the behaviour in the browser rather than in a
unit test.

**Rationale**: both staff route groups guard themselves in their layout — `src/app/(admin)/layout.tsx` and
`src/app/(door)/layout.tsx` each `await requireStaff()`, which redirects to `/login` when the session is
gone. Staff pages are dynamic (the production build lists them `ƒ`), so a Back navigation re-runs the
guard. What no test can settle is whether the browser paints a **restored** view from its back/forward
cache before any request is made; that is a browser behaviour, so SC-002 is a quickstart step on a real
phone and a real laptop, not an assertion in the suite.

**Alternatives considered**: adding no-store headers or a client-side cache purge — rejected as
speculative until the quickstart shows a problem (YAGNI). If it does show one, that is a follow-up with
evidence behind it.

## R3 — Is a sign-out audited, as FR-009 requires?

**Decision**: nothing to build.

**Rationale**: `destroySession` (`src/server/auth/session.ts`) already writes
`writeAudit({ kind: "auth.signout", … })` when it deletes a row. Sign-in writes its entries the same way,
at the same level (`writeAudit`, structured log, not the durable `audit_events` table that `recordAudit`
writes). FR-009 asks for parity with sign-in, and parity is what exists. The risk flagged when the spec
was written — "this could turn into a small server change" — is retired.

**Alternatives considered**: promoting sign-out to a durable `audit_events` row — rejected: it would put
sign-out *above* sign-in, which is not what the requirement asks, and the two belong at one level.

## R4 — Where does the signed-in name come from?

**Decision**: pass `actor.staff.displayName` from `Nav` into the presenter as a prop.

**Rationale**: `CurrentStaff` carries `displayName` already (`session.ts`), and `Nav` holds the `Actor`. A
prop keeps the presenter free of data loading and of any authorization decision, exactly as `items`
already works. The alternative — fetching `/api/me/capabilities` from the client — adds a request per page
and would need a new field there, for something the server already has in hand.

**Alternatives considered**: showing the email instead — rejected; the rest of the app shows people by
display name, and the door phone is handed to someone who knows the person, not the account.

## R5 — How is the control submitted?

**Decision**: a plain `<form action="/api/auth/signout" method="post">` with a submit button, inside the
presenter.

**Rationale**: the route is **POST only**, deliberately — feature 015's comment says a GET sign-out is
CSRF-triggerable and could be fired by a prefetch or an `<img>`. A real form submission is the thing that
makes FR-006 true, and it needs no JavaScript, matching the navigation around it (the public menu keeps
its list in the DOM so a `<noscript>` reader can still navigate). The route answers `303` to `/`, which
browsers follow as a GET, so the volunteer lands on the public home page (FR-003) with the cookie cleared.

Two consequences worth stating: the submission is a **full page navigation**, so the gate page's
unsaved-work warning fires normally (an edge case in the spec); and the form must not be nested inside
another form — it is not, because the nav renders in the root layout, outside every page's content.

**Alternatives considered**: a `fetch` + `router.push` — rejected: more code, breaks without JavaScript,
and gains nothing. A Next server action — rejected: the route already exists and is tested-by-design as a
POST endpoint; a second way in would be duplicate machinery (YAGNI).

## R6 — What do the existing tests require of this change?

**Decision**: the name is a **required** prop, and the three component tests that render the presenter are
updated with it.

**Rationale**: `tests/component/volunteerNav.test.tsx`, `nav.stack.test.tsx` and `nav.render.test.tsx`
(which stubs the presenter and asserts what `Nav` passes) all construct `<VolunteerNav items={…}/>`. A
required prop makes the compiler point at every caller — preferable to an optional one that silently
renders no name. `nav.render.test.tsx` already inspects the props `Nav` hands over, so it is the natural
home for "the loader passes the signed-in name".

**Alternatives considered**: an optional prop defaulting to no name — rejected: it would let a future page
render the menu with a sign-out control and no indication of whose session it ends.

## R7 — Why did signing out not let Rich sign in as someone else? *(added 2026-09-21, from the walk)*

**Decision**: add `prompt=select_account` to the authorization request in
`beginAuthorization` (`src/server/auth/google.ts`).

**Rationale**: the walk-through found the hole this feature was raised to fill. Sign-out ends the CLUB's
session — the `staff_sessions` row and our cookie — and touches nothing at Google. Google still holds its
own session, and our authorization URL carried no `prompt`, so it silently returned the same account:
signed out, signed back in, same volunteer, no chooser. That defeats US2 (the door hand-over — the next
volunteer would be signed in as the last one) and US3 (checking a page as another role), which is the
occasion B53 was raised for. `prompt=select_account` is the standard OIDC parameter for "ask, do not
assume"; Google then shows its chooser, including **Use another account**.

**Cost, accepted by Rich 2026-09-21**: a volunteer with one Google account taps once more at each
sign-in. Sessions last hours, so sign-ins are infrequent, and the door hand-over is correct by default.

**Alternatives considered**: a second "Sign in as someone else" link carrying the parameter, leaving the
main button silent — rejected: two controls, and at a shared door phone the wrong one is the more
prominent. `prompt=consent` — rejected: it re-asks for consent, not identity, and shows a scarier screen
for no gain. Signing the person out of Google as well — not ours to do, and hostile on a personal phone.

**Testing**: `tests/unit/auth.googleAuthorization.test.ts` builds the URL locally (arctic composes it
with no network call) and asserts the parameter, the scopes and that PKCE and `state` are untouched.
Nothing contacts Google, so the constitution's third-party boundary (v1.2.0) is unmoved.

## Open question deferred, not resolved

**The volunteer menu has no stylesheet.** `VolunteerNav.tsx` styles itself with inline `style` objects
while the rest of the app uses CSS modules. This feature follows the file it is editing (inline styles,
with an explicit `minHeight` for the 2.75rem touch target of FR-007) rather than converting the component
— that conversion is a tidy-up with its own risk, unrelated to B53. Worth a backlog row if the menu is
next touched.
