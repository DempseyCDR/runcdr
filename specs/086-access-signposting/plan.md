# Implementation Plan: Everyone can reach their own work

**Branch**: `086-access-signposting` | **Date**: 2026-09-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/086-access-signposting/spec.md`

## Summary

Five obstructions. The Booker gains `contact.write` so the flow 084 built for them stops refusing
them; the gate report gains a read capability of its own, so it reaches the Financial Secretary and
is refused to the Door Attendant; the shared evening list starts narrowed to the series a volunteer
actually works; a link that named a contact and went nowhere opens it, in a new tab, with unsaved
work intact; and the access screen starts naming the series a grant covers, which is what taught the
club a rule the app never had.

The one idea holding it together is the distinction between a **permission** and a **default**. Who
may open the gate report is a permission, and it narrows. Which evenings a page shows first is a
default, and it must never become a permission — a Financial Secretary covering for the other has to
widen the filter and carry on. Two earlier drafts of this plan collapsed those ideas into one and
produced, respectively, a gate report the Door Attendant could read, and a fill-in the app would
refuse.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19, Next.js 16 App Router

**Primary Dependencies**: none new

**Storage**: PostgreSQL 16 via Drizzle. **No schema change and no migration** — grants already carry
a series, and nothing here stores anything new

**Testing**: Vitest — integration against real Postgres, component tests in jsdom

**Target Platform**: volunteers on laptops; the access screen is officers-only

**Project Type**: web application (one Next.js app; `src/app` + `src/server`)

**Performance Goals**: none. One extra series lookup on a screen two people use

**Constraints**: **SC-005 is the safety property** — apart from the two deliberate changes (the
Booker's `contact.write`, and `treasurer_report.read` replacing `base` on the report), every role's
capabilities must be provably unchanged. And FR-014: the evening-list default must never become a
permission. A feature that hands out permissions is the wrong place to be casual

**Scale/Scope**: one new capability held by six roles; one capability added to another; one route
requirement; one shared selector gaining a default (three pages, one component); one self-check
endpoint widened; one nav entry; one page-mount behaviour; one link attribute; one label function;
one service read widened. Small changes; the tests are the bulk of the work

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this feature satisfies it |
|---|---|
| **I. Test-First** | Every one is red-first: a Booker refused a contact creation, a mount with a contact in the address, an FS whose menu lacks the report, a Door Attendant *answered* by a report that should refuse them, a selector that starts unnarrowed for a series-scoped volunteer, a volunteer whose two series are not both shown. Each fails today for the stated reason. |
| **II. Simplicity / YAGNI** | The smallest change that removes each obstruction. Explicitly NOT building: a create-only contact capability (R5), a read-only contact editor (rejected at clarification), per-page defaults (R8 — the shared selector already owns this), a per-capability notion of "my series" (R9). An intermediate design that ENFORCED the series is deleted, not deferred. |
| **III. Type Safety** | The series a grant covers becomes a typed field on the volunteer read, so a screen cannot print `series-scoped` and call it an answer. |
| **IV. Observability** | Unchanged. Grants already write audit rows; nothing here adds a silent path. |

**Result: PASS.** Re-checked after Phase 1 — still PASS; Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/086-access-signposting/
├── plan.md              # This file
├── research.md          # Phase 0 output — nine findings, three of them load-bearing
├── data-model.md        # Phase 1 output — no schema change; the shapes that move
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── access.md        # Phase 1 output — nav, the volunteer read, the two page contracts
├── checklists/
│   └── requirements.md  # From /speckit-specify — 16/16
└── tasks.md             # /speckit-tasks — NOT created here
```

### Source Code (repository root)

```text
src/
├── server/
│   ├── auth/
│   │   ├── capabilities.ts             # booker += contact.write; + treasurer_report.read
│   │   └── nav.ts                      # /treasurer gated on treasurer_report.read (US2)
│   └── domain/access/grantService.ts   # the volunteer read names each grant's series (US4)
├── app/
│   ├── api/events/[id]/treasurer-report/route.ts    # requires treasurer_report.read (US2)
│   ├── api/me/capabilities/route.ts        # + the series the viewer holds a role for (US3)
│   ├── EventSelector.tsx                   # the series filter's default, opt-in per page (US3)
│   ├── (admin)/contacts/page.tsx               # open the contact named in the address (US3)
│   ├── (admin)/manage/performers/PerformerForm.tsx  # the link opens in a new tab (US3)
│   └── (admin)/access/page.tsx                 # show the series; pick it from a list (US4)

tests/
├── integration/   # capability guards, the nav policy, the volunteer read, multi-series as a RULE
└── component/     # the contacts page opening a named contact; the access screen's grants
```

**Structure Decision**: unchanged. No new module, no new route, no new table.

## Phase 0 — Research

See [research.md](./research.md). Nine questions; the three that changed what gets built:

- **R2 — an existing test asserts a policy this feature must KEEP.** `authz.nav.test.ts` asserts a
  Door Attendant does not see `/treasurer`. An earlier draft would have reversed it; Rich corrected
  that, so the assertion stays untouched and the suite gains the half nobody asserted — that the
  Financial Secretary *is* offered the report, and that a Door Attendant requesting it is refused.
- **R8 — the series default belongs in `EventSelector`**, which already owns "the series +
  date-range filters, and the default" for all four single-event surfaces. One prop covers the gate
  report, gate money and payments; check-in opts out. Because a default enforces nothing, the client
  may compute it safely — the objection that sank the previous design does not arise.
- **R3 — the access screen's real defect is `scopeLabel`,** which returns the literal string
  `"series-scoped"` and never names the series. The free-text key box is the second half. Naming the
  series requires the volunteer read to carry it: today it carries a series **id** and nothing else.

The rest: **R1** the contacts page reads the address itself rather than introducing this app's first
`useSearchParams`; **R4** multi-series is already exercised incidentally, so US4 adds a test that
pins it as a rule; **R5** `contact.write` is directory-wide, following the FS precedent, with delete
still refused; **R6** the new tab is a link attribute, not a router change, which is why unsaved
work survives; **R7** the test harness signs in as a Super-user, so narrowing the report's access
leaves all 48 existing treasurer tests green — checked before planning, not discovered during it;
**R9** the viewer's series come from the existing `/api/me/capabilities` self-check, and a club-wide
grant means no narrowing — so the Financial Secretary on record sees no change until her grant is
scoped, which is correct and easy to mistake for a bug.

## Phase 1 — Design

- [data-model.md](./data-model.md) — no schema change; the two shapes that move (the capability map,
  the volunteer read) and the one that must not.
- [contracts/access.md](./contracts/access.md) — the nav contract, the volunteer read, and the two
  page contracts (a contact named in the address; a link that opens beside its form).
- [quickstart.md](./quickstart.md) — gates, then a manual pass per story, each as the volunteer who
  was obstructed.

## Complexity Tracking

> No constitution violations. Table intentionally empty.
