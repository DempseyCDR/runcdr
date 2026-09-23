# Feature Specification: The gate report answers with what it shows

**Feature Branch**: `085-treasurer-report-pruning`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: "treasurer report field pruning"

Feature 082 rebuilt the gate report around the paper one and left the old answer in place beside it. The
report now carries **two** descriptions of the same evening: the ten parts the page shows, and fifteen
older ones — the QuickBooks-shaped summary, the named-customer receipts, the checks received, the bills,
the payment lists, the reconciliation, the fees and the counts — that nothing displays. They survive only
because tests read them. One of the fifteen turns out to be worth keeping: the booked-versus-paid
reconciliation earns a place on the page rather than a deletion (FR-008).

That is not free. Every one of those parts is a claim about the evening that has to stay correct, be
tested, and be understood by the next person reading the code — and a second description of the same
money is exactly how two figures come to disagree.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The report says the evening once (Priority: P1)

The Treasurer's report describes the evening in one way: the way it is shown. Nothing answers with a
second version of the same money.

**Why this priority**: It is the whole feature. Until the unshown parts are gone, every later change to
the report has to keep two accounts of the evening in step, and the constitution's own rule — remove dead
code immediately — is being broken in the most expensive place, the money.

**Independent Test**: fetch a report for an evening; confirm it carries the parts the page shows and
nothing else; open the page and confirm it reads exactly as it did.

**Acceptance Scenarios**:

1. **Given** an evening with sales, checks, payments and a deposit, **When** the report is fetched,
   **Then** it carries the heading, the receipts, the expenses, the card, the deposits, the attendance,
   who recorded it, the evening's note and the bookings paid elsewhere — and no other part.
2. **Given** that same evening, **When** the Treasurer opens the report page, **Then** every figure reads
   exactly as it did before this feature.
3. **Given** the report, **When** anything asks it for a part that is gone, **Then** that is a build-time
   failure rather than a silent `undefined`.

---

### User Story 2 - What the old parts proved is still proved (Priority: P2)

The behaviour those fields were asserting — a voided check is out of the totals, a check that pays an
earlier evening's booking is reported, cash paid out is counted, a rent bill is owed — is still covered,
through the parts that remain.

**Why this priority**: Deleting a field is easy; deleting the only test of a rule is how a regression
ships. This is the difference between pruning and losing.

**Independent Test**: for each retired field, name the test that used to assert it and the assertion that
replaces it; run the suite and see the same rules proved.

**Acceptance Scenarios**:

1. **Given** a voided performer payment, **When** the report is fetched, **Then** it is still listed among
   the expenses, marked voided, with its reason, and still out of the totals.
2. **Given** a check that settles a booking from another evening, **When** the report is fetched, **Then**
   that is still reported.
3. **Given** cash paid out and a rent owed, **When** the report is fetched, **Then** both are still there.
4. **Given** the suite, **When** it runs, **Then** no rule that a retired field proved is left unproved.

---

### User Story 3 - The QuickBooks mapping goes (Priority: P3)

The report no longer carries a QuickBooks class or customer, so the mapping that supplied them — its page,
its menu entry and its stored rows — is retired rather than left editable and read by nobody.

**Why this priority**: it is the loose end this pruning exposes, and one more menu entry gone. It follows
the pruning because the mapping cannot go until nothing asks it for a class.

**Independent Test**: after the change, the page is gone, the menu does not offer it, and nothing in the
code refers to a QuickBooks class or customer.

**Acceptance Scenarios**:

1. **Given** the feature is done, **When** the volunteer menu is opened, **Then** it offers no QuickBooks
   mapping, and the page is gone.
2. **Given** the feature is done, **When** the code is searched for a QuickBooks class or customer,
   **Then** nothing refers to one.
3. **Given** what the club had recorded in the mapping, **When** it is removed, **Then** those values have
   been read out and kept in the feature's record first — a mapping nobody wrote down is a mapping lost.

---

### Edge Cases

- **An evening with nothing on it** — no sales, no payments, no deposit: the report still answers, and the
  page still renders, with the same empty-part wording as today.
