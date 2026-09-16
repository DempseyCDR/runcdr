# Phase 8 — Meg's Area: Door Check-in (requirements draft)

**Status:** pre-SpecKit requirements draft (developed conversationally; will seed `/speckit-specify`).
**Revised 2026-09-14**, after Mel Maintenance closed (features 059–078): the page is rebuilt around a
mobile-first layout (MEG-R8), the match list follows the name rule from feature 076, and what the build
has already delivered is recorded in §4.
**Phase 8 goal:** make it easy for volunteers to maintain data. This doc covers **Meg**, the door
attendant, checking dancers in quickly and correctly at the door.

Requirement IDs are `MEG-Rn`. Anything marked _(open)_ is not yet decided; where a recommendation exists it
is given. Cross-cutting search work lives as **X-R3** in [mel-contact-maintenance.md](mel-contact-maintenance.md).

---

## 1. Actor & authority

- **Meg** holds `door_attendant` (`attendance.write`; `contact.write` to create walk-ins at the door;
  `contact.pii.read` to disambiguate the right "John Smith"). Roles are combinable — she may hold more.
- **Search** is the shared `searchContacts` fixed by X-R3 (feature 061): substring-primary over name ∪
  real first/last ∪ email prefix, with a "did you mean" fallback. Merged and archived contacts are
  excluded. Meg's flows below build on it.

## 2. Requirements

- **MEG-R8 — Mobile-first page layout.** The check-in page is designed for a phone first. From top to
  bottom it shows:
  1. **The event, confirmed** — the active event shown large (date, series, start time), with a **Change**
     control opening the event selector, and a **warning when that event is not today's**, so Meg sees she
     is checking dancers into the right event before she starts.
  2. **A search box**, focused on load (C6).
  3. **The extras row** — one row of per-check-in controls (MEG-R3).
  4. **A Check in anonymously button**, for a dancer who declines to give a name. It uses the extras row
     like any other check-in, so it needs no controls of its own. It **must appear above the fold** on a
     phone, so it sits above the search results, never below a long list.
  5. **An Add contact button**, which opens a **dialog** holding the door create-contact form (MEG-R4),
     and **a Show checked in button**, which opens the roster dialog (MEG-R9).
  6. **Search results**, listed below (MEG-R1, MEG-R2, MEG-R3).

  Replaces the current single long page, where the create-contact form, the anonymous row and the roster
  are all always open beneath the search.

- **MEG-R1 — Match-list display.** Each result shows the contact's name by **the rule set in feature
  076**: the **display name** as the heading, with **first and last name beneath it only when the display
  name is custom**, and no "(custom)" marker. The same rule as Mel's duplicate pairs, so a nickname
  override like "DJ" still shows "David Jones" beneath it, and an automatic name is not repeated. Each
  result also shows enough contact detail to tell two "John Smith"s apart (PII: door_attendant holds
  `contact.pii.read`).
  - **Addresses (resolved 2026-09-14):** show **reachable** addresses only — active or in transition
    — **personal** purpose first. For a contact reached only through a household address (feature
    067), show "reached via <owner>", as Mel's duplicates queue does. Today every address is shown,
    retired ones included.

- **MEG-R2 — Mark already-checked-in contacts in the match list.** Search results include contacts already
  checked in to this event, marked with a **checkmark** in place of the check-in action, so Meg sees at a
  glance that the dancer is already in rather than wondering why they are missing. Checking the same
  contact in twice stays refused. Corrections to someone already in are made from the checked-in list
  (MEG-R8 item 4, C3). _(Changed 2026-09-14: this previously excluded checked-in contacts from the results
  altogether.)_

- **MEG-R3 — Result row and the extras row (resolved 2026-09-14).** A search result is the name
  (MEG-R1) and a **Check in** button, with no line wrap between them — one tap for the common dancer.
  The per-person controls — **children, comp, gift card, and open band** (community dance only) — are
  **not** on each result. They are **one extras row**, placed **between the search box and the search
  results**, that applies to **the next check-in, whichever kind** — a search result, a contact created
  in Add contact (MEG-R4), or Check in anonymously (MEG-R8) — and **resets after every check-in**. No
  toggle on each result.

