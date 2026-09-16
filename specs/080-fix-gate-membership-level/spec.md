# Feature Specification: Gate membership-level fix

**Feature Branch**: `080-fix-gate-membership-level`

**Created**: 2026-09-16

**Status**: Draft

**Input**: User description: "gate membership bug" — **MARY-R5** in
`specs/phase-8-requirements/mary-fs-payments.md`, delivered first and on its own as a small fix before the
larger `/payments` and `/gate` work.

## Context

At the end of an evening, Mary, the Financial Secretary, records the gate's money on the gate page. Some of
it is **named** sales: a membership, a donation, or a payment for a future event, each tied to a person.

Since memberships became accounts with levels (feature 068), a membership sale must say **which level was
bought** — individual, family, supporter or student. The gate page was never updated to match:

1. **It cannot save a membership sale.** The page has no way to choose a level and never sends one, so any
   save that includes a membership sale is refused. Found in feature 079's manual pass.
2. **It does not say why.** The page shows only "Gate sales failed".
3. **Nothing else is saved either.** The sales are saved before the money figures, so when the sales are
   refused, the gross cash, card figures and counts Mary entered are not saved — and she is not told.
4. **A saved level is not shown again.** Reopening an evening does not show the level of a membership sale
   recorded earlier, so the next save would send it without one.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record a membership bought at the gate (Priority: P1)

A dancer renews their family membership at the door. Mary adds a membership sale for them on the gate page,
chooses **family** as the level, enters the amount and whether it was cash or card, and saves the evening's
money. The sale, the money figures and the dancer's renewed membership are all recorded.

**Why this priority**: today no membership bought at the gate can be recorded at all, and the rest of the
evening's money is lost with it.

**Independent Test**: on the gate page, add a membership sale with a level and save; confirm the save
succeeds, the dancer's membership is renewed at that level, and the money figures are saved.

**Acceptance Scenarios**:

1. **Given** a membership sale on the gate page, **When** Mary looks at it, **Then** she can choose its level
   from individual, family, supporter and student.
2. **Given** a membership sale with a level chosen, **When** Mary saves, **Then** the sale is recorded with that
   level, the dancer's membership is created or renewed at that level, and the money figures are saved.
3. **Given** donation and future-event sales, **When** Mary looks at them, **Then** they offer no level.

---

### User Story 2 - A saved membership sale shows its level again (Priority: P1)

Mary saves the evening, then comes back later to correct the card total. The membership sale she recorded
still shows its level, and saving again keeps it.

**Why this priority**: without it, correcting anything else on a saved evening would fail or lose the level.

**Independent Test**: save a membership sale with a level, reopen the evening, confirm the level is shown,
change an unrelated figure, save, and confirm the level is unchanged.

**Acceptance Scenarios**:

1. **Given** an evening with a saved membership sale, **When** Mary reopens it, **Then** the sale shows the level
   it was saved with.
2. **Given** that reopened evening, **When** Mary changes another figure and saves, **Then** the membership sale
   keeps its level.

---

### User Story 3 - Mary is told when a save does not go through (Priority: P2)

If Mary tries to save a membership sale without a level, or the save is refused for any other reason, the page
says what is wrong and **what was and was not saved**, so she can correct it and save again.

**Why this priority**: the missing level is prevented by User Story 1; this covers every other refusal, which
today is reported only as "Gate sales failed" while the money figures silently go unsaved.

**Independent Test**: try to save with a membership sale that has no level, and confirm the page names the
problem, says nothing was saved, and saves once the level is chosen.

**Acceptance Scenarios**:

1. **Given** a membership sale with no level, **When** Mary saves, **Then** the page says the sale needs a level,
   marks which sale, and saves nothing until one is chosen.
2. **Given** a save the server refuses for any reason, **When** the refusal comes back, **Then** the page shows the
   server's reason and says what was not saved — the sales and money both, if the sales were refused; the money
   figures only, if the sales were saved and the money was then refused.
3. **Given** a successful save, **When** it completes, **Then** the page says it was saved, as it does today.

---

### Edge Cases

- **A membership sale saved before this fix without a level**: none can exist — such saves were refused.
- **A dancer who already has a membership** at another level: the level chosen is what they bought tonight;
  how an account's level changes on renewal is unchanged from today.
- **A save with no membership sale**: behaves exactly as today.
- **The Door Attendant** (who cannot save gate money): still refused, with the message the page already shows.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each membership sale on the gate page MUST offer a choice of level: individual, family, supporter
  or student.
- **FR-002**: Donation and future-event sales MUST NOT offer a level.
- **FR-003**: Saving MUST send each membership sale's level, and the sale MUST be recorded with it.
- **FR-004**: The dancer's membership MUST be created or renewed at the level chosen.
- **FR-005**: Reopening an evening MUST show each saved membership sale's level, and saving again MUST keep it.
- **FR-006**: A membership sale with no level MUST NOT be sent. The page MUST say which sale needs a level, and
  nothing MUST be saved until one is chosen.
- **FR-007**: When a save is refused, the page MUST show the reason given.
- **FR-008**: When a save is refused, the page MUST say what was not saved. A save MUST NOT leave the sales
  saved and the money figures unsaved — or neither saved — without saying so.

### Key Entities *(include if feature involves data)*

- **Gate sale**: one sale recorded against an evening's gate — its category, amount, cash or card, and, for a
  named sale, the person. A membership sale also records the level bought.
- **Membership account**: a person's membership, created or renewed by a membership sale at the level bought.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An evening that includes a membership sale can be saved on the first attempt once each
  membership sale has a level.
- **SC-002**: **No refused save goes unexplained**: every refusal shows its reason and says what was not saved.
- **SC-003**: A membership sale's level survives any number of reopen-and-save cycles unchanged.
- **SC-004**: Evenings without a membership sale save exactly as they do today.

## Assumptions

- The levels offered are the four the club already uses for membership accounts.
- No level is chosen for Mary in advance; she picks the one the dancer bought.
- The save stays one action that records the sales and then the money figures, in that order; if the sales
  are refused nothing is recorded, and if the money is refused the sales stay recorded — either way the page
  says so. Changing that order, and the wider rework of the gate page, belong to the later `/gate`
  feature (MARY-R8, MARY-R15).
- The gate page's layout is otherwise unchanged; its mobile-first rebuild is the later feature's.

## Out of Scope

- The named-sale dialog shared with the door (MARY-R8) and saving named sales one at a time.
- The gate page's mobile-first rebuild, live results and warnings (MARY-R15) and the counting dialog (MARY-R16).
- Any change to `/payments`.
