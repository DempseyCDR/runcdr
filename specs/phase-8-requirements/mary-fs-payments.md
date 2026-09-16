# Phase 8 — Mary's Area: Performer Payments and the Gate (requirements draft)

**Status:** pre-SpecKit requirements draft (developed conversationally; will seed `/speckit-specify`).
**Started 2026-09-15**, after Meg's door check-in shipped (feature 079).
**Phase 8 goal:** make it easy for volunteers to maintain data. This doc covers **Mary**, the Financial
Secretary, paying performers (`/payments`) and recording the evening's money (`/gate`).

Requirement IDs are `MARY-Rn`. Anything marked _(open)_ is not yet decided; where a recommendation exists it
is given. Earlier thinking on the payment model lives in `runcdr_Phase4_FS_Payments_DRAFT.md` (features 019,
023, 030 and 043 built it).

---

## Delivery plan (decided 2026-09-16)

1. **MARY-R5 first, as a small fix** — the gate cannot save a membership sale. **Delivered by feature 080**
   (`specs/080-fix-gate-membership-level/`).
2. **`/payments`** — MARY-R3, R4, R6, R7, R9, R11–R14, R17 and X-P1.
3. **`/gate` and named sales** — MARY-R8, R15, R16 (and MEG-R11 at the door).

Features 2 and 3 share MARY-R1 (mobile-first), R2 (the event confirmation) and R14 (the summary line).

## 1. Actor & authority

- **Mary** holds `financial_secretary`: `gate.write` (the door record's money), `performer_payment.write`
  (checks and their allocation), `performer.write` and `attendance.write` — all scoped to her series — plus
  `contact.write`, `membership.write` and `contact.pii.read` club-wide. She does **not** hold
  `booking.write` — adding a last-minute performer goes through the payments service's own path
  (feature 030).
- The **Treasurer** holds everything the FS holds, plus the treasurer report.

## 2. Requirements

- **MARY-R1 — Mobile-first, in line with the rest of the site.** `/payments` and `/gate` are rebuilt for a
  phone first, following the door check-in page (feature 079): a compact top region, dialogs for the less
  common tasks, large tap targets, no horizontal scrolling, refusals shown where the action was taken.
  Today both pages are desk layouts with inline styles.

- **MARY-R2 — Choosing the event, the same way as `/checkin`.** Both pages confirm the event at the top —
  shown large with date, series and start time, a **Change** control opening the event selector, and a warning
  when it is not today's (on the device's local date). Reuses feature 079's event confirmation rather than a
  copy. Today both pages show the bare selector.

- **MARY-R3 — Adding a performer: a dialog to find them, pick the role and set the pay.** **Add a performer**
  opens a dialog where Mary:
  1. **searches** for the performer;
  2. **selects the role** they played;
  3. sees the **default rate** for that role at this event, and may **override** it.

  Today the dialog offers a role and a name filter over the whole performer list, and always books at the
  default rate — the pay can only be changed afterwards, and not at all for a role that is free by rule.

- **MARY-R4 — Overriding the pay on any performer in the list, including a free one.** In the list of
  performers to be paid, Mary can override what a performer is paid **even when the booking is free** —
  whether free by role (instructor, open-band musician), because the role's default rate is $0, or because the
  fee was donated. Today a free booking shows "free (no check)" with no way to pay it, and an instructor or
  open-band musician can never be paid, since those roles are forced to $0 when booked.
  - **Instructor and open-band musician become "free unless overridden"** (resolved 2026-09-15).
  - **Notes on an override** (resolved 2026-09-15): an override may carry an **optional note**. The notes box
    **opens only when the amount is overridden**, and a note is **displayed only when one was written** — no
    empty labels or placeholders in the list.

