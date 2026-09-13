# Mel contact maintenance — what is left

Close-out companion to [mel-contact-maintenance.md](./mel-contact-maintenance.md). **Every requirement
M-R1–M-R27 in that document is implemented** as of feature 070:

| Requirements | Feature |
|---|---|
| M-R1, M-R2 — capability catalog | 059 |
| M-R3, M-R4 — maintenance search + two-section results | 062 |
| M-R5–M-R8 — record mode, name control, governance fields | 063 |
| M-R9–M-R12 — archive, safe delete, unrestricted delete | 065 |
| M-R13–M-R17 — per-contact email editor | 066 |
| M-R23–M-R27 — shared / family emails (pointer model) | 067 |
| — membership accounts (households, levels, derived status) | 068 |
| M-R18–M-R22 — triage worklists, rejections, held merges | 069 |
| — drop the retired `memberships` / `payers` tables | 070 |

Two of §7's four open items were resolved along the way: `contact.email.delete` **folded into**
`contact.delete.unrestricted` (feature 066), and primary-email designation (**B3**) was always out of
scope. What follows is everything still outstanding.

---

## 1. A merge does not relink `staff_identities` or `role_grants` — CLOSED (071, 072)

This was §7's M-R21 open item. Feature 069 shipped the *choice* of surviving sign-in and the held-merge
machinery around it, but `mergeService` touched neither table. Both halves have since shipped.

### 1a. A merged or archived volunteer keeps their access — **FIXED in 071**

`readSession` checked `is_volunteer` but never `merged_into_id` or `archived_at`, so a retired contact
with a live session kept working and their Google sign-in still resolved. Latent when found — no merged
or archived contact held an identity — but **3 merged contacts still carried `is_volunteer = true`**, so
the one check that existed had already stopped catching them.

Feature 071 rejects both at session read, the same way withdrawn volunteer access is rejected. The stale
`is_volunteer` flags on already-merged contacts are a separate data cleanup.

### 1b. The relinking itself — **CLOSED by feature 072**

Shipped in feature 072. The collisions were real and were specified rather than guessed:

- **`staff_identities` is UNIQUE on `contact_id`.** Merging two staff contacts cannot simply move the
  identity — this is a third structural collision, the same shape as the two feature 069 already holds
  for (`two_logins`, `two_accounts`). It plausibly wants a third `held_merge_reason`.
- **`role_grants_unique` is `(contact_id, role, series_id, group_id)` with `NULLS NOT DISTINCT`.** Both
  contacts holding the same role at the same scope collide on relink.

## 2. There is no unmerge — CLOSED by feature 074 (2026-09-12)

`merge_audit.relinked_counts` recorded **counts, not identifiers**, so the table said a merge happened
but not what moved, and the re-pointed emails and memberships could not be told apart from the
survivor's own. Recovery from a mistaken merge was a database restore.

A merge now also writes a **`reversal_manifest`**: every re-linked row's primary key, the full prior
content of every row it destroys, the prior value of every field it overwrites, and the identity of
every row it creates. `POST /api/dedup/merges/{id}/undo` replays it, and the contact record shows the
merges that produced it with an honest verdict on each.

Feature 074 also found and recorded **five** destructive paths where this section named two. The fifth
had no statement of its own anywhere in the merge: `membership_members.account_id` is
`ON DELETE CASCADE`, so deleting the unchosen account silently destroyed every household row on it —
including the ones `ON CONFLICT DO NOTHING` never copied because that person was already on the
surviving account.

**Two limits, both deliberate, both permanent:**

- Merges recorded **before** 074 have no manifest and can never be undone. There is no backfill; the
  information was never written down. They are reconstructed by hand, accepting some loss of history,
  and the UI says so rather than offering an action that would fail.
- A merge is reversible only while its survivor is still live and neither contact has been archived, so
  **chains unwind most-recent-first or not at all**. There is no time limit — age is shown as
  information, never enforced as a cut-off.

See [specs/074-undo-merge/](../074-undo-merge/).

## 2a. A merge can silently revoke a volunteer's access (FOUND 2026-09-12, NOT FIXED)

Found walking feature 074's §4 manual pass: `dempsey.peggy@gmail.com` (mailing list manager) merged into
`peggy@cdrochester.org`. The merge completed. Afterwards **neither address could sign in**, with no
message explaining why.

