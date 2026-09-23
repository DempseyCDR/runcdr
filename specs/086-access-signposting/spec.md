# Feature Specification: Everyone can reach their own work

**Feature Branch**: `086-access-signposting`

**Created**: 2026-09-23

**Status**: Draft

**Input**: User description: fixes to access and its signposting — the Booker's contact link and
`contact.write`, the gate report's reach, the series a volunteer works in, and multi-series grants

Volunteers cannot reach work that is already theirs. Two of these are regressions from feature 084,
where a flow was built for the Booker that the Booker's own permissions refuse. One is a menu entry
that hides a report from the person whose work it reports — while leaving it open to everyone else.
One is three pages that start on every series rather than the one the volunteer works in. One is a
screen that makes a supported thing look impossible.

None of these is a missing feature. In every case the app already permits the work and then gets in
the way of doing it — a 403 in a flow built for the person refused, a link that goes nowhere, a
report with no door, a list that starts in the wrong place, and a form that answers a question
nobody asked. That is the thread joining them.

The thread has a second strand, learned while specifying it: **a permission and a default are not
the same thing.** Who may open the gate report is a permission and it narrows. Which evenings a page
offers first is a default and must never become a permission, because the club's two Financial
Secretaries cover for each other.

## Clarifications

### Session 2026-09-23

- Q: How far should the access screen go to make a second series obvious? → A: Show each volunteer's
  existing grants with the series each covers, AND replace the free-text series key with a picker of
  real series — both causes of the false belief, not one.
- Q: A performer is linked to an archived contact. What happens when that link is followed? → A: The
  record opens, marked archived. The link REPORTS a contact rather than offering one, and feature
  084's rule is that a report never hides its subject.
- Q: The contact link sits inside the performer form; unsaved edits would be lost. What should it
  do? → A: Open the contact in a new tab, leaving the performer form and its unsaved edits
  untouched.
- Q: Should the Door Attendant be REFUSED the gate report, or merely not shown it? → A: Refused. A
  new read capability gates the report itself, not only the menu — "should not see it" means what it
  says, and the menu has never been a control. This **replaces** the earlier answer that every
  signed-in volunteer should be offered it.
- Q: Who holds that capability? → A: Financial Secretary, Treasurer, President, Vice-President and
  Super-user — and, added at the walk-through on 2026-09-23, the **Booker**, who negotiates
  performer fees and so has business with what an evening took and paid out. The Door Attendant,
  Webmaster, Mailing-list Manager and Secretary do not.
- Q: The club has TWO Financial Secretaries, not one. Should the report be filtered by series? → A:
  Yes, but as a **presentation default, not a permission**. A Financial Secretary occasionally fills
  in for the other, so enforcement would block real work. This **supersedes** an intermediate answer
  that scoped the capability per series and filtered the list as a control.
- Q: What defines "her series" for that default? → A: Any series she holds a role for. A volunteer
  with a club-wide role gets no narrowing — the filter starts where it does today.
- Q: Which pages get the default? → A: The gate report, gate money and payments. **Not** check-in,
  which stays exactly as it is.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The Booker can create the contact a performer needs (Priority: P1)

A performer has no contact behind it. The Booker opens the performer, is asked the question feature
084 introduced — link this performer to someone, create a contact for them, or archive it — chooses
to create the contact, and it is created.

**Why this priority**: it is a hard stop, not an inconvenience. The Booker is offered a choice the
app then refuses to carry out, in a flow built specifically for them. Of the five, this is the only
one where the volunteer cannot finish the job by any route.

**Independent Test**: as a Booker, open an unlinked performer, choose to create the contact, and
confirm the contact exists and the performer is linked to it.

**Acceptance Scenarios**:

1. **Given** a Booker and a performer with no contact, **When** they choose to create the contact,
   **Then** it is created, the performer is linked to it, and nothing is refused.
2. **Given** a Booker, **When** they correct a contact's details, **Then** the correction is
   accepted.
3. **Given** a Booker, **When** they attempt to delete a contact, **Then** that is still refused —
   this grants the ability to write, not to destroy.

---

### User Story 2 - The gate report reaches the people whose work it is (Priority: P2)

The Financial Secretary opens the volunteer menu and the gate report is there. The Door Attendant,
whose work it is not, is neither offered it nor able to reach it.

