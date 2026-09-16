# Quickstart: Gate membership-level fix

## Automated gates

Run with **no dev server** running (it holds Postgres connections and skews the suite):

```bash
pnpm tsc --noEmit && pnpm vitest run && pnpm lint:md
```

Then eslint and prettier on the changed files only:

```bash
pnpm exec eslint "src/app/(door)/gate/page.tsx" src/app/membershipLevels.ts "src/app/(admin)/contacts/_components/MembershipAccount.tsx" tests/component/gate.membershipLevel.test.tsx tests/component/gate.reload.test.tsx tests/integration/doorRecord.reload.test.ts
```

```bash
pnpm exec prettier --check "src/app/(door)/gate/page.tsx" src/app/membershipLevels.ts "src/app/(admin)/contacts/_components/MembershipAccount.tsx" tests/component/gate.membershipLevel.test.tsx tests/component/gate.reload.test.tsx tests/integration/doorRecord.reload.test.ts
```

Expected: all clean. The focused tests are `tests/component/gate.membershipLevel.test.tsx`,
`tests/component/gate.reload.test.tsx` and `tests/integration/doorRecord.reload.test.ts`.

## Manual pass

Signed in as a user who can write gate money (the Financial Secretary or the super-user). See
[contracts/gate-save.md](./contracts/gate-save.md) for the exact messages.

Setup: create a throwaway event **Gatecheck Test** in any series that charges admission, and a throwaway
contact **Gatey Member** with no membership.

1. **Guard** (US3). On `/gate`, choose the event. Add a membership line for Gatey Member, amount 40, card.
   Leave the level empty. Enter gross cash 100 and Save.
   *Expect*: "Choose a level for Gatey Member's membership. Nothing was saved."; the level choice is marked.
2. **Record** (US1). Choose **Family**. Save.
   *Expect*: "Saved. Membership recorded: Gatey Member (through …)". On the contact's page, the membership
   account is Family.
3. **No level elsewhere** (US1). Add a donation line for Gatey Member. *Expect*: no level choice on it.
   Remove it.
4. **Reload** (US2). Choose another event, then this one again.
   *Expect*: the membership line shows Family; gross cash shows 100.
5. **Keeps level** (US2). Change gross cash to 110 and Save. *Expect*: "Saved…"; reload again and the line
   still shows Family, gross cash 110.
6. **Money refused** (US3). Enter gross cash **-5** (the server refuses a negative amount) and Save.
   *Expect*: "Sales saved, but the money figures were not: …". Reload: the line still shows Family, gross
   cash still 110.

## Cleanup

Delete the event (its door record and gate sales go with it), then Gatey Member's membership account (its
member rows go with it), then the contact.

```sql
BEGIN;
DELETE FROM events WHERE label = 'Gatecheck Test';
DELETE FROM membership_accounts
  WHERE payer_contact_id IN (SELECT id FROM contacts WHERE display_name = 'Gatey Member');
DELETE FROM contacts WHERE display_name = 'Gatey Member';
COMMIT;
```