**Cause.** `contacts.is_volunteer` is an attribute of the PERSON, but it is not a foreign key, so it sits
entirely outside the `CONTACT_REFERENCES` classification and no merge has ever considered it. Merging a
volunteer into a non-volunteer therefore moves the role grants and the sign-in binding onto a contact
that is not a volunteer, and `resolveSignIn` requires `is_volunteer`. Both addresses then fail, because
the merged contact's email moved to the survivor and now resolves there too.

**It produces a state the system otherwise forbids.** `grantService` refuses to grant a role to a
non-volunteer (`grantRequiresVolunteer`, `grantService.ts:84`), but the merge relinks grants in raw SQL
and bypasses it — **the same class of bug as feature 072's `EXCLUSIVE_ROLES` finding**: a service-layer
invariant with no constraint behind it, walked past by a SQL relink. 072 caught exclusivity and missed
this one.

**Recovery is not automatic.** The known-`google_sub` branch of `resolveSignIn` wins before enrolment is
reached, so the person cannot simply sign in again — while the binding points at a non-volunteer, the
attempt is refused. Undoing the merge fixes it, but the undo's sign-in portion needs `role.assign`.

**The fix — undecided, for feature 078.** The obvious answer is to have a merge carry `is_volunteer`, so
the survivor becomes a volunteer if either side was. It is **not** recommended: once the survivor is a
volunteer, whoever controls the survivor's OWN email address could enrol and sign in, so a mistaken merge
would grant access to the wrong person on the mailing-list manager's authority alone.

**Recommended instead:** HOLD a merge that would newly make the survivor a volunteer, for a `role.assign`
holder to decide — the same "would the survivor GAIN something" rule feature 072 applies to role grants.
Resolving in favour carries the flag together with its approval date and approver. Because this is the
third service-layer invariant a merge has walked past, 078 should also audit `grantService` for any
others rather than fixing only this one.

## 2b. Retired contacts still appear on the access page — CLOSED by feature 076

`listVolunteers` (`grantService.ts:275`) selects `contacts.is_volunteer = true` with **no merged or
archived filter**, so a contact that has been merged away is still listed as a volunteer — showing with
no roles, because its grants moved to the survivor. Same family as the `matchPerformers` and
`resolveSignIn` enrolment holes feature 072 closed; this one was missed because it is a read path.

Small and self-contained: add the active-contact predicate. **Done in 076** — `listVolunteers` now
requires `merged_into_id IS NULL AND archived_at IS NULL`, the same predicate 071 added at session
read and 072 added at sign-in enrolment.

## 2c. A contact that has been in a merge can never be deleted — CLOSED by feature 077

### The finding

Every delete first asks `contactDeleteBlockers` whether anything substantive still refers to the contact.
That check does **not** include merge history. But `merge_audit.canonical_id` and `merged_id` both
reference `contacts(id)` with no delete rule — since feature 003 — so the database refuses to delete
either contact a merge names, and a contact whose data has all moved away passes the check as "bare"
and then fails with a **raw Postgres foreign-key error** instead of Mel's refusal message. Confirmed by
running it against the test database, not inferred:

| Case | Blocker check | Delete |
|---|---|---|
| A. The merged-away contact | bare | raw FK error on `merge_audit_merged_id` |
| B. Both contacts **after an undo** | both bare | raw FK error, for each |
| C. Unrestricted delete, after an undo, of a contact that pays for a membership | bypassed | **membership account deleted, then the delete failed — the contact remains** |

Case A is mostly unreachable in the UI, because merged contacts are left out of search. **Case B is the
reachable one, and feature 074 made it so**: an undo brings both contacts back to life, and deleting the
unwanted duplicate is the natural next step. **Case C loses data**: `deleteContact` clears the membership
account before deleting the contact, with no transaction around the two, so the failure leaves the
account gone.

This contradicts the intent of undo. Undo is a **short-term** recovery, but the merge record pins both
contacts **permanently**, undone or not. A retention window on the undo data would not help — the
manifest and the foreign key are separate things, and it is the key that pins the contacts.

### Shipped in 077