**Why this priority**: the report is currently readable by **every** signed-in volunteer, which was
never intended, and the one person whose own work it reports cannot find it. Both halves are wrong,
and hiding a link has never been a control.

**Independent Test**: sign in as a Financial Secretary, open the menu, and read a report. Then sign
in as a Door Attendant and confirm the report is both absent from the menu and refused when
requested directly.

**Acceptance Scenarios**:

1. **Given** a Financial Secretary, **When** the volunteer menu is opened, **Then** the gate report
   is offered, and it opens.
2. **Given** a Door Attendant, **When** they request the report directly, **Then** it is **refused**
   — not merely missing from their menu.
3. **Given** a Treasurer, President, Vice-President, Super-user or Booker, **When** they open the
   report, **Then** it opens, for any series. The Booker reads it; only the Treasurer records on it.
4. **Given** a volunteer holding none of those roles, **When** they request the report, **Then** it
   is refused — this narrows who may read it, deliberately.
5. **Given** a Financial Secretary covering for the other, **When** she opens another series'
   evening, **Then** it opens — reading is not confined by series.

---

### User Story 3 - The evening list starts where the volunteer works (Priority: P3)

The Financial Secretary for Thursday Night Contra opens the gate report, the gate money page or
payments, and the evenings she is offered are her own series' — without her setting a filter. When
she fills in for the English Country Dance secretary, she changes the filter and works that series
instead.

**Why this priority**: it is the club's actual daily friction, and it is felt by more than one
person on three pages. It is a convenience rather than a correctness problem, which is why it sits
below the two access defects — but it is what makes the report usable rather than merely reachable.

**Independent Test**: sign in as a volunteer whose roles name one series; open each of the three
pages and confirm the list starts narrowed to that series, and that widening it takes one step and
is never refused.

**Acceptance Scenarios**:

1. **Given** a volunteer holding a role for one series, **When** they open the gate report, gate
   money or payments, **Then** the evenings offered start narrowed to that series.
2. **Given** that same volunteer, **When** they change the series filter to another, **Then** the
   other series' evenings are listed and open normally — **no refusal**, because this is a default
   and not a permission.
3. **Given** a volunteer holding roles for **two** series, **When** they open those pages, **Then**
   the list starts unnarrowed — the filter names one series or none, so narrowing to one of the two
   would hide the other. Both are included, along with the rest.
4. **Given** the list is narrowed, **When** the first evening is chosen automatically, **Then** it
   is chosen from the narrowed list — never an evening the volunteer does not work.
5. **Given** a volunteer holding a club-wide role, **When** they open those pages, **Then** nothing
   is narrowed — the list starts exactly as it does today.
6. **Given** the check-in page, **When** it is opened by anyone, **Then** it behaves exactly as it
   does today — it is deliberately left out.

---

### User Story 4 - A link to a contact opens that contact (Priority: P4)

The Booker is editing a performer, follows the link to the contact behind it, and that contact
opens.

**Why this priority**: there is a way round — search the directory by name — so it costs time rather
than stopping work. It is still a link that does not do what it says.

**Independent Test**: open a performer that has a contact, follow the link, and confirm the named
contact's own record is open.

**Acceptance Scenarios**:

1. **Given** a performer linked to a contact, **When** the link to that contact is followed,
   **Then** that contact's record is open and ready to read or correct.
2. **Given** unsaved changes to the performer, **When** the contact link is followed, **Then** the
   performer form and its unsaved changes are still there afterwards.
3. **Given** a performer linked to an ARCHIVED contact — one exists today — **When** the link is
   followed, **Then** that contact opens, and that it is archived is plain on the record.
4. **Given** a link naming a contact that cannot be found at all, **When** it is followed, **Then**
   the directory says so plainly rather than silently showing the whole list as though nothing was
   asked for.

---

### User Story 5 - The access screen tells the truth about series (Priority: P5)

An officer looks at a volunteer and sees the roles they hold and the series each one covers. Giving
that volunteer a second series is an evident thing to do.

**Why this priority**: nothing is broken — a volunteer can already hold a role for several series,
and the app has always allowed it. The screen simply does not show it, so the club believed
otherwise. It gains weight from US3: the series a volunteer holds now decides what they see first,
so a screen that hides those series hides the cause of what people experience.

