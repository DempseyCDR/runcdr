# Quickstart: Merge access decisions

How to prove this feature works. Automated first, then a manual pass on **throwaway contacts only**. Several
steps change access, and one grants super-user, so none of it may touch a real person.

## Prerequisites

- This branch checked out and the dev database migrated to **0049** (`pnpm db:migrate`).
- A dev server running, and **nothing else** on the dev database while the automated suite runs.
- Three sign-ins:
  - **Mel**: `mailing_list_manager`, for account holds and to see officer holds waiting.
  - **A President**, for sign-in, role and volunteer holds. Use the President rather than a Vice-President:
    before this feature a President could not see a hold at all (research R11), so this pass proves it.
  - **A super-user**, for the undo check in §7.
- A `psql` session on the dev database, for setup the app has no screen for.

Throwaway names below all start `Holdy` so they pair as duplicates and clean up in one statement.

## Automated gates

```bash
pnpm db:migrate && pnpm vitest run && pnpm tsc --noEmit
```

The suites will be named in `tasks.md`. Between them they must prove:

- `detectHold` is the only detector: the merge, the chooser's read and the auto-close agree on every reason.
- Answers accumulate across people: a pair needing two decisions completes when each is answered by its
  own authority, in turn.
- A stale stored answer is dropped and reported, not applied.
- A super-user hold cannot be resolved by anyone, and closes itself once the survivor is a super-user.
- Carrying volunteer status is recorded in the manifest and reversed by an undo.

## Manual pass

### 1. Mel answers a two-accounts hold (User Story 1), as Mel

Setup: add contacts `Holdy Accounts` and `Holdy Acounts`. Give each a membership:

```sql
WITH c AS (SELECT id, display_name FROM contacts WHERE display_name IN ('Holdy Accounts', 'Holdy Acounts')),
     a AS (INSERT INTO membership_accounts (payer_contact_id, level, expiry_date, last_payment_date)
           SELECT id, 'individual', '2027-08-31', '2026-09-01' FROM c RETURNING id, payer_contact_id)
INSERT INTO membership_members (account_id, contact_id) SELECT id, payer_contact_id FROM a;
```

1. Merge the pair from **Review duplicates**. It is held.
2. Open it from the review queue.

**Expect**: both accounts side by side, with level, expiry, last payment and members. The screen says the
unchosen account is deleted and the merge can be undone. Choose one: the merge completes and the hold leaves
the queue.

### 2. An officer answers a sign-in hold; Mel sees it waiting (User Story 2)

Setup: add `Holdy Signin` and `Holdy Signen`, each with an email. Make both able to sign in:

```sql
UPDATE contact_emails SET is_login = true
 WHERE contact_id IN (SELECT id FROM contacts WHERE display_name IN ('Holdy Signin', 'Holdy Signen'));
INSERT INTO staff_identities (contact_id, google_sub)
SELECT id, 'holdy-sub-' || id FROM contacts WHERE display_name IN ('Holdy Signin', 'Holdy Signen');
UPDATE contacts SET is_volunteer = true WHERE display_name IN ('Holdy Signin', 'Holdy Signen');
```

1. As **Mel**, merge the pair. It is held. Open it.
   **Expect**: both sign-ins shown, "waiting on an officer", **Don't merge**, and no way to answer.
2. As the **officer**, open it and choose a sign-in.
   **Expect**: the merge completes, keeping that address and its Google account together. The other
   contact's Google account is discarded (`staff_identities` holds one row for the pair).
3. Before step 2, as the **President**, open the pair from **Review duplicates** instead.
   **Expect**: the row says the merge is held and offers **Open held merge**, which opens the same
   chooser. The comparison (**Open to resolve**) is view-only: no merge, not-duplicates or share buttons.

### 3. An officer answers a role conflict (User Story 2)

Setup: add `Holdy Roles` and `Holdy Rolls`, make both volunteers, and give them conflicting offices:

```sql
UPDATE contacts SET is_volunteer = true WHERE display_name IN ('Holdy Roles', 'Holdy Rolls');
INSERT INTO role_grants (contact_id, role)
SELECT id, CASE display_name WHEN 'Holdy Roles' THEN 'president' ELSE 'treasurer' END::role
  FROM contacts WHERE display_name IN ('Holdy Roles', 'Holdy Rolls');
```

