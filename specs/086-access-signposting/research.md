# Phase 0 research: Everyone can reach their own work

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-23

Answered by reading the code on `main` at `949ffde` and by querying the development database where
the answer depended on what is actually recorded.

## R1 — How should the contacts page learn which contact to open?

**Decision**: read the address in the page's existing mount effect and call the same
`openRecord(id)` the list rows call. Do **not** introduce `useSearchParams`.

**Rationale**: `/contacts` is already `"use client"` and fetches everything itself, and **no page in
this app uses `useSearchParams` today** — this would be the first. That hook obliges a `<Suspense>`
boundary to avoid deopting the route, which is real structure to add for one string. Reading the
address directly keeps the change inside the effect that already runs on mount, and the page has
exactly one way to open a record (`openRecord`), so arriving by link and arriving by click converge
immediately on the same path — which is why the arrival case needs no separate rendering.

**Alternatives considered**: `useSearchParams` with a Suspense boundary — the idiomatic App Router
answer, and the one to adopt when a second page needs a parameter; rejected here as more structure
than the problem earns. A dedicated `/contacts/[id]` route — a much larger change that would fork
the editor, and it would lose the directory around the record.

## R2 — Does any existing test assert the policy this feature must keep? *(load-bearing)*

**Decision**: yes, and it is **right**. `authz.nav.test.ts` asserts that a Door Attendant is not
offered `/treasurer`:

```ts
it("a Door Attendant sees check-in and reports, NOT gate/treasurer/access (US5.1)", ...)
  expect(nav).not.toContain("/treasurer");
```

**Rationale**: an earlier draft of this feature would have reversed that line, because the first
clarification answer was that every signed-in volunteer should be offered the report. Rich corrected
it on 2026-09-23: the Door Attendant should not see the gate report. **The test stays exactly as it
is and must keep passing** — it is now a guard on this feature rather than an obstacle to it.

What the suite gains instead is the other half, which nothing asserts today: that a Financial
Secretary **is** offered the report, and that a Door Attendant requesting it directly is **refused**
rather than merely unlinked.

**The wider finding**: the reversal was only visible because the plan named the test it would have
to change. A feature that quietly edits an authorization assertion to make itself pass is
indistinguishable from a bug. Any test this feature touches in `authz.*` must be justified out loud,
and after the correction, none needs changing at all.

**Alternatives considered**: none — the question is settled.

## R3 — Why did the access screen teach the club the wrong rule? *(load-bearing)*

**Decision**: two causes, and the first is the one nobody suspected.

1. **The screen never names the series.** `scopeLabel` in `src/app/(admin)/access/page.tsx` returns
   the literal strings `"series-scoped"`, `"group-scoped"` or `"club-wide"`. A Booker for TNC and a
   Booker for ECD both render as "booker — series-scoped", which is indistinguishable from a
   duplicate. You cannot see that someone holds two, so of course two looks wrong.
2. **The scope is typed from memory.** The grant form's scope is a free-text `series key` box, so
   adding a second series means knowing that `ecd` is spelled `ecd`.

**Consequence for the design**: naming the series needs data the screen does not have.
`listVolunteers` returns each grant as `{ id, role, seriesId, groupId }` — a **UUID** and nothing
else, so the page could not print a series name even if it wanted to. The volunteer read must carry
the series' key or name per grant. That is the only server-side change in this feature.

**Alternatives considered**: having the page fetch `/api/series` and join the two client-side — it
must fetch the series list anyway for the picker, so this is tempting; rejected because the read
that reports a grant should report what it covers, rather than handing out an id and expecting every
reader to resolve it. The picker's list and a grant's own description are different needs.

## R4 — Do multi-series grants actually work?

**Decision**: yes, demonstrably — and the proof is currently incidental, which is why US4 adds a
deliberate one.

**Rationale**: `assertExclusivity` refuses only a *different* one of president/VP/treasurer (`h.role
!== role`), so any role may repeat at another scope; the unique key is `(contact_id, role,
series_id, group_id)`, so two series are two rows; and `can.ts` matches the target against **each**
grant, so either series resolves. Better than reasoning: `authz.grants.test.ts` already grants
`booker` for `ecd` **and** `tnc` to one subject — inside a clear-and-cascade test, where
multi-series is scenery rather than the subject. The spec said a refusal found here would be a
finding to raise; none was found.

**Alternatives considered**: trusting the read of the code alone — rejected; the live grants table
has nobody holding two series, so only the existing test distinguishes "allowed" from "never tried".

## R5 — What exactly does the Booker gain, and what must not come with it?

**Decision**: `contact.write`, global, exactly as the Financial Secretary holds it.

