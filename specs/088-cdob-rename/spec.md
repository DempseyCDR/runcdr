# Feature Specification: The community dance series key becomes `cdob`

**Feature Branch**: `088-cdob-rename`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "cdob rename" — decided in the mobile-conventions review
(`specs/phase-8-requirements/mobile-volunteer-conventions.md`, Q11, 2026-09-28): "Change the
community dance key to `cdob`, which stands for 'Community Dance / Open Band'."

Each of the club's series has a short key the system uses to tell them apart: `tnc`, `ecd`,
`general`, and today `community_dance`. The key is not a name people read — the series' name is
"Community Dance" — but it is what the system matches on wherever the community dance is treated
differently: the open band at the door, the organizer report that counts it with Thursday Night
Contra, the missing sound tech, and the public site's colour, photo and landing page. It also
appears in a few addresses, such as the organizer report's.

The club wants the key to say what the series is: **`cdob`, Community Dance / Open Band**. This
feature renames it, and nothing else. It is deliberately small and done on its own, ahead of the
mobile work, because it reaches into check-in and the public site and needs a change to the club's
stored data.

The one thing to hold on to: **a rename that changes behaviour is a bug.** Every rule that applies
to the community dance today must apply to it tomorrow, every dance and booking must still belong
to it, and the public site must look exactly as it does now.

## Clarifications

### Session 2026-09-28

- Q: Does the series' name change with its key? → A: No — only the key changes; the series is still
  named "Community Dance" everywhere.
- Q: An old public link carrying the key now shows an empty list — acceptable? → A: Moot. The app
  has not been deployed, so no link carrying the old key exists outside the development database;
  there is nothing to redirect and no live content to check.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The community dance is known as `cdob` (Priority: P1)

Wherever the system identifies the community dance series by its key — in its own rules, in the
club's data, and in addresses such as the organizer report's — it uses `cdob`. The old key no
longer identifies any series.

**Why this priority**: it is the change the club asked for; everything else in this feature exists
to make it safe.

**Independent Test**: look the series up by `cdob` and find the community dance; look it up by
`community_dance` and find nothing; open the organizer report at its `cdob` address.

**Acceptance Scenarios**:

1. **Given** the club's data after the change, **When** the series are listed, **Then** the
   community dance's key is `cdob`, its name is still "Community Dance", and no series has the key
   `community_dance`.
2. **Given** a volunteer, **When** they open the organizer report for the community dance, **Then**
   its address carries `cdob`.
3. **Given** a fresh installation set up from scratch, **When** its series are created, **Then** the
   community dance is created with the key `cdob`.

---

### User Story 2 - Everything that was true of the community dance stays true (Priority: P1)

The rules that single out the community dance keep working under the new key, and none of its
records move or change.

**Why this priority**: the rename is only safe if nothing behaves differently. Each of these rules
matches on the key, so each is a place a rename can silently switch a rule off.

**Independent Test**: before and after the change, compare the community dance's dances, bookings,
attendance and door records, and exercise each rule below; every result is identical.

**Acceptance Scenarios**:

1. **Given** a community dance, **When** the door checks someone in as an open-band musician,
   **Then** it is accepted, as today; **Given** a dance of any other series, **Then** it is refused,
   as today.
2. **Given** the organizer report for Thursday Night Contra, **When** it is produced, **Then** it
   counts the community dance alongside it, as today, with the same figures as before the change.
3. **Given** a community dance, **When** the Booker looks at it, **Then** no sound-tech slot is
   wanted, as today.
4. **Given** the community dance's dances, bookings, attendance, door records, payments and
   parameters, **When** compared before and after the change, **Then** every one is still attached
   to the community dance and unchanged.

---

### User Story 3 - The public site looks exactly as it did (Priority: P2)

A visitor sees no difference: community dances keep their colour, their photo, their landing page
and their code on the printable calendar, and the series is still called "Community Dance".

**Why this priority**: the public site is not being redesigned now (Rich, 2026-09-24: leave the
public pages alone until they are reviewed). A missed mapping would not fail loudly — the photo
would quietly give way to a plain coloured header — so it must be checked deliberately.

**Independent Test**: view a community dance's public event page, the What's On list, the landing
page and the printable calendar before and after the change; they are identical.