**Independent Test**: give one volunteer the same role for two different series; confirm the screen
shows both, and that adding the second did not disturb the first.

**Acceptance Scenarios**:

1. **Given** a volunteer with a role for one series, **When** an officer views them, **Then** the
   role and the series it covers are both named.
2. **Given** that volunteer, **When** the officer gives them the same role for a second series,
   **Then** both are held and both are shown.
3. **Given** a volunteer holding a role club-wide, **When** they are viewed, **Then** it is clear
   the role covers every series, and not confused with a series-scoped one.
4. **Given** an officer granting a role, **When** they choose its scope, **Then** they pick from the
   club's actual series rather than typing a key from memory.

---

### Edge Cases

- **A Financial Secretary filling in for the other**: she changes the series filter and works that
  evening. Nothing refuses her — this is the case that ruled out enforcing scope.
- **A volunteer with no series-scoped role at all** (club-wide, or roles that name no series): the
  lists start unnarrowed, exactly as today.
- **A volunteer whose only role is for a series with no upcoming evenings**: the list starts empty
  rather than wrong; widening the filter is one step.
- **An archived contact behind a performer**: one exists today. The link opens it and shows that it
  is archived — the link reports a contact rather than offering one, so it does not hide it.
- **A merged contact behind a performer**: none exist today (feature 072 relinks performers to the
  survivor on merge). If one is ever found, opening it must not silently present a retired shell as
  though it were the person.
- **Re-pointing a performer at a different contact is NOT in this feature.** Making the archived
  state visible showed that there is no way to mend such a link — feature 084's question is raised
  only when a performer has no contact at all. Filed as **B58**; the machinery to fix it already
  exists.
- **A nonsense contact reference** in a link — a stale bookmark, a typo: the directory says it
  cannot find it and still works normally.
- **The same role held both club-wide and for a series**: redundant, not an error. The screen should
  not imply the narrower one limits the wider, and the club-wide one wins for the default.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Booker MUST be able to create and correct contacts, so the flow that asks them to
  settle an unlinked performer can be completed by the person it was built for.
- **FR-002**: Granting that ability MUST NOT confer anything else — deleting a contact, in
  particular, remains refused to the Booker.
- **FR-003**: Following a link from a performer to its contact MUST open that contact's own record,
  including when that contact is archived, in which case the record MUST show that it is archived.
- **FR-004**: A link naming a contact that cannot be found MUST say so, rather than silently
  presenting the unfiltered directory as though the request had not been made.
- **FR-004a**: Following that link MUST NOT cost the Booker unsaved work — the performer form they
  were filling in MUST still be there, with its changes, when they come back.
- **FR-005**: The Treasurer report MUST be offered in the volunteer menu to the Financial Secretary,
  the Treasurer, the President, the Vice-President, the Super-user and the Booker.
- **FR-006**: Reading the Treasurer report MUST require a capability of its own, held by exactly
  those roles. This **narrows** who may read it: today any signed-in volunteer can, which was never
  intended.
- **FR-006a**: A volunteer without that capability MUST be **refused** the report, not merely left
  without a link to it. Hiding a menu entry is a courtesy and has never been a control.
- **FR-006b**: The report's contents MUST NOT change — this feature decides who may open it, nothing
  about what it says.
- **FR-006c**: The capability MUST NOT be confined by series. A Financial Secretary covering for the
  other MUST be able to read that series' evenings without being refused and without being regranted
  anything.
- **FR-010**: On the gate report, the gate money page and the payments page, the evenings offered
  MUST start narrowed to the viewer's series when their roles name **exactly one**. When their roles
  name several, or any is club-wide, the list MUST start unnarrowed — a filter that names one series
  cannot express two, and hiding one of a volunteer's own series would be worse than narrowing
  nothing.
- **FR-010a**: The evening chosen automatically on opening MUST come from the narrowed list, so a
  volunteer never lands on an evening they do not work.
- **FR-011**: That narrowing MUST be a **default, not a restriction** — changeable in one step, and
  every evening MUST remain openable whatever the filter starts at.
- **FR-012**: A volunteer holding a club-wide role MUST see no narrowing; the list MUST start
  exactly as it does today.