- **MARY-R6 — Substituting a performer: a dialog.** _(Resolved 2026-09-15.)_ **Substitute a performer** opens
  a dialog, like adding one: choose the booking being replaced, find the substitute (creating them if needed,
  X-P1). **The substitute's booked amount copies the replaced performer's booked amount** — the substitute
  steps into the same slot at the same rate. **No override in this dialog**: if the substitute is paid
  differently, Mary overrides it in the list when she pays (C1). Today substitution is a small form with no
  pay control.

- **MARY-R7 — The Treasurer sees when a payment differs from the booking.** _(Resolved 2026-09-15.)_ Whenever
  what was paid differs from what the booking said the performer would be paid, the treasurer report shows
  both amounts and Mary's note, if any. Today the report lists each check's payee, amount, class and number
  only; the booked amount, the difference and the note are not shown (a total expected-versus-actual figure is
  computed but not displayed).

- **MARY-R5 — Gate: a membership sale can be saved.** _(Found 2026-09-15.)_ Saving `/gate` fails with a 422
  whenever a named **membership** line is present: since feature 068 a membership sale must carry the level
  bought (`membershipLevel`), but the page has no level control, never sends one, and does not read a saved
  level back. The page also hides the server's reason ("Gate sales failed"), and because sales are saved before
  the money, the money figures are not saved either. The page must let Mary choose the level, reload it, and show
  any refusal. **Delivered by feature 080:** a level choice on membership sales, reloaded
  and re-sent; a sale without a level is caught before anything is sent; a refusal shows its reason and says
  what was not saved.

