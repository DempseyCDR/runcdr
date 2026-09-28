# runcdr — Roles, Use Cases & Permission Matrix (working draft)

**Status:** Working draft — Phase 3 role/UI design input. **Will change.** Built by walking through
what each role *does* (use cases first), then deriving the security model and UI implications.

**Companions:** [`runcdr_Help_Glossary.md`](runcdr_Help_Glossary.md) (term ↔ file index) ·
[`../specs/BACKLOG.md`](../specs/BACKLOG.md) (deferred features B22–B31 surfaced here) ·
[`../runcdr_Project_Context_v1.5.md`](../runcdr_Project_Context_v1.5.md) (project state) ·
[`../specs/016-role-authorization/spec.md`](../specs/016-role-authorization/spec.md) (the feature
implementing this document).

> **Status:** **Authentication** shipped as feature 015; **authorization SHIPPED as feature 016** (P3-2,
> 2026-07-15). This document is now *enforced behavior*, not a target: role grants carry scope
> (`role_grants`), the capability catalog lives in `src/server/auth/capabilities.ts`, and routes + services
> gate on it. The old `volunteer_role` enum was retired in migration 0021. A few rows describe capabilities
> whose underlying features are built out per package: P3-3 (check-in, feature 017) and **P3-4 (booking &
> event management — booking status, cancel/delete/reschedule, recurrence, venue landlord, advertised price;
> feature 018)** have shipped; membership enrollment arrives with P3-5. All plug into the same framework.
> Note (feature 018): the public site (`/whats-on`) shows **only confirmed bookings** and never performer
> pay; the cross-event bookings report is staff-only (any authenticated volunteer) and shows all statuses.

---

## 1. The role model — "base + grants", officer → delegate

Two structural findings shape everything below:

1. **Organizer is the base, not a peer role.** Every authenticated role *is* an Organizer. Organizer =
   the authenticated base (read oversight reports, browse the schedule); it has **no write power of its
   own**. Every other role is that base **plus** an additive capability grant.
2. **Club-wide officers delegate per-series / operational roles.** The elected officers hold broad
   authority and hand operational grants down to delegates. A delegate is essentially an officer's grant
   assigned to another contact.

```text
Public (unauthenticated)  ── reads public site only
│
├─ Super-user  ⬡  — may write ANYTHING (global; formerly "Administrator", app role, not a bylaws officer)
│
└─ Organizer (authenticated base: reads everything EXCEPT contact PII; no write of its own)
   ├─ Door Attendant           ⬡ club-wide         — check-in + comp/gift capture; reads /gate, writes none of it
   ├─ President                ⬡ club-wide officer  — assigns roles, handles club settings
   │    └─ Booker              ⬤ per-series         — events, bookings, venues, params, public content
   ├─ Treasurer                ⬡ club-wide officer  — finance; ⊇ FS across all series
   │    └─ Financial Secretary ⬤ per-series         — door-record money + performer payments
   ├─ Vice-President (VP)      ⬡ club-wide officer  — publicity; ⊇ President
   │    ├─ Webmaster           ⬡                    — website / public content
   │    └─ Mailing List Manager ⬤ per-series         — mailing list for their series (but may access ALL exports)
   └─ Secretary                ⬡ club-wide officer  — official notices; backup mailing-list exporter
```

The four elected bylaws officers are **President, Vice-President, Secretary, Treasurer**. The
**Super-user** is a technical app role (global write), not an officer.

⚠️ **President, VP, and Treasurer are mutually exclusive** (2026-07-15) — one person may hold at most one
of the three. **Separation of duties**: role-assignment authority must not combine with money authority.
**The Secretary is exempt.** See §4 for the deliberate gap this leaves (the FS).

**Role assignment belongs to the President *and* the VP** (decided 2026-07-15): **VP ⊇ President** — the VP
may do anything the President may do, so both assign roles and both handle club settings. The Super-user
*can* assign too, by virtue of writing anything. The **Treasurer does NOT** assign the FS, and the VP's
authority over the Webmaster / Mailing List Manager comes from being a role-assigner, not from a private
delegation power: the "Delegated by" column in §2 records who **nominates** a delegate in practice, **not**
who holds authority to grant it.