- **FR-013**: The check-in page MUST be left exactly as it is.
- **FR-007**: When a volunteer is viewed, each role they hold MUST be shown together with the series
  it covers, and a club-wide role MUST be distinguishable from a series-scoped one.
- **FR-008**: Giving a volunteer a role for an additional series MUST be possible from that screen
  and MUST leave their existing grants intact.
- **FR-008a**: A grant's scope MUST be chosen from the club's actual series, not typed from memory,
  so that a mistyped key cannot silently produce a grant that matches nothing.
- **FR-009**: No capability beyond those named here may change. What every other role can do MUST be
  the same after this feature as before it — in particular, narrowing who may read the gate report
  MUST NOT narrow anything else.
- **FR-014**: Nothing in the evening-list default may become a permission. Which evenings a
  volunteer may OPEN MUST be decided only by the capability rules, never by what a filter happened
  to show.

### Key Entities

- **A grant**: one role held by one volunteer at one scope — club-wide, or a named series. A
  volunteer may hold several, including the same role for different series. This feature changes how
  grants are shown, not what they are.
- **The volunteer menu**: the list of destinations offered to a signed-in volunteer. A courtesy, not
  a control — hiding a link never refused anyone, and showing one never permits anything.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Booker completes the unlinked-performer question by creating a contact, with **no
  refusal at any step**.
- **SC-002**: A Financial Secretary reaches the Treasurer report **from the menu**, without being
  given a web address.
- **SC-002a**: A Door Attendant is **refused** the Treasurer report when requesting it directly, and
  is not offered it in the menu.
- **SC-002b**: A Financial Secretary covering for the other opens that series' evening **without
  being refused** — the narrowing is a default, never a gate.
- **SC-006**: A volunteer whose roles name one series lands on that series' evenings on all three
  pages **without touching a filter**, and reaches any other series in **one step**.
- **SC-003**: Following a performer's contact link opens that contact — **no search, no scrolling,
  zero further clicks** — and the performer form is **still there, unsaved edits and all**, when the
  Booker returns to it.
- **SC-004**: One volunteer holds the same role for **two series**, and the screen shows both.
- **SC-005**: Apart from the two deliberate changes — the Booker's ability to write contacts, and
  the new capability guarding the gate report — every role's capabilities are **unchanged**, proved
  rather than asserted, including that the Booker still cannot delete a contact.

## Assumptions

- **The menu is a courtesy, not a control** (feature 016, FR-039). That is precisely why this
  feature does not stop at the menu: to keep the Door Attendant out of the gate report, the report
  itself must refuse them.
- **The club's money is not open to every volunteer.** An earlier draft of this spec assumed it was,
  and would have offered the gate report to the Door Attendant. Rich corrected that on 2026-09-23:
  the report belongs to the people who handle the money and the officers who oversee them.
- **There are two Financial Secretaries, and they cover for each other.** An earlier draft assumed
  one; a later one scoped the capability per series and would have blocked a fill-in. Corrected on
  2026-09-23: series belongs in the presentation, not the permission.
- **The default is only as good as the grants behind it.** The Financial Secretary on record today
  holds her role **club-wide**, so she would see no narrowing at all — correctly, by FR-012. Giving
  each Financial Secretary a series-scoped grant is a data change made on the access screen, which
  is the screen US5 repairs. That is why US5 stopped being cosmetic.
- **The Secretary is deliberately excluded.** An officer, but not one of the four named, and not a
  money role. Named here so the omission reads as a decision rather than an oversight — easily
  revisited.
- **The Booker's ability to write contacts is directory-wide**, like the Financial Secretary's.
  There is no create-only variant, and inventing one for this would be a larger change than the
  problem warrants — the same tradeoff the club accepted when the Financial Secretary gained it.
- **Multi-series grants already work.** The model, the uniqueness rule and the permission check all
  allow a volunteer to hold a role for several series; this feature changes only what the screen
  shows. If a refusal is found during implementation, that is a finding to raise, not a rule to
  honour.
- **The archived-contact case is real, not hypothetical.** One performer is linked to an archived
  contact in the club's data today; no performer is linked to a merged one, feature 072 having
  relinked those to the survivor. Checked 2026-09-23 rather than assumed.
- **Two of these are regressions from feature 084.** The refused contact creation and the link that
  goes nowhere were both introduced there; they are corrected here rather than being new work.