- **MARY-R8 — A named customer sale, recorded in one dialog shared by the door and the gate.**
  _(Raised 2026-09-15.)_ A **named** sale — a membership, a donation, or payment for a future event, each tied to
  a contact — is recorded through **one dialog**, opened by a button on **`/checkin`** (Meg) and on **`/gate`**
  (Mary). The dialog finds the contact (reusing the door's search and Add contact, feature 079), and takes the
  category, the membership level for a membership (MARY-R5), the amount and cash or card. Today only `/gate` can
  record a named sale, as a row in its long form, and saving it fails for a membership (MARY-R5).
  - **Q1 — Meg's authority** _(resolved 2026-09-15)_. Meg holds `attendance.write`, not
    `gate.write`; the gate's money is deliberately Mary's (feature 016). Meg may **add** a named
    sale — the fact of what a named customer bought — but not change the evening's money totals or
    anyone else's lines; Mary can correct or remove any line on `/gate`.
  - **Q2 — Which named sales Meg may record** _(resolved 2026-09-15)_. All three — membership,
    donation and future event.
  - **Q3 — Not losing a sale Meg records while `/gate` is open** _(resolved 2026-09-15)_. Saving
    `/gate` today **replaces every sale** on the door record with what the page holds. A sale Meg
    adds after Mary opened the page would be wiped by Mary's next save. Named sales are added,
    corrected and removed **one at a time** (from this dialog and from the named-sale list on
    `/gate`), and the gate's Save covers only the anonymous sales and the money totals.
  - A membership sale creates or renews the membership as soon as it is saved, as `/gate` does today.

- **MARY-R9 — One check per booking; a second check to the same performer needs confirming.**
  _(Raised 2026-09-15.)_
  - **A booking is settled by at most one check.** One check may settle several bookings. A voided check
    settles nothing, so a reissue is allowed. Today nothing prevents two live checks settling the same booking
    (none do in the dev database); the rule is to be enforced by the server, not only the page.
  - **Writing a second check to a performer asks for confirmation.** When Mary records a check to a payee who
    already has a live check at this event — including from the "one check, several performers" dialog — the
    page warns and she must confirm. It is allowed; it is usually a mistake.
  - **Q4 — Where the warning applies** _(resolved 2026-09-15)_. Everywhere a check is recorded (a single row,
    the several-performers dialog, and an edit that changes the payee), counting only live checks at the same
    event.

- **MARY-R10 — Parked online payments move off `/payments`.** _(Resolved 2026-09-15.)_ The section listing
  PayPal membership payments that could not be matched to a contact is removed from `/payments`: it is
  membership money, not performer pay, and belongs to no event. **Its new home is decided later** — backlog
  **B52**. The core responsibility is the **Treasurer's** (Mike), who may delegate it, perhaps to Mel, so it will
  need **its own grant** rather than riding on `membership.write`. Online payments are not live yet (PayPal is
  not configured) and nothing has ever been parked, so nothing is lost meanwhile.

- **MARY-R11 — Voiding a check.** _(Resolved 2026-09-15.)_ A check that was written and then cancelled is
  **voided**, never erased — the Treasurer records the void in QBO.
  - **Confirm, with a reason.** Void opens a confirmation naming the check and asking a short reason (wrong
    amount, lost, substitution…). For a check settling several bookings, it lists them all. Today one tap voids
    it and the reason is always "voided by FS".
  - **Voids stay visible on `/payments`, quietly** — a small line under the booking's row ("Voided #1453 —
    wrong amount"), kept as history after a replacement. Today a voided check vanishes from the page.
  - **A replacement is linked automatically.** A new check for a booking whose check was voided records that it
    replaces it. A voided check settles nothing, so the replacement respects MARY-R9.
  - **A check cannot be voided twice.** Today re-voiding overwrites the date and reason.
  - **`/treasurer` lists every check — live and voided — in one list sorted by check number**, a voided one
    showing its reason and what replaced it. Today voided checks are in the report's data but never displayed.

- **MARY-R12 — Correcting a check entered by mistake, including one that settles several bookings.**
  _(Raised 2026-09-15.)_ Mary may enter a check in the app before writing it. Until it is written she must be
  able to **correct it or delete it** — whether it settles one booking or several. Today she can edit the amount
  and number of a single-booking check, but for a check settling several bookings only its number; she can
  never delete one (a delete exists on the server but no screen uses it); and nothing lets her change which
  bookings a check settles.
  - **Q5 — Delete or void** _(resolved 2026-09-15)_. Both, chosen by what happened. **Delete** — "this check
    was never written" — erases it (audited). **Void** — "the check was written, then cancelled" — keeps it
    (MARY-R11). _(This replaces the earlier recommendation to remove the delete.)_
    - **The two must be told apart before the tap, not only after it.** Each action carries a short
      explanation where Mary can see it — "Void: the check was written. Delete: it was never written." On a
      phone there is no hovering, so this is plain text or a tappable **(i)**, never a hover tooltip.
    - **Delete asks once more, in those words**: "This erases check #1453 as never written. If you wrote it,
      void it instead." — with Delete and Void both offered from the confirmation.
  - **Q6 — After the Treasurer has seen it** _(resolved 2026-09-15)_. Deleting a check at an event whose
    treasurer report has already been generated **warns** Mary that Mike may have entered it, but is not
    refused.
  - Editing covers the check number, the payee, the amount, and **which bookings it settles, with each one's
    amount** — within MARY-R9's one-check-per-booking rule. A voided check cannot be edited (as today).

- **MARY-R13 — A check number is used once.** _(Raised 2026-09-15.)_ Today the same check number is accepted
  on several bookings, each making a separate check — the dev database has check #1500 three times at one
  event — and there was no way to remove the extras. A real check number identifies one check.
  - **Q7 — Scope** _(resolved 2026-09-15)_. Unique across **all** the club's checks, live or voided (one checking
    account; a voided check's number is never reused).
  - **Q8 — Entering a number that already exists** _(resolved 2026-09-15)_. Ask — **"Add this booking to check
    #1500"** (the check then settles both, its amount growing to match) or **"Change the number"**. Never a
    second check with the same number. The server refuses a duplicate either way.
  - Existing duplicates in the data are corrected with MARY-R12's delete once it exists.

- **MARY-R14 — What is left to pay, at a glance.** _(Resolved 2026-09-15.)_ The top of `/payments` — and of
  `/gate`, where Mary works the same evening — carries a compact summary in the style of the door's
  attendance breakdown:
  - **Booked $350 · Paid $250 · Still to pay $100 (2)**, the count being the performers with no live check;
    **All paid** replaces the figure once none are left.
  - **Difference +$20** on a second line, **only when something paid differs from its booking** — the rows
    already carry each override and its note (MARY-R4), and the Treasurer sees the same difference per check
    (MARY-R7).
  - Today the page reads "Expected $350 · Actual $250 · Delta $100": accounting words, no count of who is
    left, and one figure mixing "not paid yet" with "paid a different amount". `/gate` shows nothing.

- **MARY-R15 — Entering the evening's money on a phone.** _(Raised 2026-09-16.)_ Today `/gate` is one long
  desk form: a 3 × 2 table of anonymous sales, the named-sale rows, then gross cash, card gross, card
  transactions, seed float, cash paid out and its reason, comps and gift cards, and a Save. What the entries
  add up to — admission by cash and by card, the card fee, the deposit — is not shown until after saving
  (the deposit only), and admission not at all.
  - **Q9 — Layout** _(resolved 2026-09-16)_. The summary at the top (MARY-R14 plus the money preview below),
    then short sections, in this order: **Door counts** (comps, gift cards, open band) — **above the cash** —
    **Cash** (gross cash with a **Count** button, seed float, cash paid out), **Card** (card gross, card
    transactions), **Other sales** (merchandise, gift cards and misc, each with cash and card, and the
    comment), **Named sales** (the list and its dialog, MARY-R8).
  - **Q10 — See the result while typing** _(resolved 2026-09-16)_. Admission (cash and card), the card fee and
    the deposit update as Mary types, before she saves.
  - **Q11 — Catch the likely mistakes** _(resolved 2026-09-16)_. Warn when admission comes out negative (more
    other-sales cash than was counted), when cash was paid out with no reason, and when there is card gross but
    no card-transaction count (the fee cannot be worked out). **The warnings appear only after Save** — they do
    not block it, and do not nag while Mary is still typing — and she corrects the entries and saves again.
  - **Q12 — Unsaved work** _(resolved 2026-09-16)_. Keep an explicit **Save**, and warn before changing the
    event or leaving the page with unsaved entries — today changing the event silently discards them.
  - **Q13 — The door's counts** _(resolved 2026-09-16)_. Show the comp and gift-card counts Meg recorded next to
    the figure Mary confirms, so a correction is visible; open band stays read-only.
  - Money fields bring up the phone's decimal keypad; counts its number keypad.

- **MARY-R16 — The cash-counting helper: a dialog with its own number keypad.** _(Raised 2026-09-16.)_ **Count**
  opens a dialog listing the denominations, with an **on-screen numeric keypad** for entering how many of each —
  large keys, a delete key, and moving to the next denomination — and a running total. **Use as gross cash**
  fills the gross cash and closes the dialog. Today the helper is a collapsed section of small text boxes: bills
  ($100, $50, $20, $10, $5, $1) by count, coins and checks as dollar totals, a grand total, and "Use as gross
  cash". Nothing it holds is saved (feature 031).
  - **Q14 — Denominations** _(resolved 2026-09-16)_. Keep today's bills; coins as one dollar total, as today;
    add $2 bills only if the club sees them.
  - **Q15 — Checks from dancers** _(resolved 2026-09-16: YAGNI for now)_. Checks stay one dollar total, as
    today, rather than listed one by one. The club's bank (ESL FCU) takes a deposit slip with **only a cash
    total and the checks**, whose amounts Mary copies from the checks themselves, and passes **only the
    deposit total** to QBO — so nothing downstream needs the checks or the bills listed in the app.
  - **Q16 — The float and the deposit** _(resolved 2026-09-16: YAGNI for now)_. The dialog does not show the
    count less the seed float and cash paid out.
  - **Q17 — Keeping the count** _(resolved 2026-09-16)_. It is only a helper. The counts are **kept with the
    gate record while Mary is counting** — closing and reopening the dialog, or reloading the page, does not
    lose them — and are **dropped when the gate is saved**. Nothing about them is kept after that; the saved
    gross cash is the record. (Feature 031 kept nothing at all, so a reload lost a half-finished count.)

- **MARY-R17 — The order of performers on `/payments`.** _(Resolved 2026-09-16.)_ The list runs **caller,
  lead musician, musician, sound tech, then everyone else** (instructor, open-band musician), and by name within
  each role. Today there is no order at all — the list comes back however the database returns it.

## 3. Open considerations

- **C1 — What an override changes** _(resolved 2026-09-15)_. Each booking records what the performer is
  **booked** to be paid; each check records what was **actually** paid, per booking it settles.
  - **An override in the list changes only what is paid**, never what was booked — the booked amount stays as
    the Booker set it, so the Treasurer sees the difference (MARY-R7). A free booking shows a **Pay** action
    that records a check against its $0 booking.
  - **The rate in the Add dialog sets the new booking's booked amount** — the dialog creates the booking, so
    there is no earlier figure to differ from.
  - **The Substitute dialog copies the booked amount from the replaced performer** (MARY-R6).
  - **No override in the Substitute dialog.** It shows the copied amount; a different payment is an override
    in the list, like any other booking, so the Treasurer sees the difference against the slot's rate.
- **C2 — Does an override need a reason?** _(resolved → MARY-R4: optional, shown only when written.)_
- **C3 — Which roles the Add dialog offers** _(resolved 2026-09-15)_. **Every role the event's series allows**:
  instructor and open-band musician are added (now payable, MARY-R4), and sound tech is left out where the
  series has no sound-tech slot (Community Dance) instead of being refused after the fact. The slot stays a
  per-series setting: letting a Community Dance book a sound tech later is one data change plus a sound-tech
  rate for that series, and dropping the setting would save only a handful of lines while losing the guard.
- **C4 — Someone not yet a performer** _(resolved 2026-09-15)_. When the search in the Add or Substitute
  dialog finds no one, **Mary creates the performer there** — she holds `performer.write` for her series. See
  cross-cutting **X-P1**.
- **C5 — A second role for a performer already booked on the event** _(resolved 2026-09-15: YAGNI for the
  FS)_. Mary does not add a second role. Today adding a performer who is already booked quietly returns the
  existing booking; _recommended:_ the search marks them "already booked as …" so nothing looks added that
  was not.
- **C6 — `/payments` is fully reviewed** (2026-09-15): adding → MARY-R3; overrides and notes → MARY-R4;
  substitution → MARY-R6; one check to several performers → MARY-R9; parked online payments → MARY-R10;
  voiding → MARY-R11; corrections → MARY-R12; check numbers → MARY-R13; the summary line → MARY-R14.
  **`/gate` is next** — beyond MARY-R5 (the membership level), MARY-R8 (named sales) and MARY-R14 (the
  summary), its money entry, denomination helper and reconciliation are not yet reviewed.
- **C7 — Unconfirmed bookings** — warn on `/gate`, `/payments` and `/treasurer` when a booking on or after
  the event's date is not confirmed. Recorded as **BK-C5** in `booker-events.md`; may land with this work or
  the booker's.

## 4. Cross-cutting

- **X-P1 — A performer is always linked to a contact.** _(Resolved 2026-09-15.)_ Wherever a performer is
  created — the Booker's screens, and now Mary's Add and Substitute dialogs — it is linked to a contact. If
  there is no contact for the person, the contact is created **first**, then the performer. Mary may do both.
  The performer service already works this way (it creates the contact, then the performer, in one
  transaction, and refuses a performer with no contact); the dialogs must use it rather than a shortcut. The
  performers created before that rule are BK-C3.