**Scope legend:** ⬡ club-wide · ⬤ per-series · ⬢ **per-event-group**.
Per-series roles are always "of series X" — Booker-of-ecd has no authority over tnc.

> **Per-event (◍) scope was dropped 2026-07-15.** It had exactly one candidate user, the Door Attendant,
> who is now **club-wide** (any attendant may work any door — the club has no flow that staffs a specific
> attendant to a specific event, and "per-event/shift" described the real-world shift, not an enforced
> boundary). Short-term volunteers are **⬢ per-event-group**, not per-event. With no users left, ◍ is
> YAGNI: **three granularities**, not four.

⚠️ **Scope is NOT a hierarchy.** It would be tempting to read club-wide ⊃ series ⊃ event as a tree, but
**event groups deliberately span series**: "Thanksgiving 2026" contains both **tnc** and **ecd** events, and
a double dance pairs a `cdob` event with a `tnc` one. `event_groups` has no `series_id`, and
`events.group_id` is independent of `events.series_id` — the schema already allows this.

So **⬢ group and ⬤ series are orthogonal axes**, and a group-scoped grant can legitimately reach events in a
series the holder has **no series-scoped authority over**. That is intended, not a leak. Any permission
check must therefore evaluate scope as a **set of filters (series OR group OR event)**, never as a single
tree walk.

---

## 2. Roles

| Role | Scope | Elected? | Delegated by | Core responsibility |
|---|---|---|---|---|
| **Public visitor** | — | — | — | Browse the public site (read-only, no login). |
| **Organizer** (base) | ⬡ (unscoped) | — | — | Authenticated base: **reads everything except contact PII** (emails & phone numbers) — schedule, events, bookings, performers, **all money incl. individual pay**. **No write.** All roles below are Organizers. |
| **Door Attendant** | ⬡ club-wide | — | President / VP grants; Booker staffs the door | Check dancers in; take admission; record comp & gift-card **counts**. Sees a matched dancer's PII; **must not write `/gate`** (reading it is the base). |
| **Booker** | ⬤ per series | — | President (per bylaws, standing in for the Board) | Runs a series' program: events, bookings, venues, per-series parameters, public content. A specialized Organizer. |
| **Financial Secretary (FS)** | ⬤ per series | — | Treasurer | Owns the door-record financials (`/gate`): cash, card, deposit, performer payments/checks. May also do Door Attendant tasks. |
| **Treasurer** | ⬡ club-wide | ✔ officer | — | Club finances; treasurer report + QBO. **⊇ FS** (may do anything an FS can, any series); edits membership records; sets any series' parameters; edits venues. |
| **Vice-President (VP)** | ⬡ club-wide | ✔ officer | — | Publicity (per bylaws). Owns the mailing-list application; delegates the website and mailing list. **⊇ President** — may do anything the President may do, incl. assigning roles and club settings. |
| **Webmaster** | ⬡ club-wide | — | VP | Website / public-facing content (co-edits with the Booker). |
| **Mailing List Manager** | ⬤ per series | — | VP | Manages the mailing list for their series on the VP's behalf. **Exception:** may access **all** exports (cross-series), not just their own. |
| **Secretary** | ⬡ club-wide | ✔ officer | — | Sends official notices (sending is external, out of scope). Retains backup access to export mailing lists when the VP is absent. |
| **President** | ⬡ club-wide | ✔ officer | — | Assigns roles (grants the Booker, etc.) and handles club settings — **shared with the VP**. **Reviews and approves the volunteer list at least annually.** |
| **Super-user** | ⬡ club-wide | — (app role) | **CLI only** — never via a screen | **May write anything** — global god-mode. Formerly "Administrator"; the DB enum value is still `administrator` (rename pending a schema change). |
| *Performer / Contact / Member* | — | — | — | A **subject** in the system (booked, on a list, a dues-paying member), not necessarily a user. |

---

## 3. Permission matrix

Drafted as **write-owner by resource** (a full role×resource grid would be mostly empty). All
authenticated roles inherit the Organizer base. ⚠️ = inferred or still open.

> **The grid below is about WRITE. Read is governed by one rule** (decided 2026-07-15):
> **every authenticated volunteer reads everything except contact PII** — email addresses and phone
> numbers. That includes **all money**: gate figures, the treasurer report, and **individual performer
> pay**. See §4 for why.