- **MEG-R9 — The checked-in dialog.** **Show checked in** opens a scrollable dialog listing the event's
  attendees, sorted by **display name (the default)**, **first name** or **last name**. Corrections to an
  attendee (C3) are made from it. **At the top it shows the event's counts** as a horizontal list that
  wraps on a narrow screen, in two groups — **paying** and **children** on the first line; **caller,
  band, door attendant, comps** and **gift cards** on the next. It is the live door tally (C4), so a
  reliever sees the current state (MEG-R6).
  - **The counts mean what the organizer report means (resolved 2026-09-14).** Paying is the report's
    paying dancers: attendance − booked performers checked in − 1 (the door attendant) − comps. **Booked
    performers include the sound tech.** Children pay, so they are inside attendance and inside paying. Comps are
    the manual comps plus open-band musicians. Gift cards are the redemption count. The dialog uses the
    report's own calculation, never a copy of it, so the two cannot disagree (MEG-R10).
  - **Sound tech and instructor (resolved 2026-09-14)** are shown **separately**, after band, and **only
    when one is booked for the event and Meg has actually checked them in.** Not every event has a sound
    tech or an instructor, and an entry reading zero would be noise.
  - **Performers are subtracted only when checked in (resolved 2026-09-14).** Paying subtracts a booked
    performer — caller, band, sound tech, instructor — **only if they were checked in** to the event.
    Today the organizer report subtracts every booked performer, checked in or not, so a performer who
    was never checked in makes paying one too low and the breakdown fails to add up. **This changes the
    organizer report's paying dancers and average ticket, with no start date** — the app has not been
    deployed, so there is no history to protect. The caller and band counts follow the same rule.
  - **Kept through the attendance purge.** Check-ins are deleted after 90 days; the event's counts are
    not. How many of each kind of performer were checked in must be kept with the event like its other
    counts, so an old event's paying figure never changes when its check-ins are purged.
  - **Performers with no contact (deferred 2026-09-14 to the booker's workflow).** A booked performer
    counts as checked in only through their contact, so a performer with no contact is never subtracted.
    Ideally every performer has a contact; the few that don't are artifacts of standing up the database,
    to be resolved when the booker's workflow is updated.

- **MEG-R10 — One attendance breakdown, shown the same way everywhere (resolved 2026-09-14).** The
  event's attendance breakdown — the counts and layout of MEG-R9 — is computed once and shown **at the
  top** of:
  - the **checked-in dialog** at the door (MEG-R9);
  - the **treasurer report** (`/treasurer`), which today shows only comp admissions and gift-card
    redemptions;
  - the **Financial Secretary's gate page** (`/gate`), where comps and gift cards are entered — the FS wants
    to see attendance there too.

  The organizer report keeps its own columns, but its paying-dancer figure comes from the same
  calculation.

- **MEG-R4 — Door create-contact form.** When a walk-in isn't found, Meg opens **Add contact** (a dialog,
  MEG-R8) and creates a contact with: **first name, last name, display name (optional), email, phone.**
  Email/phone may be left blank if the dancer declines. **No pronouns at the door** — see the pronouns rule
  below. Optional display name maps to `display_name_override` (blank = automatic "first last", per M-R6);
  the email's consent defaults to `contact_tracing` (door check-in _is_ contact tracing) and its purpose to
  `personal` — Meg doesn't set those. The new contact is checked in immediately, with the same per-person
  controls as a search result, and flagged for Mel's review (C1).
  - **"Did you mean…?" (resolved 2026-09-14):** as Meg types a name or email in the dialog, show existing
    contacts that match, each with a way to check that contact in instead, before she creates a new
    one. Prevention is the best dedup (C1).

