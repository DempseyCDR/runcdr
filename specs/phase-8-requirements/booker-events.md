# Phase 8 — Booker's Area: Event & Group Fixes (requirements draft)

**Status:** pre-SpecKit requirements draft (developed conversationally; will seed `/speckit-specify`).
**Phase 8 goal:** make it easy for volunteers to maintain data. This doc covers the **Booker**'s
event/group maintenance — starting with fixes for gaps where no control is surfaced today.

Requirement IDs are `BK-Rn`. Anything marked _(open)_ is not yet decided.

---

## 1. Actor & authority

- The **Booker** holds `booker` (`event.write` etc., **per-series scoped**). Treasurer and super_user
  reach it globally. Event-group operations are gated by `event.write` with scope awareness
  (`assertScope(actor, "event.write", { seriesId, groupId })`).

## 2. Requirements

- **BK-R1 — Add an existing event to an event group (and remove it).** Surface a control to assign an
  already-created event to an event group, and to remove it from its group. **Verified gap:** today
  `group_id` is settable **only at event creation** (`createEvent` / `generateRecurringEvents`);
  `updateEventDetails` patches label/time/description/date/status/price but **not** `group_id`, and there
  is no `addEventToGroup` service — so an existing event can never be moved into or out of a group.
  - **Why it matters now:** this is exactly how an incomplete pairing gets fixed — e.g. **"Sept 2026 2nd
    Thursday"** currently holds only its community_dance event; the Booker would use this control to add
    the existing **tnc** contra event to that group (which MEG-R7's open-band comp then depends on).
  - **Capability:** `event.write`. _Scope note:_ event groups are **orthogonal to series** (a group may
    span series), and a group grant can confer authority over the events in it. So adding event E (series
    S) to group G should require the actor's `event.write` to reach **E's series** (and the group), and
    the change can widen who else can touch E via the group — worth an explicit scope rule.
  - _Open:_ where the control lives (event detail page? the group's page?), and whether a group has any
    membership rules (e.g. one community_dance + one contra for a 2nd-Thursday group, or free-form).

## 3. Open considerations

- **BK-C1 — Group completeness / validation.** Should the Booker's group view **flag an incomplete pairing**
  (a community_dance group with no contra), so gaps like "Sept 2026 2nd Thursday" are caught? _(No longer
  required by MEG-R7, whose paired-contra rule was dropped on 2026-09-14; still useful on its own.)_
- **BK-C2 — A performer booked twice for one event (raised 2026-09-14, feature 079).** Nothing prevents it,
  and it is usually a mistake — but not always: a musician is handling sound at a particular future dance.
  The booking workflow should **flag it for the booker to confirm** rather than refuse it. Until then, the
  door's attendance breakdown counts such a performer once and shows a warning (079, FR-033).
- **BK-C3 — Performers with no contact (deferred 2026-09-14 from feature 079).** Ideally every performer
  has a contact. The few that don't are artifacts of standing up the database; a performer with no contact
  can never be recognised as checked in at the door, so is never subtracted from paying.
- **BK-C4 — Mobile layout for the booker's tasks (raised 2026-09-15, feature 079's manual pass).** A refused
  booking — a sound tech on a Community Dance, whose series has no sound-tech slot — showed its message below
  the fold, so the booker did not see that nothing was booked. The booker's screens need the same mobile-first
  pass the door got in 079, with refusals shown where the action was taken.
- **BK-C5 — Warn about unconfirmed bookings where money is handled (raised 2026-09-15, feature 079's manual
  pass).** The caller booked for the test event was still unconfirmed on the night. On or after an event's
  date, a booking that is not `confirmed` (proposed, requested or tentative) should raise a warning to the
  Financial Secretary on `/gate` and `/payments`, and to the Treasurer on `/treasurer`. Confirming bookings on
  time in the booker's workflow is the fix; these warnings are the safety net. To decide when specified: the
  exact statuses and date rule, whether each warning names and links the booking, and whether it touches the
  treasurer report's performer-payment reconciliation or only warns. Door counts are unaffected — a performer
  counts as booked in any status (079, FR-024).