Everything below landed as decided, plus one thing the implementation found: the staff check has to
cover the **whole chain merged into** the contact, not just the contact. Deleting a survivor cascades
into its merged-in contacts, and one of those may have acted as staff — Peggy Dempsey, merged into
Peggy CDR, is exactly that — so checking only the target would have let the cascade reach a staff actor
and fail on the database's refusal. A survivor that has absorbed others is refused on the SAFE path,
with advice to undo first; only the unrestricted delete takes the chain. A new parity guard reads
`pg_constraint` and fails on any delete-blocking reference into `contacts` the delete check does not
know, so this class of gap cannot reopen silently.

### The direction taken

1. **A contact's merge records are deleted with it**, and each merge's reversal record with its merge:
   `merge_audit.canonical_id` / `merged_id` → `ON DELETE CASCADE`, and `merge_reversals.merge_audit_id`
   → `ON DELETE CASCADE`. This matches the merge record's two nearest siblings, `held_merges` and
   `dedup_rejections`, which already cascade — and `status_change_audit`, a contact's own history, which
   does too. No reason was ever recorded for `merge_audit` being the exception. "Append-only" still holds:
   it forbids rewriting a record, not removing it along with the contact it is about.

   Keeping the record with a blank side (`SET NULL`) was rejected: it means loosening two required
   columns and reinstating the "contact is gone" undo verdict removed during 074's `/speckit-analyze`.
   Cascading needs neither — the merge simply leaves the history with its contact. The comments in
   `mergeHistoryService.ts` and 074's `data-model.md` / `research.md` saying the database permanently
   refuses such a delete become false and must be rewritten.

2. **Deleting a survivor deletes the contacts that were merged into it**: `contacts.merged_into_id` →
   `ON DELETE CASCADE`, following a chain all the way down. **Never `SET NULL`** — a null `merged_into_id`
   is precisely what marks a contact active, so nulling it would silently resurrect every merged-away
   duplicate as a live contact. The retired records are the same person's leftovers, name and phone
   included, so deleting the person should take them.

   **Guard:** if a merge was a mistake, a merged-in record may be a *different person*, and this would
   delete them too. So the delete must say when a survivor has absorbed others, and suggest undoing
   first.

3. **The delete runs in one transaction**, so it can never stop part-way. That closes case C.

### Decided alongside: anyone who has ever acted as staff is never deleted

Five references record who **did** something, and they keep blocking deletion on purpose — accountability
for staff actions outlives the person's role: `audit_events.actor_contact_id`, `role_grants.granted_by`,
`dedup_rejections.rejected_by`, `held_merges.attempted_by`, `contacts.volunteer_approved_by`. The fix
should **not** loosen these.

It should, however, make them refuse **cleanly**. They are also missing from the blocker check today, so
deleting a former staff member would fail with the same raw error. Add them to the check as their own
category, so both the safe and the unrestricted path name the reason — and say that archive is the way
to retire such a contact.

## 3. Smaller items

- **Held-merge resolution chooser (UI).** The service and endpoints are complete and tested for both
  `two_logins` and `two_accounts`; the needs-review queue's **Resolve** currently just opens the record.
  It also blocks 074's quickstart §2 (the destructive account fold) and the original §4, which are
  covered only by the automated suite until it exists.
- **Feature 069 quickstart manual pass — DONE 2026-09-13.** Walked in full. One finding: a proposed
  duplicate pair showed only each contact's display name, so a **custom** display name could hide the
  name the pair was actually proposed on (pairing runs on first + last). **Closed by 076**: the display
  name stays the header, and first + last is shown beneath it only when the display name is custom, with
  no "(custom)" marker — the same rule in the queue row and the comparison.
- **M-R16 provider telemetry — CONFIRMED 2026-09-13** on the mobile layout.

---

## Sequencing note

Items 1a, 1b, 2, 2b and 2c have shipped (071, 072, 074, 076, 077), as have both of §3's verification items. **All
of what remains lands before Mel Maintenance is closed**, in this order:

1. ~~**077 — 2c**, merge history on delete.~~ **Shipped.**
2. **078 — 2a and 3's chooser**, both decisions about access at merge time. Needs a short requirements
   session first: 2a's recommended answer is to HOLD a merge that would newly make the survivor a
   volunteer, for `role.assign`, since simply carrying `is_volunteer` would let whoever controls the
   survivor's own address enrol; the chooser's is one screen covering all three held-merge reasons.
