# Quickstart: Merge history on delete

How to prove this feature works. Automated first, then a manual pass using **throwaway contacts only** —
several steps delete permanently, so nothing here touches a real person.

## Prerequisites

- Branch `077-merge-history-on-delete` checked out, and the dev database migrated to **0048**
  (`pnpm db:migrate`). ⚠️ Do not run the manual pass from `main` before 077 merges: the database would
  have the new delete rules while the code still lacks the refusals that guard them.
- A dev server running, and **nothing else** using the dev database while the automated suite runs — a
  dev server or `pnpm build` mid-suite produces dozens of bogus foreign-key failures.
- Two sign-ins:
  - **Mel** — `mailing_list_manager`, for the ordinary delete.
  - **A super-user**, for the unrestricted delete (`?force=1`, shown in the record as the force-delete
    control).
- A `psql` session on the dev database for the setup and check queries below.

## Automated gates

```bash
pnpm db:migrate && pnpm vitest run && pnpm tsc --noEmit
```

| Suite | Proves |
|---|---|
| `tests/integration/contacts.deleteMergeHistory.test.ts` | Every story below, plus the two things a person cannot walk: that a delete failing part-way leaves nothing half-done (User Story 4), and the guard that fails if any record able to block a delete is unknown to the delete check (FR-012). |
| `tests/integration/contacts.delete.test.ts` | The existing delete rules still hold, and the blocker list now includes merged-in contacts and staff history. |

## Manual pass

### 1. Delete the unwanted contact after an undo (User Story 1) — as Mel

1. **Add contact** twice: `Quinn Testerly` and `Quinn Testerley`, each with an email of its own.
2. **Review duplicates**: the pair appears. Keep `Quinn Testerly`.
3. Open `Quinn Testerly` → **Merge history** → **Undo this merge**.
4. Open `Quinn Testerley` and delete it.

**Expect**: the delete succeeds — no error. Before 077 this failed with a raw database error.

```sql
SELECT count(*) AS merge_records_left
  FROM merge_audit ma
  JOIN contacts c ON c.id IN (ma.canonical_id, ma.merged_id)
 WHERE c.display_name ILIKE 'Quinn Testerl%';
```

Expect `0`: the merge and its undo record went with the deleted contact. `Quinn Testerly` itself remains.

### 2. A survivor with a merged-in contact is refused (User Story 2) — as Mel

1. **Add contact** `Quinn Testerley` again and merge it into `Quinn Testerly` (keep `Quinn Testerly`).
2. Open `Quinn Testerly` and delete it — the ordinary delete.

**Expect**: refused, with a message that other contacts were merged into it and deleting it would delete
them too — **undo those merges first if any were mistakes, or archive it instead**. Both contacts remain.

### 3. Force-deleting a survivor takes the whole chain (User Story 2) — as the super-user

1. **Add contact** `Quin Testerly`. Merge `Quinn Testerly` into it (keep `Quin Testerly`). You now have a
   chain: `Quinn Testerley` → `Quinn Testerly` → `Quin Testerly`.
2. Open `Quin Testerly` and **force-delete** it.

**Expect**: the delete succeeds, and all three are gone.

```sql
SELECT display_name, merged_into_id IS NULL AS active
  FROM contacts
 WHERE display_name ILIKE 'Quin% Testerl%';
```

Expect **no rows**. If any row comes back with `active = true`, a merged-in contact was resurrected
instead of deleted — the one outcome this must never produce.

### 4. A contact that has acted as staff is never deleted (User Story 3) — as Mel, then the super-user

1. **Add contact** `Staffy Testerly` and `Approved Testperson`.
2. Give `Staffy Testerly` a record of having acted as staff, by recording it as the approver of the other:

   ```sql
   UPDATE contacts
      SET volunteer_approved_by = (SELECT id FROM contacts WHERE display_name = 'Staffy Testerly')
    WHERE display_name = 'Approved Testperson';
   ```

3. As **Mel**, delete `Staffy Testerly`. Then as the **super-user**, force-delete it.

**Expect**: both refused, with a message that anyone who has acted as staff is never deleted — **archive
it instead**. It remains. Not a raw database error.

### 5. …including through a merge (User Story 3) — as the super-user

1. **Add contact** `Staffy Testerley`. Merge `Staffy Testerly` into it (keep `Staffy Testerley`).
2. Force-delete `Staffy Testerley`.

**Expect**: refused for the same reason — deleting the survivor would reach the merged-in staff contact.
Both remain. This is the case the implementation found: checking only the contact being deleted would have
let the delete reach the staff contact and fail on the database's raw refusal.

### 6. Not walkable: a delete that fails part-way

User Story 4 needs a failure forced in the middle of a delete, which cannot be arranged through the app. It
is covered by the automated suite, against the real database with no mocks.

## Cleanup

The staff contacts from §4 and §5 **cannot be deleted through the app** — that is the rule working. Remove
the staff link first, then everything this pass created:

```sql
UPDATE contacts SET volunteer_approved_by = NULL WHERE display_name = 'Approved Testperson';
DELETE FROM contacts
 WHERE display_name IN ('Staffy Testerly', 'Staffy Testerley', 'Approved Testperson')
    OR display_name ILIKE 'Quin% Testerl%';
```

Merge records and merged-in contacts go with them.