> **Pronouns rule (cross-cutting).** Pronouns are collected when a contact **becomes a member**, not at
> the door — the club makes identifying buttons (with pronouns) as a **member benefit**. So the door
> form omits pronouns; Mel's record view keeps them editable (M-R5); and the **membership flow** should
> prompt for pronouns for the button. _(Membership-flow requirement — capture fully when we reach that
> area; noted here because it's why MEG-R4 has no pronouns field.)_

- **MEG-R5 — Shared-email affordance at the door.** When Meg enters an email already **owned** by another
  contact, offer three resolutions instead of an error: **(a)** it's that person → check them in (dedup);
  **(b)** a different person who **shares** that email → link as message recipient (family shared email,
  per M-R23), then check in; **(c)** different email → correct it. Prevents both false merges and
  duplicate contacts. See M-R26 (sharing is not merging) and M-R25 (a shared reference can never be that
  contact's login).
  - **Now buildable:** the sharing it relies on shipped in feature 067.
  - **Live defect it fixes:** today a colliding email is **silently dropped** — the contact is created
    without it and Meg is told nothing (`recordAttendance` swallows the unique violation).

- **MEG-R6 — Own session; event-persisted shared state.** The door device runs the attendant's **own**
  session (not a shared login). Check-in state — the roster and the live count — is **event-scoped and
  server-persisted**, so when one attendant relieves another (Rich takes over from Meg), signing into the
  check-in page shows the **current list and count** with no handoff step. Relies on the page defaulting to
  the active event (MEG-R8 item 1).

- **MEG-R7 — Open-band musicians (revised 2026-09-14: simplified).** The community-dance series is still
  experimental, so the rule stays simple:
  - **The open-band category stays at the community dance.** Meg marks an open-band musician at check-in
    (built, feature 017), so the club knows how many attended; they are comped there, counted in
    `open_band_count`.
  - **No connection to the contra in the same event group.** The earlier rule — deriving the contra's comps
    from the community dance's open-band count — is **dropped**. It was complex, assumed the musicians
    were checked in at the contra, changed past reports, and depended on every group containing its
    contra.
  - **At the contra, Meg comps them** with the ordinary comp control. If she misses some, that is
    accepted.
  - **A musician booked to lead the open band is a performer, not an open-band musician.** They are counted
    with the booked performers, never as an open-band comp. Already enforced: a booked performer cannot be
    checked in as open band (feature 017, FR-022a).

- **MEG-R11 — Record a named customer sale from the door.** _(Raised 2026-09-15, after 079.)_ A button on
  `/checkin` opens the named-sale dialog shared with Mary's `/gate` — a membership, donation or future-event
  payment tied to a contact. Specified with Mary's work: see **MARY-R8** in
  [mary-fs-payments.md](mary-fs-payments.md), including Meg's authority (she does not hold `gate.write`).

## 3. Open considerations for Meg's check-in duties

- **C1 — Door-created contacts → Mel.** Every door-created contact is flagged `needs_review` — **built**.
  The flag is about **data completeness, not duplicates**; duplicate detection is the separate dedup sweep
  feeding Mel's duplicates queue (069). Prevention at the door: MEG-R5 and MEG-R4's "did you mean…?".
  - **Clearing (resolved 2026-09-14):** feature 069 clears the flag when the record is complete. The
    earlier rule that it clears only once the new address is **uploaded to the provider** was never built,
    and is Mel's workflow, not Meg's — **moved to the backlog as B51**.
- **C2 — Comp / gift-card stay aggregate (resolved, built).** `door_records.comp_count` and
  `gift_card_redemption_count` remain aggregate counters (no per-person attribution). Only
  `children_count` and `is_open_band` are per-check-in. The door attendant writes these counts under her
  attendance authority, not `gate.write`. **Gift-card is an event-level count**; **comp** is bumped per
  guest at check-in but lands on the aggregate `comp_count`; **children** is the only true per-person
  quantity on the row.
- **C3 — Correction affordances (resolved, built).** Un-check-in (`deleteAttendance`, decrements the
  count), fix children and counts (`patchAttendance`), and wrong-event move (`moveAttendance`), with no
  confirm step. **Reached from the checked-in dialog** (MEG-R9).
- **C4 — Live door tally (resolved → MEG-R9).** The counts at the top of the checked-in dialog. Today the
  page shows only the number of roster rows, which leaves out children.
- **C5 — Door-device session (resolved → MEG-R6).** Meg's **own** session; state is event-persisted so
  relief is seamless. _(Long-shift TTL: an 8h idle window on the attendant's own session should cover a
  normal night; a multi-day festival is the edge to keep in mind, but not designed around now.)_
- **C6 — Fast-entry ergonomics.** Focus-to-search on load, **Enter checks in the top result** (unless it
  is already checked in — MEG-R2), large tap targets, minimal taps per person (builds on 017, X-R1 and
  MEG-R3).
- **C7 — Free events, performers, open-band (resolved).** **Guests:** Meg checks the comp box (→
  aggregate `comp_count`). **Open-band:** see MEG-R7 — marked at the community dance, comped by hand at the
  contra. **Free events** (`charges_admission = false`): Meg
  does nothing special — just checks dancers in (no comp/gift-card/open-band).
- **C8 — Connectivity — not a concern** (no flaky-wifi experience). Dropped from scope.

## 4. Status against the build (2026-09-14; updated by feature 079)

| Item | Status |
|---|---|
| X-R3 shared search | **Built** (061); merged and archived contacts excluded (071) |
| MEG-R6 own session, active event | **Built** (015, 017, 028) |
| C1 door-created contacts flagged; `personal` / `contact_tracing` defaults | **Built** |
| C2 aggregate comp / gift-card counts | **Built** |
| C3 corrections | **Built** — moves into the checked-in dialog |
| MEG-R5 prerequisite (shared emails) | **Built** (067) |
| MEG-R8 mobile-first layout | **Built** (079) |
| MEG-R1 name rule and address display | **Built** (079) |
| MEG-R2 checkmark on checked-in results | **Built** (079) |
| MEG-R3 result row; single extras row | **Built** (079) |
| MEG-R9 checked-in dialog with counts | **Built** (079) |
| MEG-R4 form in a dialog; "did you mean…?" | **Built** (079) |
| C1 clear on provider upload | Never built — moved to backlog B51 |
| MEG-R5 email collision | **Built** (079) — no email is dropped |
| MEG-R7 open-band at the community dance | **Built** (017); paired-contra rule dropped |
| MEG-R10 breakdown on `/treasurer` and `/gate` | **Built** (079) |
| C4 live tally | **Built** (079) — the checked-in dialog's breakdown |
| C6 Enter checks in the top result | **Built** (079) |