**Acceptance Scenarios**:

1. **Given** a community dance's public event page, **When** it is viewed after the change, **Then**
   it shows the same photo and colour as before.
2. **Given** the What's On list and the printable calendar, **When** viewed after the change,
   **Then** community dances carry the same colour and the same "CD" code as before.
3. **Given** the dances landing page, **When** viewed after the change, **Then** the community dance
   section is unchanged.

### Edge Cases

- **An old link.** An address still carrying `community_dance` is not redirected (decided
  2026-09-28). It behaves as a link to any series that does not exist: the organizer report answers
  "not found", and the public What's On list shows an empty list. This is moot in practice — the app
  has not been deployed, so no such link has been printed, posted or bookmarked.
- **The club's own content.** No content page, announcement or campaign in the development data
  links to an address carrying the old key (checked 2026-09-28), and there is no live data.
- **The photo file.** The community dance's photo is chosen by a lookup from key to file. The file
  is renamed from `community_dance.jpg` to `cdob.jpg` with the key *(decided 2026-09-28)*, so that
  nothing outside the migrations still carries the old key; the picture itself is the same, and
  visitors never see a photo's file name.
- **The other series.** `tnc`, `ecd` and `general` do not change.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The community dance series' key MUST be `cdob`. After the change, no series MUST be
  identified by `community_dance`.
- **FR-002**: The change MUST apply to the development database — the data the club will go live
  with — and to any new installation alike.
- **FR-003**: Every rule that singles out the community dance MUST continue to apply to it, and only
  to it: the open-band check-in, its inclusion in Thursday Night Contra's organizer report, and the
  public site's colour, photo, landing page and printable-calendar code.
- **FR-004**: The community dance's sound-tech setting MUST be unchanged — it wants no sound tech.
- **FR-005**: None of the community dance's dances, bookings, attendance, door records, payments or
  series parameters MUST be moved, lost or altered by the change.
- **FR-006**: The series' name MUST stay "Community Dance", and nothing a visitor sees on the public
  site MUST change.
- **FR-007**: Addresses that carry the old key MUST NOT be redirected; they behave as links to an
  unknown series do today.
- **FR-008**: The club's own reference documents that list the series keys MUST give the new key
  and its meaning, "Community Dance / Open Band".
- **FR-009**: The other series' keys MUST NOT change.

### Key Entities

- **Series**: one of the club's running programmes of dances (Thursday Night Contra, Sunday English
  Country Dance, Community Dance, General / Joint Events). It has a **name** people read and a
  short **key** the system matches on. Only the community dance's key changes; its dances and
  everything recorded against them belong to the series itself, not to its key.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the change, looking the series up by `cdob` finds the community dance, and
  looking it up by `community_dance` finds nothing — in the development database and in a fresh
  installation.
- **SC-002**: The community dance's counts — dances, bookings, attendance records, door records,
  payments and parameters — are identical before and after the change: 100% of records accounted
  for, none moved.
- **SC-003**: Thursday Night Contra's organizer report shows the same figures before and after the
  change, for every year it covers.
- **SC-004**: At a community dance an open-band check-in is accepted, and at a dance of any other
  series it is refused — before and after the change alike.
- **SC-005**: A community dance's public event page, the What's On list, the landing page and the
  printable calendar are visually identical before and after the change.
- **SC-006**: Nothing in the running system still matches on `community_dance` to decide how a
  series behaves.

## Assumptions

- **Only the key changes** *(confirmed 2026-09-28)*. The series' name stays "Community Dance"
  everywhere; the public site is not to change until it is reviewed.
- **The printable calendar's short code stays "CD"** — it is what visitors read, and it is not the
  key.
- **The photo's file is renamed to `cdob.jpg`** *(decided 2026-09-28)*; the picture is unchanged.
- **Historical documents are left as written.** Past feature specifications and the backlog record
  what was true when they were written; only living reference documents are updated (FR-008).
- **No redirects** (decided 2026-09-28), and **not yet deployed**: no link carrying the old key
  exists outside the development database, so nothing needs to keep working at the old address.
- **Dependencies**: none on other features. This precedes the mobile work (the volunteer frame, the
  shared building blocks) and is independent of it.
