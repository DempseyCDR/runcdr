# Phase 0 research: the gate report answers with what it shows

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-22

Answered by reading the code on `main` at `e097209` and by querying the development database where the
answer depended on what is actually recorded.

## R1 — What do the retiring fields prove, and where does each proof go?

**Decision**: every one of the sixteen cases is rewritten against a surviving part. The map below is the
feature's real specification — a pruning feature is only as good as this table.

| Test case | What it really proves | The live assertion that proves it now |
|---|---|---|
| `treasurer.report` — assembles all sections, named-customer split, gift-card liability | a named sale is credited to its buyer; a gift card sold is income | `treasurer.report` → "assembles the receipts, the named split and the gift-card sale" — `receipts.lines` for `gift_card` and the membership line carrying `name: "Member Buyer"` |
| — venue rent as a bill to the landlord, with no check line | rent is owed to the landlord and is NOT paid through the FS | `treasurer.report` → "shows the venue rent as owed to the landlord, with no check line" — `expenses.rent` `{vendor, 250, unpaid: true}`, `expenses.totals.total === 0` |
| — community dance, no venue: $0 rent line, no landlord | a venueless event still reports, rent 0, landlord unnamed | `treasurer.report` → "community-dance event with no venue: $0 rent line, no landlord" — `expenses.rent` `(no landlord set)`, amount 0 |
| — surfaces comp and gift-card counts | the door's free admissions reach the Treasurer | `treasurer.report` → "…counts in the attendance" — `attendance` `{comps: 3, giftCards: 2}` |
| — shows zero counts, not hidden | a zero is reported, not omitted | `treasurer.report` → "shows zero comp / gift-card-redemption counts (not hidden)" — `attendance` `{comps: 0, giftCards: 0}` |
| — computes deposit and shows POS verification | the deposit and the card takings are reported | `treasurer.report` → "computes deposit and shows POS verification" — `deposits[0]` `{kind: "main", amount: 185, makeUp}` and `card.gross` |
| — derives admission from gross cash / PC gross minus non-admission lines | **the central money rule of the whole app** | `treasurer.report` → "derives admission…" — `receipts.admission` `{cash: 215, card: 140}`, with every anonymous and named line beside it |
| — 404s when the event has no door record | an evening with no record is refused, not invented | unchanged — `treasurer.report` → "404s when the event has no door record" |
| — carries the attendance breakdown, identical to the door's | one computation feeds door, gate and report | unchanged — `treasurer.report` → "carries the attendance breakdown, identical to the door's" |
| `treasurer.fees` — door fee shown while revenue stays gross | the card fee is reported and NOT netted off takings | `treasurer.fees` → "shows the door fee with the card while revenue stays gross" — `card.fee` 3.19 beside `receipts.totals.card` 100 |
| `treasurer.paymentLines` — per-line breakdown; voided checks listed separately | a check's allocation is visible; a void is marked and excluded | `treasurer.paymentLines` → "emits a per-line breakdown…" — `expenses.payments[1].voided`, its `notes`, and `expenses.totals` `{check: 100}` not 200 |
| — every check by number, cash apart, where each booking was paid | check-number order, cash distinguished, cross-event bookings named | `treasurer.paymentLines` → "lists every check by number…" — `checkNumber` order `[1499, 1500, 1500A, 1501, null]`, `cash: true`, `paidTonightForEarlier` / `paidElsewhere` |
| `treasurer.paymentsCutover` — a backfilled payment reproduces the pre-cutover shape | history recorded before feature 019 still reports | `treasurer.paymentsCutover` → "a backfill-equivalent payment…" — `expenses.payments[0]` with role, amount, checkNumber |
| — a booked-but-unpaid performer shows as a reconciliation gap | **someone was booked and never paid** | `treasurer.paymentsCutover` → "a booked-but-unpaid performer…" — `expenses.reconciliation` `{booked: 125, paid: 0, outstanding: 125}`, plus the component case "shows the booked-versus-paid reconciliation…" (FR-008) |
| `treasurer.same-evening` — two gate receipts, both Contra Gate | two events on one date each report separately | `treasurer.same-evening` → "reports two evenings on one date separately, each with its own receipts" — each report's `receipts.lines` carries only its own sale |
| `treasurer.performer-payments` — the check number recorded on the payment | the number Mike types into QuickBooks is reported | `treasurer.performer-payments` → "shows the check number recorded on the performer payment" — `expenses.payments[0].checkNumber` |