| # | Resource / capability | Write | Scope | Backlog |
|---|---|---|---|---|
| 1 | Public site — `/whats-on` | — (public reads) | ⬡ | — |
| 2 | Public content — admission price, public description, performer public profiles | **Booker + Webmaster** | ⬤/⬡ | B27 |
| 3 | Events — create / edit / **cancel** / **delete** / **reschedule** | **Booker** | ⬤ | B25 |
| 4 | Recurring event generation | **Booker** | ⬤ | B26 |
| 5 | Venues — create / edit, rents, landlord | **Booker + Treasurer** | ⬤ | B22 |
| 6 | Performers & bands — directory / rosters | **Booker + FS** (+ Treasurer ⬡) | ⬤ | B28 |
| 7 | Bookings — assign + **status lifecycle** (proposed→requested→**tentative**→confirmed/declined; tentative is skippable) | **Booker** | ⬤ | B23 / 020 |
| 8 | Per-booking **pay-rate override** | **Booker** | ⬤ | — |
| 9 | Standard rate / expense **parameters** | **Booker** (own series) **+ Treasurer** (any series) | ⬤/⬡ | — |
| 10 | Cross-event **bookings report** | — (Booker / Org read) | ⬤ | B24 |
| 11 | Check-in / attendance + **comp & gift-card capture** | **Door Attendant + FS + Treasurer** | ⬡/⬤ | B29 |
| 12 | **Gate money / door record** (`/gate`) — **write** | **FS + Treasurer** · ✗ **Door Attendant** | ⬤ | — |
|    | *— reading `/gate` is open to the Organizer base, Door Attendant included (money is not secret; see §4)* | | | |
| 13 | **Performer payments / check numbers** (payee & amount override) | **FS + Treasurer** | ⬤ | B28 |
| 14 | Treasurer report (`/treasurer`) | **Treasurer** | ⬡ | — |
| 15 | QBO mapping + entering check numbers in QBO | **Treasurer** | ⬡ | — |
| 16 | Organizer report (`/organizer`) | — (all authenticated read) | ⬤ | — |
| 17 | Contact **records** — create; edit name / phone | **Door Attendant** (create at check-in) **+ FS + Treasurer** (membership-side edits) | ⬡/⬤ | B34, B31 |
| 17a | Contact **mailing side** — emails, consent topics — **and dedup / merge** | **VP + Mailing List Manager** | ⬡ | — |
| 17b | Contact **PII read** — email addresses & phone numbers | *(implicit on Door Attendant / VP / MLM / Secretary / Booker / Treasurer / FS — never the bare base; see §4)* | ⬡ | — |
| 18 | Membership records | **Treasurer + FS** (door) **+ online self-service** | ⬡ | B30, B31 |
| 19 | Mailing-list exports (`/exports`) | **VP + Mailing List Manager + Secretary** (backup) | ⬡ | — |
|    | *— MLM is per-series (⬤) but reads/exports **all** series' lists (scope exception)* | | | |
| 20 | Role assignment / access control | **President + VP** | ⬡ | — |
| 21 | Club settings | **President + VP** | ⬡ | — |
| 22 | **Annual approval of the volunteer list** | **President** (VP ⊇) | ⬡ | — |

> **Super-user** (§2) may write **any** row above — global god-mode. Not repeated per-row.

---

## 4. Cross-cutting rules (what the grid can't show)

- **Field-level authority within one record.** Rows 2, 12 & 17 split write *inside* a single entity: the
  Webmaster writes an event's public price/description while the Booker writes its date/venue/cancel
  state; the FS writes door-record money while the Door Attendant's check-in only *feeds* the comp/gift
  counts; the VP/MLM write a contact's **emails and consent topics** while the Door Attendant creates the
  contact **record** at check-in and the FS/Treasurer edit its membership side. Permissions are **not
  purely per-page** — and a contact is the clearest case, since one row is written by three different
  roles for three different reasons.
- **Per-series scoping is real.** Every ⬤ cell carries an implicit "of series X" filter. Booker-of-ecd
  and FS-of-tnc are distinct grants.