Merge `Holdy Rolls` into `Holdy Roles`; as the officer, open the hold.

**Expect**: the Treasurer grant listed with why it conflicts. Tick none: the merge completes, and the
survivor holds President only.

### 4. A volunteer merged into a non-volunteer is held (User Story 3)

Setup: add `Holdy Volunteer` and `Holdy Volunter`. Make only the second a volunteer with a role:

```sql
UPDATE contacts SET is_volunteer = true, volunteer_approved_at = now()
 WHERE display_name = 'Holdy Volunter';
INSERT INTO role_grants (contact_id, role)
SELECT id, 'mailing_list_manager' FROM contacts WHERE display_name = 'Holdy Volunter';
```

1. As **Mel**, merge `Holdy Volunter` into `Holdy Volunteer`.
   **Expect**: held, not completed. Opening it shows it waits on an officer.
2. As the **officer**, carry volunteer status across.
   **Expect**: the merge completes, `Holdy Volunteer` is a volunteer with the carried approval date, and the
   role moved with it.

```sql
SELECT display_name, is_volunteer, volunteer_approved_at, merged_into_id IS NULL AS active
  FROM contacts WHERE display_name IN ('Holdy Volunteer', 'Holdy Volunter');
```

This is the lockout from 074's manual pass, now held instead of silent.

### 5. Super-user moves only onto a super-user (User Story 4)

Setup: add `Holdy Super` and `Holdy Supper`, each with an email of its own. Make `Holdy Supper` a super-user
and `Holdy Super` a President:

```sql
UPDATE contacts SET is_volunteer = true WHERE display_name IN ('Holdy Super', 'Holdy Supper');
INSERT INTO role_grants (contact_id, role)
SELECT id, CASE display_name WHEN 'Holdy Supper' THEN 'super_user' ELSE 'president' END::role
  FROM contacts WHERE display_name IN ('Holdy Super', 'Holdy Supper');
```

1. Merge `Holdy Supper` into `Holdy Super`.
   **Expect**: held. As the **officer**, open it: no way to answer, only the command-line instruction and
   **Don't merge**. Before this feature, the President would have silently become a super-user.
2. Make the survivor a super-user at the command line, using `Holdy Super`'s address:

   ```bash
   pnpm auth:bootstrap -- --email <Holdy Super's address> --role super_user
   ```

   **Expect**: the hold closes itself on the next queue load, and merging again completes.

### 6. A pair needing two decisions (User Story 2, FR-008/FR-009)

Setup: combine §1 and §4 on one new pair, `Holdy Twice` and `Holdy Twise`. Give both memberships, and make
only `Holdy Twise` a volunteer.

1. As **Mel**, merge `Holdy Twise` into `Holdy Twice`.
   **Expect**: the hold asks **Mel's** question first — which account survives — not the officer's
   (research R4). Answer it.
2. **Expect**: after your answer the queue shows the volunteer question, never the one you answered, as
   waiting on an officer.
3. As the **officer**, answer it. **Expect**: the merge completes, with Mel's earlier answer applied.

### 7. Undo reverses carried volunteer status (research R6), as the super-user

Open `Holdy Volunteer` from §4, and **Undo this merge**.

**Expect**: `Holdy Volunter` is live again. `Holdy Volunteer` is **no longer a volunteer**: the carried status
and approval were reversed along with everything else.

## Cleanup

None of the throwaway contacts has *acted* as staff — holding a role or being a volunteer is not staff
history under feature 077, and the bootstrap in §5 only logs rather than writing audit rows. But §1 and §6
make them **payers**, and a payer's contact cannot be deleted while it pays for an account: that refusal is
deliberate (feature 068, FR-009), so deleting the contacts alone fails on
`membership_accounts_payer_contact_id_fkey` and removes nothing. Delete the accounts first — their
household rows go with them — then the contacts, which takes their grants, sign-ins and merge records:

```sql
BEGIN;
DELETE FROM membership_accounts
 WHERE payer_contact_id IN (SELECT id FROM contacts WHERE display_name ILIKE 'Holdy %');
DELETE FROM contacts WHERE display_name ILIKE 'Holdy %';
COMMIT;
```