- **An old evening** recorded before feature 082: it has no evening note, no cash count and no recorded-by,
  and must still report.
- **A part that is shown but rarely filled** — bookings paid at another evening, rent with no landlord:
  kept, because the page shows them.
- **Something outside the app reading the report**: there is nothing today. If that changes, the removed
  parts are in version control, not in the payload.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The report MUST carry only the parts the page shows: the heading, the receipts, the expenses,
  the card, the deposits, the attendance, who recorded it, the evening's note, and the bookings paid at
  another evening or paid tonight for an earlier one.
- **FR-002**: Every other part MUST be removed — the QuickBooks-shaped gate-sales summary, the
  named-customer receipts, the separate checks-received list, the bills, the two performer-payment lists,
  the separate checks and cash-payment lists, the other-cash-paid-out figure, the single deposit figure,
  the fees, and the comp and gift-card counts. *(The reconciliation is the one exception — FR-008 keeps
  it and gives it a place on the page.)*
- **FR-003**: No figure the page shows may change. The same evening MUST read exactly as it read before.
- **FR-004**: Asking for a removed part MUST fail when the code is built, not silently answer nothing.
- **FR-005**: Every rule a removed part was the only proof of MUST keep a test — rewritten to assert
  through a part that remains, never deleted with the field.
- **FR-006**: Any query, join or helper that existed ONLY to fill a removed part MUST go with it, so the
  report does no work whose result nobody sees.
- **FR-007**: The report MUST keep answering for an evening recorded before feature 082, and for an evening
  with nothing on it.
- **FR-008**: The event-level booked-versus-paid reconciliation MUST be **kept and shown** on the report,
  under the expenses: what the evening's bookings came to, what was actually paid, and what is
  outstanding. It answers "did we pay everyone?" in one line, which the per-payment notes do not.
- **FR-009**: The QuickBooks class and customer mapping MUST be **retired** with the fields that fed it —
  its page, its menu entry, its stored rows and the service behind it. Nothing in the app will read a
  class or a customer once FR-002 is done.
- **FR-010**: Retiring the mapping MUST NOT remove anything else the same machinery holds. What the club
  has recorded there is to be read out before it goes, so nothing it alone knew is lost silently.

### Key Entities

- **The gate report**: what the Treasurer reads for one evening. After this feature it has one shape, and
  that shape is what the page shows.
- **The QuickBooks mapping**: a class and a customer name per series, entered on its own page. Retired by
  this feature (FR-009), its recorded values read out first (FR-010).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The report answers with **ten parts or fewer**, down from twenty-five, and every one of them
  appears on the page.
- **SC-002**: **No figure changes.** For an unchanged evening, every number on the page is identical before
  and after.
- **SC-003**: The suite still proves every rule the retired fields proved — **no test is deleted without a
  named replacement assertion**.
- **SC-004**: A maintainer reading the report's shape can see the page in it — each part maps to something
  the Treasurer looks at, with nothing left to wonder about.
- **SC-005**: The volunteer menu offers **one destination fewer**, and nothing in the app mentions a
  QuickBooks class or customer.

## Assumptions

- **Nothing outside the app reads this report.** It is fetched by one page. There is no export, no
  integration and no other caller — checked before writing this.
- **The page is not changed.** This feature removes what the page never asked for; the layout, the figures
  and the print behaviour are feature 082's and stay as they are.
- **The tests move rather than vanish.** Six or so files assert through the old fields; each assertion is
  rewritten against the part that carries the same fact now. Where a rule genuinely has no home in the new
  shape, that is a finding to raise, not a licence to drop the test.
- **QuickBooks entry is manual and stays manual.** Mike reads the report and types into QuickBooks; nothing
  in the app posts to it, and after this feature nothing in the app records how a series maps to a class
  (decided 2026-09-22). The class and customer names live at the QuickBooks end.
- **The reconciliation gains a home on the page (decided 2026-09-22)**, which is a small addition to
  feature 082's layout — the one place this feature adds rather than removes.