**Closed 2026-09-22 (T023).** Every case has a named live assertion; none was dropped. Two extra rules
that lived only inside a departing field also found homes: a check's lines are counted **once** under
their writer (`treasurer.gateReport` → "counts each of a check's lines exactly once, under its writer")
and admission paid by check stays out of the derived figures (→ "counts admission paid by check…").
One assertion was retired rather than rehomed: `fees.onlineFee === 0`, which only ever asserted a dormant
field — feature 007 was deferred, so there is no online fee to prove.

**Two need thought rather than translation.** "Two gate receipts, both Contra Gate" was asserting the
QuickBooks customer as much as the separation; the surviving rule is that two events on one evening report
independently, and that is what the rewrite asserts. "Assembles all sections with mapping" loses its
mapping half entirely — the rest becomes an assertion that the receipts carry the named split.

**Alternatives considered**: deleting the tests with the fields — rejected, and it is the specific failure
this feature is most at risk of. Keeping the fields "because tests use them" — that is the circularity
being removed: a field justified only by its own test.

## R2 — Is the reconciliation expensive to keep?

**Decision**: keep the computation untouched, add a line to the page.

**Rationale**: `performerReconciliation` is already computed from `settledCentsByBookingForEvent` and the
event's bookings, and `treasurer.paymentsCutover` already tests the gap it reports. FR-008 is therefore a
page change plus *not* deleting one field — no new arithmetic, no new query. It earns its place because
the per-payment notes answer "was this payment short?" while the reconciliation answers "did we pay
everyone?", which is a different question and the one a Treasurer asks last.

**Alternatives considered**: recomputing it in the page from `expenses.payments` — rejected: the bookings
that were never paid at all have no payment line to compute from, which is exactly the case that matters.

## R3 — What does the QuickBooks mapping actually hold? *(FR-010)*

**Decision**: read out before dropping. These are the values, recorded here so nothing is lost silently:

| Series | Gate customer | QuickBooks class |
|---|---|---|
| `tnc` | Contra Gate | Contra |
| `ecd` | English Gate | English |
| `community_dance` | Contra Gate | Community Dance |
| `general` | Contra Gate | Community Dance |

`mapping_audit` holds two rows recording when `ecd` and `tnc` were last edited (2026-09-21, actor
`admin`). They are the change history of a table that will not exist; they go with it.

**Rationale**: FR-010 asks that nothing the mapping alone knew is lost. Four rows and two audit entries is
the whole of it, and it is now written where the next person will look — the feature's own record.

**Alternatives considered**: exporting the rows to a file in the repository — rejected: four rows belong in
prose, not in a data file nobody will maintain.

## R4 — How is a dead mapping table dropped here?

**Decision**: one migration, `DROP TABLE IF EXISTS`, following migration `0032` exactly.

**Rationale**: `0032_drop_account_mapping.sql` did this for this table's sibling, and its comment says why:
the catalog "had no consumer (no computed figure, no export…)". It also records that `series_qbo_map` was
*unaffected* because "the report keeps its class/customer columns". That sentence is what this feature
falsifies, so the new migration is its sequel and should say so.

**Alternatives considered**: leaving the table and deleting only the page — rejected: an unreachable table
that something still seeds is worse than either keeping it or removing it.

## R5 — Is anything outside the app reading this report?

**Decision**: no. `assembleTreasurerReport` is called by one route, which is fetched by one page. No
export, no integration, no second caller — checked across `src/`. The removed parts exist in version
control if they are ever wanted again.

## Open question deferred, not resolved

**The seed stops seeding the mapping**, which changes what a fresh database contains. That is correct and
intended, but it means a developer who re-seeds will not see a QuickBooks class anywhere — as designed,
and worth saying out loud in the migration's comment so it does not read as an omission.