- **Scope exceptions exist.** A role's scope isn't absolute per capability: the **Mailing List Manager**
  is a *per-series* role but may read/export **all** series' mailing lists. So the model is
  role × capability × scope, where scope can vary per capability — not one scope per role.
- **Short-term volunteers are ⬢ per-event-group** (decided 2026-07-14). The club recruits people for a
  single event group — a double dance, "Thanksgiving 2026" — and they get "a more restricted scope of
  activity". Per-event grants could not express this cleanly, and per-series (⬤) would over-grant *and*
  under-grant at once, since a group spans series. *(Per-event ◍ scope was subsequently **dropped** —
  see §1: with the Door Attendant club-wide, it had no users left.)*
- **Group-scoped grants self-expire in effect.** Groups are named per instance ("Jane Austen Ball 2026",
  "Pride Dance 2026"), so once a group's events are past, a grant scoped to it is inert without anyone
  revoking it — a useful property for exactly the short-term case.
- **…but authentication does not expire with it — and that is fine** (decided 2026-07-14).
  `contacts.is_volunteer` is cleared by the President **only when a volunteer leaves**, so a short-term
  volunteer who helped at one Thanksgiving retains the ability to **sign in indefinitely**, and with it the
  **Organizer base read** (organizer report: attendance, Dance Net, average ticket). **The club accepts
  this**: a volunteer may retain read access to club data indefinitely. So "short-term" bounds a
  volunteer's *authority*, not their *access* — their ⬢ grants go inert while their baseline read persists.
  **Consequence for P3-2: the Organizer base stays UNSCOPED** (club-wide read) — no per-scope filtering of
  oversight reads needs to be built.
- **Delegation chains describe nomination, not authority** (clarified 2026-07-15). President→Booker,
  Treasurer→FS, VP→{Webmaster, Mailing List Manager} records who **nominates** each delegate in practice.
  **Only the President and the VP actually grant roles** (rows 20/22) — the Treasurer does *not* assign the
  FS. Read the chains as org-chart convention; read rows 20/22 as the permission.
- **Superset relationships.** Treasurer ⊇ FS (any series). **VP ⊇ President** (2026-07-15 — the VP may do
  anything the President may do). **Super-user ⊇ everything** (writes any row). These are the only three.
- **President / VP / Treasurer are MUTUALLY EXCLUSIVE** (decided 2026-07-15) — one person may hold at most
  one of the three, enforced as a **hard refusal** on every path (UI *and* CLI). This is **separation of
  duties**: role-assignment authority (rows 20–22) must not combine with money authority (rows 12–15).
  **The Secretary is exempt** and may double up with any of them — so the rule is *not* "one elected office
  per person"; it is specifically about authority and money.
- **A President MAY also be an FS — and that is sound, not a hole** (decided 2026-07-15). Treasurer ⊇ FS,
  so President-as-FS-of-every-series reaches most of the Treasurer's money authority, and the FS is not an
  elected office — so the exclusivity rule above does not touch it. It is nonetheless **permitted**
  (warned at assignment, surfaced on the annual review) because **everything the FS does is reported to the
  Treasurer**, and the exclusivity rule *guarantees the Treasurer is a different person*. The President's
  money work is therefore always overseen by someone else — and under the read rule, by **every** volunteer,
  since gate figures are open to all. ⚠️ **The two rules hold each other up**: drop the exclusivity and the
  Treasurer could be the same person, leaving the FS work unreviewed. Do not weaken one without the other.
- **The club's consistent instinct is visibility over prohibition.** The annual review is advisory; the
  bulk-PII risk is accepted but audited; the FS concentration is flagged, not barred. Only the officer
  triad gets a hard "no". Weigh new rules against that pattern before proposing a block.
- **The confidentiality axis is PII, not money** (decided 2026-07-15) — the inverse of the usual
  assumption, and **deliberate**. Every authenticated volunteer may read **all** the club's money: gate
  cash, the treasurer report, and **individual performer pay**. *The club holds that keeping pay private
  is what enables performers to be exploited* — so pay transparency is a **value**, not an oversight.
  What is actually protected is **contact PII** (email addresses, phone numbers), which the Organizer base
  does **not** read. **Do not "fix" this by hiding money.**
