# Implementation Plan: The gate report answers with what it shows

**Branch**: `085-treasurer-report-pruning` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/085-treasurer-report-pruning/spec.md`

## Summary

The gate report answers with twenty-five parts and shows ten. This removes the fourteen nobody displays,
keeps the fifteenth — the booked-versus-paid reconciliation — by giving it a line on the page, and retires
the QuickBooks mapping that fed two of the departing fields.

The risk is not the deletion; it is the sixteen test cases that assert *through* those fields. Each one
proves a rule that still matters — a voided check stays out of the totals, a rent with no landlord still
reports, admission is derived from the takings — and each is rewritten against the part that carries the
same fact now. **No test is deleted without a named replacement**, and no figure on the page moves.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19, Next.js 16 App Router

**Primary Dependencies**: none new; this feature removes rather than adds

**Storage**: PostgreSQL 16 via Drizzle. One migration **drops** `series_qbo_map` (FR-009); no other schema
change

**Testing**: Vitest — integration against real Postgres, component tests in jsdom

**Target Platform**: the Treasurer at a laptop, and in print

**Project Type**: web application (one Next.js app; `src/app` + `src/server`)

**Performance Goals**: fewer queries per report, since the departing parts take their joins with them
(FR-006). Not a target — a consequence

**Constraints**: **SC-002 is the safety property** — no figure the page shows may change. Everything else
is subordinate to it

**Scale/Scope**: one service, one page (one line added), one page deleted, one menu entry, six test files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this feature satisfies it |
|---|---|
| **I. Test-First** | Inverted but intact: before a field goes, its tests are rewritten against the parts that remain and seen to pass — so the rule is proved by the NEW assertion before the old one is removed. The reconciliation line on the page is ordinary red-first work. |
| **II. Simplicity / YAGNI** | This IS the principle — "remove dead code immediately", applied where it costs most. The one addition (the reconciliation line) is justified by Rich's answer: it says "did we pay everyone?" in a line the per-payment notes cannot. |
| **III. Type Safety** | Removing a field from `TreasurerReport` makes every stale reader a compile error (FR-004). That is the mechanism this feature leans on, not a side effect. |
| **IV. Observability** | Unchanged: the report still writes its audit row. Dropping `series_qbo_map` is a migration, recorded as such. |

**Result: PASS.** Re-checked after Phase 1 — still PASS; Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/085-treasurer-report-pruning/
├── plan.md              # This file
├── research.md          # Phase 0 output — including the 16-case coverage map
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── report.md        # Phase 1 output — the report's one shape
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # /speckit-tasks — NOT created here
```

### Source Code (repository root)

```text
src/
├── server/
│   ├── db/
│   │   ├── migrations/0057_drop_qbo_mapping.sql   # NEW — drops series_qbo_map
│   │   └── schema/qboMapping.ts                   # DELETED
│   ├── domain/treasurer/
│   │   ├── reportService.ts                       # the pruning; + reconciliation kept
│   │   └── mappingService.ts                      # DELETED
│   └── validation/treasurer.ts                    # mapping schema removed
├── app/
│   ├── (admin)/treasurer/page.tsx                 # + the reconciliation line
│   ├── (admin)/qbo-mapping/                       # DELETED
│   ├── api/qbo-mapping/                           # DELETED
│   └── ../server/auth/nav.ts                      # menu entry removed
└── db/seed.ts                                     # stops seeding the mapping

tests/
├── integration/   # six treasurer files rewritten; a migration test for the drop
└── component/     # the report page gains the reconciliation assertion
```

**Structure Decision**: unchanged app structure. `assembleTreasurerReport` keeps its shape as a single
function returning one typed object; the object simply stops carrying what nobody reads.

## Phase 0 — Research

See [research.md](./research.md). Five questions; the load-bearing findings:

- **R1** All sixteen test cases have a home in the surviving shape — the map is in research.md, case by
  case. Two need thought rather than translation: "two gate receipts, both Contra Gate" (its subject was
  the QuickBooks customer, which is going) and "assembles all sections with mapping".
- **R2** The reconciliation is already computed and already tested (`treasurer.paymentsCutover`), so
  FR-008 is a page change plus keeping one field — not new arithmetic.
- **R3** The mapping's live values are **four rows**, read out and recorded in research.md, satisfying
  FR-010 before anything is dropped.
- **R4** `series_qbo_map` has a precedent for its own removal: migration `0032` dropped this table's
  sibling, and says why. The same shape of migration applies.
- **R5** Nothing outside the app reads the report; the only caller is `/treasurer`.

## Phase 1 — Design

- [data-model.md](./data-model.md) — the report's shape before and after, the dropped table, and what
  each removed part was answering.
- [contracts/report.md](./contracts/report.md) — the one shape the report now has, and the page's one
  addition.
- [quickstart.md](./quickstart.md) — gates, then the manual pass whose whole job is SC-002: the same
  evening, read twice, unchanged.

## Complexity Tracking

> No constitution violations. Table intentionally empty.
