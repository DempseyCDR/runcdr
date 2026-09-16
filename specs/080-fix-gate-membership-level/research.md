# Research: Gate membership-level fix

No `NEEDS CLARIFICATION` remained in the Technical Context. The decisions below come from reading the code
the page talks to.

## R1 — Where the defect is

**Decision**: fix the page only.

**Rationale**: every server piece already does the right thing:

- `gateSalesPutSchema` (`src/server/validation/door.ts`) requires `membershipLevel` on a membership line and
  forbids it on any other. A missing level is a 422 `VALIDATION_ERROR` whose message is "membership lines
  require a membershipLevel".
- `putGateSales` stores it; `enrollDoorMemberships` opens or renews the account at it, in the same
  transaction (covered by `tests/integration/gate.membershipLevel.test.ts`).
- `getDoorRecord` selects every `gate_sales` column, so the reload payload already carries
  `membershipLevel`.

The page (`src/app/(door)/gate/page.tsx`) has no level in its `NamedLine` type, sends none, and ignores the
one it is given on reload.

**Alternatives considered**: defaulting the level on the server when it is missing — rejected; 068 decided
the level is chosen, never inferred, and a silent default would record the wrong level for families.

## R2 — The list of levels on the client

**Decision**: a new `src/app/membershipLevels.ts` exporting
`MEMBERSHIP_LEVELS = ["individual", "family", "supporter", "student"] as const`, checked with
`satisfies readonly MembershipLevel[]` and a compile-time assertion that every `MembershipLevel` appears.
`MembershipAccount.tsx` switches to it.

**Rationale**: client components do not import values from `@/server/db/schema` (none does today — it would
pull Drizzle's `pg-core` into the browser bundle). A type-only import is free. `MembershipAccount.tsx`
already keeps its own copy; a second copy would be the third place to change if a level is added.

**Alternatives considered**: a second local constant in the gate page — rejected as above; a new
`/api/membership-levels` route — rejected as infrastructure for a four-word list.

## R3 — What the page says when a save does not go through

**Decision**: the save has two steps, so it has two failure messages, each naming what was not saved and
carrying the server's reason:

| Outcome | Message |
|---|---|
| Guard: a sent membership line has no level | "Choose a level for {name}'s membership. Nothing was saved." |
| PUT refused (not 403) | "Nothing was saved: {reason}" |
| PUT 403 | today's "Only the Financial Secretary may record gate money for this event." |
| PUT saved, PATCH refused (not 403) | "Sales saved, but the money figures were not: {reason}" |
| PUT saved, PATCH 403 | today's wording (cannot happen in practice — same capability and scope) |
| Request throws (network) | as the refused row for that step, reason "Could not reach the server" |
| Both saved | today's "Saved" or "Saved. Membership recorded: …" |

When the PATCH is refused after memberships were recorded, the message adds "Membership recorded: …" so Mary
knows the renewal happened.

`{reason}` is `body.error.message` — the envelope every route uses (`ApiError`) — falling back to
"the server refused it ({status})".

**Rationale**: FR-006 to FR-008. The PUT is one transaction, so "nothing was saved" is exact when it fails.
Today a thrown fetch leaves an unhandled rejection and an unexplained page — the same silent gap FR-008
forbids.

**Alternatives considered**: mapping server messages to friendlier text — rejected for now; the only
expected refusal (a missing level) is caught by the guard before the server sees it, and the later `/gate`
feature rebuilds the messages with the page.

## R4 — Save order

**Decision**: unchanged — PUT sales, then PATCH money.

**Rationale**: the spec's assumption. Reversing it would save money figures before a sale the server might
refuse, which is no better, and MARY-R8 changes the model anyway (named sales saved one at a time).

## R5 — The guard's scope

**Decision**: check only lines the save would send — a membership line with amount > 0. A membership line
left blank is dropped by the save, as today, so it needs no level.

**Rationale**: matches what the server would refuse. Marking the line with `aria-invalid` lets a test and a
screen reader find it; the message names the payer, since two lines can share a category.

**Alternatives considered**: disabling Save until every level is chosen — rejected; a disabled button does not
say why, and FR-006 asks the page to say which sale.

## R6 — The enrollment's `?? "individual"` fallback

**Decision**: leave it.

**Rationale**: the column is nullable (it is null on non-membership lines), so TypeScript needs a branch, and
the route's schema makes the branch unreachable. Changing it to a throw is a server change with no
behaviour this feature needs; noted for the later `/gate` work.