**Rationale**: `POST /api/contacts` and `PATCH /api/contacts/{id}` both require `contact.write`, and
`LinkQuestion` posts to the first — which is why a flow built for the Booker refuses them. Contacts
are not series-scoped, so "scoped" has no meaning for this capability; the Financial Secretary
already holds it globally for the same reason (B28's accepted tradeoff). Deleting a contact is a
**different** capability, `contact.delete`, so the Booker still cannot destroy one — that is not an
argument, it is the route's own requirement, and FR-002 gets a test rather than a promise.

**Alternatives considered**: a create-only variant — it does not exist, and inventing one for this
is larger than the problem; the club already accepted directory-wide writes for the FS. Granting via
a role_grant to the individual Booker instead of the role — that solves it for one person and leaves
the next Booker refused.

## R6 — How does the contact link avoid costing unsaved work?

**Decision**: the link opens in a new tab. It is an anchor attribute, not a router change.

**Rationale**: the link sits **inside** the performer form, which holds unsaved edits in component
state and sends only changed fields. A same-tab navigation unmounts that form and the edits are gone
with no warning. Opening beside it leaves the form mounted and untouched, which is why nothing needs
to learn about dirty state — no guard, no confirmation, no restoration. It also matches what the
link is for: checking the person behind a performer is a detour, not a destination.

**Alternatives considered**: a dirty-state guard with a confirmation — more machinery, and it still
interrupts; `beforeunload` — fires on tab close too and is widely ignored by users.

## R7 — Does gating the report break the tests that read it?

**Decision**: no, provided `super_user` holds the new capability.

**Rationale**: six integration files and two component files fetch the treasurer report, all through
the shared harness session — and that harness actor holds a **club-wide `super_user` grant**
(`tests/integration/helpers/db.ts`). So tightening the route from `base` to the new read capability
leaves every existing treasurer test passing untouched, as long as `super_user` is among the
holders. It is, for the same reason it holds every other capability.

**The trap avoided**: had the harness actor been a plain volunteer, this feature would have silently
broken 48 passing tests, and the obvious repair — loosening the route — would have undone the
feature. Checked before planning rather than discovered during implementation.

**Alternatives considered**: giving the harness a Treasurer grant instead — unnecessary, and it
would weaken a harness deliberately built as super-user so that feature tests never fight
authorization.

## R8 — Where does the series default live? *(load-bearing)*

**Decision**: in `EventSelector`, the shared component, behind an opt-in prop. One change covers the
gate report, gate money and payments; check-in opts out.

**Rationale**: `src/app/EventSelector.tsx` already describes itself as "the shared event selector
for every single-event surface (check-in, gate, payments, treasurer)", and already "owns the
event/series fetch, the series + date-range filters, and the default". The series default is
precisely the thing it already owns, so this is one component, one new prop, three pages covered and
one page untouched — not three page-level changes that would drift apart.

**What makes this safe, and it is the whole point**: a default is not a permission. An earlier draft
filtered the list as a control and scope-asserted the route, which is what made a fill-in
impossible. Because the narrowing is now only what the list *starts* at, the client may compute it
from the viewer's own grants with no risk: there is no rule to duplicate, because no rule is being
enforced. The objection that killed the previous design — a scope rule implemented twice will
eventually disagree with itself — simply does not arise.

**Alternatives considered**: per-page defaults — three implementations of one idea, and
`EventSelector` exists precisely to prevent that. Filtering server-side — appropriate for a control,
needless for a default, and it would make an ordinary filter change a round trip.

## R8a — Two traps in the selector, both from its existing behaviour

**The order matters.** `EventSelector` defaults the chosen event in an effect guarded by a
`didDefault` ref, and it fires as soon as the events arrive. The viewer's series arrive from a
*different* request. If the event default wins the race it picks from the unnarrowed list and
latches — the ref guard means it never re-defaults — so the volunteer lands on another series'
evening and the filter looks ignored. The event default must therefore wait until the viewer's
series are known (or known to be unavailable). This is the single most likely way to implement
FR-010 and still ship the bug it exists to fix.

**The filter holds one series, not a set.** `seriesId` is a single value: one series, or "" for any.
A volunteer whose roles name two series cannot be expressed, so the honest behaviour is to narrow
only when exactly one series is named and otherwise leave the list alone (FR-010). Making the filter
multi-select would be a larger change across three pages for a case the club may not have — worth
revisiting only if someone actually holds two.

## R9 — What does the client need in order to know the viewer's series?

**Decision**: the series ids named by the viewer's own grants, added to the existing self-check at
`/api/me/capabilities`.

**Rationale**: that endpoint exists for exactly this class of question — its own comment says it is
"enough to decide whether to OFFER a control", with the real decision still server-side. Today it
answers booleans; the default needs a small list of series ids. The rule is the simple one Rich
chose: every series named by any grant the viewer holds, and **no narrowing at all** if any grant is
club-wide (both scope ids null), which is how a club-wide holder keeps today's behaviour.

**The consequence that is data, not code**: this rule is only as good as the grants behind it. On
2026-09-23 Rich scoped them — Peggy Dempsey holds Booker and Financial Secretary for **ecd**,
PeggyTBD holds both for **tnc** — so each Financial Secretary's roles name exactly one series and
each gets her own default. An intermediate snapshot, taken while that edit was in progress, showed
one volunteer holding roles in two different series, which under this rule would have produced no
narrowing at all; that turned out to be a half-finished state rather than the club's shape. Worth
recording because the rule genuinely does degrade that way, and the spec says so (FR-010): roles
naming two series start unnarrowed, deliberately, because the filter holds one series and hiding one
of a volunteer's own would be worse.

**Alternatives considered**: deriving it from the capability each page is for — more precise, but
the default would then vary per page and need a per-capability answer, for a difference the club is
unlikely to notice. Rejected by Rich in favour of one rule.

## Live data, checked rather than assumed

- **One performer is linked to an ARCHIVED contact**; none to a merged one (feature 072 relinks
  performers to the survivor). So US3's archived case is a real row to test against.
- **Live grants**: four, none holding two series. Peggy Dempsey is Financial Secretary
  **club-wide**, so she is refused nothing today — the Treasurer report was simply absent from her
  menu.