- **PII: one at a time, not in bulk.** The rule is about **bulk enumeration**, not lookup. A Door Attendant
  **matching a dancer** sees that person's PII — they need it to pick the right John Smith. The
  **checked-in roster** (B33) shows **names only**. *Accepted residual risk*: this discourages rather than
  prevents a determined bulk harvest via repeated lookups, and the club judges that mitigation sufficient.
  Every PII-disclosing request is **audited with a count** (decided 2026-07-15), so a harvest is at least
  **detectable after the fact** — auditing per *contact* is not viable, since check-in search fires per
  keystroke over 20 candidates.
- **Dedup review is the sanctioned bulk PII view** (decided 2026-07-15). The **VP and Mailing List
  Manager** see **all** PII on every candidate pair while reviewing dedup suggestions — deciding whether
  two records are the same person *is* comparing emails and phones side by side. An exception to the bulk
  rule, not a violation of it, and it grants them nothing they lack via exports anyway.
- **PII-read rides on the roles that need it** (decided 2026-07-15) — it is **not** separately grantable.
  Door Attendant (on match), VP / MLM / Secretary (exports, dedup), Booker (performer contact), Treasurer /
  FS (membership). Only the **bare Organizer base** is excluded — which is exactly the lapsed short-term
  volunteer the rule is aimed at.
- **Hard boundary (confirmed) — but it is a WRITE boundary.** Door Attendant ✗ **write** `/gate` (row 12):
  the **FS owns gate money**. **Reading** `/gate` is open to the Door Attendant like everyone else, because
  money is not secret (above). ⚠️ *Revised 2026-07-15* — this was previously recorded as a total
  denial of `/gate` access in four places; that was wrong about read.
- **The President reviews and approves the volunteer list at least annually** (row 22). **Advisory, not
  enforcing** (decided 2026-07-15): the approval is recorded and the overdue state is surfaced, but access
  does **not** lapse on its own. Consistent with the accepted "volunteers keep read access indefinitely"
  model — and a forgotten review must never lock the club out.
- **Membership status → mailing lists.** A contact's membership status feeds which lists they qualify
  for, which is why membership (Treasurer/FS) and exports (VP) touch overlapping data from different roles.

---

## 5. Use-case collections

### 5.1 Booker (per series)

1. Create events & event groups for their series.
2. Assign a venue to an event; create/edit venues (Treasurer + Bookers together cover all venue data —
   no separate venue-manager role needed).
3. Assign performers — caller, band, musicians, sound tech — to an event.
4. Override standard **rent** per event (negotiates with the landlord — see B22).
5. Override standard **pay rate** per booking (negotiates fees with performers).
6. Maintain the performer directory & band rosters.
7. Update public performer profiles (co-editor; Webmaster also edits).
8. Move each booking through **proposed → requested → tentative → confirmed / declined** (B23; **tentative**
   = the performer's "maybe", skippable — feature 020). On a decline, either re-point the slot to another
   performer (→ proposed) or park it (→ declined); optionally note why.
9. Review the **cross-event bookings report** — date · **venue short name** · caller · band (stacked
   musicians) · sound tech — filtered by caller / band / musician / series / date-range and **sortable by
   date** (B24 / 020). Each performer shows a status **letter** (P/R/T/C/D); clicking a performer space or an
   empty role slot opens the **booking modal**, and clicking a date opens the **event modal** (feature 020).
   The modal's performer picker is a **typeahead**; an unknown substitute is added by linking a contact.
10. Record internal per-booking notes (`bookings.note`).
11. **Cancel** an event (retained + shown as cancelled on the public site) (B25).
12. **Delete** an event (hard removal — a mistake) (B25).
13. **Reschedule / edit** an event, incl. changing the date, without touching its recurring siblings (B25).
14. Define a **recurring event** (first · increment · last) → bulk-create independent event rows (B26).
15. Set standard rate/expense parameters **for their own series** (Treasurer may set any) (row 9).

### 5.2 Financial Secretary (per series)

1. Record gate **cash** and the **bank deposit** (`grossCashCents`, `depositCents`).
2. Record **count + amount** of credit-card sales (`posTransactionCount`, `pcGrossCents`).
3. Own the door-record financials — the `/gate` page.
4. Confirm the **comp & gift-card counts** with the Door Attendant (counts materialized on the door
   record) (B29).
5. Write performer checks per booked rates; record **check numbers**.
6. **Override payment** — substitute payee (Audrey sits in for Eileen) or redirect/aggregate amounts
   (Ted's share → Cindy: one $250 check) (B28).
6a. **Correct performer directory info** — fix a name or add an unknown substitute (`performer.write`,
   scoped to their series; Treasurer club-wide). All performers are contacts, so a new substitute's contact
   is created here too. Shared with the Booker, not exclusive to them (B28, feature 019).
7. Enroll **door memberships** — enter a contact's name on `/gate` for cash/card/Venmo dues (B31).
8. May also perform Door Attendant tasks (check-in).

### 5.3 Door Attendant (club-wide)

1. Check dancers in — record attendance (`/checkin`).
2. Record a **comp** at check-in (next-dance-free card / performer plus-one) — counts only (B29).
3. Record a **gift-card redemption** at check-in — counts only (B29).
4. Take admission at the door (collect cash for the FS; card via the POS device).
5. Hand off / confirm the comp & gift-card counts with the FS.
6. Review the **roster of attendees already checked in** for the event, **sortable by first name and by
   last name** (B33). Distinct from the directory search used to *find* people to check in. **Names only —
   no PII** (§4): the search shows a matched dancer's email/phone because identifying them requires it; the
   roster is a bulk list and shows none.
7. Add a **new contact** at check-in — enter **first + last name**; the display name is auto-concatenated
   ("first last") and **editable** by the Door Attendant (B34).
8. **Family check-in** (**all series**): one parent contact + a **count of children**; children **count as
   paying** (B35).
9. **Open-band musician check-in** (**community dance series, `cdob`**): note an **unpaid,
   non-leading** open-band musician; they are **comp'd into every event of the event group** and
   **count as attending** (B36).
10. **Boundary:** must not **write** `/gate` — the FS owns gate money. **May read it** (money is open to
    every volunteer; §4). *Revised 2026-07-15 from "no `/gate` access".*

> **Community dance** — its **own series** (key `cdob`, "Community Dance / Open Band"; it was
> `community_dance` until feature 088), a peer of Thursday Night Contra (`tnc`), already seeded as
> such. It is **not** an event type: B37 proposed one and was **retired 2026-07-14**, as it rested
> on a misreading — the codebase was already right.
>
> What makes the series special is a **rule, not a shape**: it runs on a mix of **paid musicians** (booked)
> plus **open-band musicians** (unpaid volunteers), and an open-band musician is **comp'd into all events of
> the event group**, not merely the one they played (B36). **Resolved in feature 017** (not by making the
> counter event-group-aware): the comp is recorded **per event on redemption** — a persisted
> `door_records.open_band_count` sits beside `comp_count` (kept separate so the FS's comp edit never
> clobbers it and so it survives the 90-day attendance purge), and the report subtracts effective comps =
> `comp_count + open_band_count`. Each event still tallies its own comps; there is no cross-event counter or
> per-musician entitlement ledger. An open-band flag is **rejected for a booked performer** for the event
> (they are already counted as a performer).
>
> Family check-in with a children count is **not** specific to this series; it applies to **every** series
> (B35).

### 5.4 Treasurer (club-wide officer)

1. Generate the treasurer report per event (`/treasurer`); manage QBO account/class mapping.
2. Enter performer **check numbers in QBO** to prepare bank-statement reconciliation (reconciliation
   happens in QBO, out of scope).
3. Do **anything an FS can do**, for any series (gate money, payments, check-in).
4. Edit **membership records**.
5. Set **rate/expense parameters** for **any** series; edit **venues**.

### 5.5 Vice-President (publicity officer) & delegates

- **VP:** owns the mailing-list application; may **export the member list** for upload to the mail app;
  owns the **mailing side** of contacts — emails, consent topics, and dedup/merge (rows 17/17a), **not**
  contact records as such. Delegates the website and the mailing list. **⊇ President** (2026-07-15): may
  also assign roles and handle club settings (rows 20/21) — so the VP is a *second* full access-control
  officer, not merely a publicity officer.
- **Webmaster** (VP delegate): website / public content (co-edits row 2 with the Booker).
- **Mailing List Manager** (VP delegate): a **per-series** role managing their series' mailing list,
  but with cross-series access to **all** exports (rows 17/19).

### 5.6 Secretary (club-wide officer)

1. Send official notices (sending is external — iContact/email — out of scope).
2. Usually reuses the list already exported by the VP.
3. Retains **backup access to export mailing lists** for when the VP is absent.

### 5.7 President (club-wide officer)

1. Assign roles & control access (grants the Booker, FS, delegates, etc.) — row 20. **Shared with the VP**
   (VP ⊇ President), so the club always has two people who can fix access.
2. Handle club settings — row 21.
3. **Review and approve the list of volunteers at least once a year** — row 22. **Advisory**: the approval
   and its date are recorded and an overdue list is surfaced, but nobody's access lapses automatically
   (§4). This is the club's periodic prune of the volunteer roll, and the practical counterweight to
   volunteers retaining read access indefinitely.

### 5.8 Super-user (club-wide app role)

1. **May write anything** — global god-mode across every resource. The technical break-glass /
   administration role, distinct from the elected officers. Formerly "Administrator" (DB enum value
   `administrator` still in place until a rename migration).
2. **Granted only from the operator command line** (decided 2026-07-15) — **not** through any screen, not
   even by the President, the VP, or another Super-user. It is not a club office, so it must not sit one
   click away in the assignment screen officers use weekly. *Partial hardening by nature*: the President
   and VP can still grant themselves every other role, whose union approaches global write. The line drawn
   is one of **governance**, not containment.

### 5.9 Membership acquisition (cross-role)

A contact becomes a member by paying dues via one of:

- **(a) Online** — PayPal buy button on the website; required info captured on the site; payment
  confirmed by the existing PayPal→QBO feed (B30).
- **(b) Door, cash** — paid to the Door Attendant; the **FS** enters the contact's name on `/gate` (B31).
- **(c) Door, card/Venmo** — the **FS** enters the contact's name on `/gate` (B31).

The Treasurer may also edit membership records directly. The VP never edits them — only exports the list.

---

## 6. Open questions

### Still open

1. **Other officers / grants** — the four bylaws officers (President, VP, Secretary, Treasurer) and the
   Super-user are now modeled. Any further grants (e.g. a member-at-large, committee chairs) are not yet
   surfaced. *Does not gate P3-2*: the grant model is additive, so a later role is a new row, not a
   reshape.

**That is the only open question.** Everything else in this document is decided — see below.

### Resolved

- **Read authority is one rule: everything except contact PII** *(2026-07-15).* The matrix was a
  **write-owner** grid that never stated read authority — the largest gap in this document. Settled: the
  Organizer base reads all of it, **including all money and individual performer pay**, and is excluded
  only from contact **emails and phone numbers**. Rationale in §4 — pay secrecy is regarded as an
  **enabler of performer exploitation**, so transparency is deliberate.
- **PII is gated against bulk enumeration, not lookup** *(2026-07-15).* Matching a dancer at the door shows
  that dancer's PII; the checked-in roster shows names only. Residual harvest risk **accepted** — and
  **audited per request with a count**, so it is detectable if not preventable.
- **Dedup review is the sanctioned bulk PII view** *(2026-07-15)* — VP + MLM see all PII on every candidate
  pair, because comparing emails and phones *is* the task.
- **PII-read is implicit on the roles that need it** *(2026-07-15)* — not separately grantable. Only the
  bare Organizer base is excluded.
- **Super-user is CLI-only** *(2026-07-15)* — grantable from no screen, by nobody, including another
  Super-user. See §5.8.
- **Clearing a volunteer's designation cascades** *(2026-07-15)* — every grant is **reported first**, then
  revoked and individually audited. Grants never survive dormantly; a returning volunteer is re-granted
  deliberately. Preserves the intent of feature 001's `roles_require_volunteer` constraint.
- **Designation is a nomination, not a gated authority** *(2026-07-15)* — `is_volunteer` grants only the
  Organizer base (read, no PII, no write), so it is deliberately writable by `contact.write` holders (Door
  Attendant/FS/Treasurer) via the contact editor **as well as** by President/VP via `/access`. The
  President/VP path is primary but not exclusive. Designation *proposes* someone for roles; granting the
  roles stays President/VP.
- **Refusals are explicit** *(2026-07-15)* — an unauthorized actor is told what they lack, not shown a 404
  or redirected. Safe because the base reads nearly everything; **contact PII is the one exception**.
- **President / VP / Treasurer are mutually exclusive; Secretary is exempt** *(2026-07-15)* — a hard
  refusal on every path, for separation of duties. **President-as-FS is warned and surfaced, not blocked**,
  and is sound because the FS reports to the Treasurer, whom exclusivity guarantees is someone else. See
  §1/§4.
- **No role uniqueness** *(2026-07-15)* — **two people may hold the same office** (e.g. two Presidents):
  unlikely, but permitted, and **no uniqueness constraint may be added**. Orthogonal to mutual exclusivity:
  that rule bars *one person holding two roles*, and says nothing about a role's holder count. Easy to
  conflate — don't.
- **VP ⊇ President** *(2026-07-15).* The VP may do anything the President may do, so rows 20/21 are
  **President + VP**. The **Treasurer does not assign the FS**: the "Delegated by" column describes
  nomination, not authority.
- **The volunteer list gets an annual Presidential approval** *(2026-07-15; row 22)* — **advisory**:
  recorded and surfaced when overdue, but access never lapses automatically.
- **Per-event (◍) scope dropped** *(2026-07-15).* The Door Attendant — its only candidate user — is
  **club-wide**; short-term volunteers are ⬢. Three granularities remain (⬡/⬤/⬢). See §1.
- **Door Attendant ✗ `/gate` is a WRITE boundary** *(revised 2026-07-15)* — reading gate money is open to
  everyone. Previously recorded as a total access denial in four places.
- **Row 17 — contacts ownership is the mailing side only** *(2026-07-15; rows 17/17a).* The VP and
  Mailing List Manager own **emails, consent topics, exports, and dedup/merge**; they do **not** own
  contact records as such. Contact *records* stay writable where the work actually happens: the **Door
  Attendant** creates them at check-in (already shipped — `POST /api/events/[id]/attendance` accepts a
  `newContact`; B34 extends it to first + last + display name) and the **FS / Treasurer** edit the
  membership side (B31). A literal "VP owns the whole directory" would have needed a carve-out for
  behavior that already exists. Dedup stays with the VP/MLM as **mailing-quality stewardship**.
  ⇒ **P3-2 is no longer gated.**
- **Per-event-group (⬢) is a real, required scope** *(2026-07-14).* Short-term volunteers are scoped to an
  event group; groups deliberately span series ("Thanksgiving 2026" = tnc + ecd), so ⬢ is **orthogonal to
  ⬤**, not nested under it — see §1 and §4. Feature 015 is unaffected: it treats short- and long-term
  volunteers identically (`is_volunteer`) and deliberately does not enforce the Workspace domain, precisely
  so short-term volunteers on personal Google accounts can sign in at all.
- **Administrator → Super-user** (writes anything); **role assignment & settings → President**; venue data
  needs no dedicated role (**Treasurer + Bookers** suffice).

---

## 7. Backlog surfaced while building this document

| ID | Item |
|---|---|
| B22 | Venue landlord contact |
| B23 | Booking status lifecycle (proposed→requested→confirmed/declined) |
| B24 | Booker cross-event bookings report |
| B25 | Event lifecycle: cancel vs. delete, plus reschedule |
| B26 | Recurring event generation |
| B27 | Advertised admission price (Webmaster-owned, public) |
| B28 | Performer payment override — payments distinct from bookings |
| B29 | Comp & gift-card counts captured at check-in (Door Attendant → FS); resolves B21 |
| B30 | Online membership purchase (PayPal buy button) |
| B31 | Door membership enrollment — link gate `membership` payment to a membership record |
| B32 | User authentication / login + session foundation (staff roles) — **prerequisite, spec first** |
| B33 | Door Attendant checked-in roster view — sortable by first / last name |
| B34 | Check-in new-contact capture — first + last name + editable display name |
| B35 | Family check-in — one parent contact + a children count (**all series**) |
| B36 | Open-band musician check-in → comp'd into the whole event group (community_dance series rule) |
| B37 | ~~Community dance event type~~ — **RETIRED**: community_dance is a series, already seeded |

See [`../specs/BACKLOG.md`](../specs/BACKLOG.md) for full write-ups.
