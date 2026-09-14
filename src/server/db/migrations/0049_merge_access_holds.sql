-- Feature 078: two more reasons a merge must be held, and somewhere to keep the answers.
--
-- `volunteer_status` — the merged contact is a volunteer and the survivor is not. Completing it silently
-- locked a mailing-list manager out in 074's manual pass: her roles and sign-in landed on a contact that
-- could not sign in. An officer now decides whether volunteer status is carried across.
--
-- `super_user` — the merged contact is a super-user and the survivor is not. Super-user is granted only
-- at the command line, but a merge used to move it silently onto anyone who already had role-assigning
-- authority. This hold has no answer in the app at all.
--
-- The two ADD VALUEs may share this migration, unlike 0046: Postgres allows ADD VALUE inside a transaction
-- provided nothing uses the new value before commit, and nothing here does.
ALTER TYPE held_merge_reason ADD VALUE IF NOT EXISTS 'volunteer_status';
ALTER TYPE held_merge_reason ADD VALUE IF NOT EXISTS 'super_user';

-- Every answer given so far for this pair, by whoever gave it. A retried merge re-checks every obstacle
-- from scratch, so it needs every earlier answer — and they come from different people at different
-- times: the mailing-list manager answers the accounts question today, an officer the volunteer question
-- next week. Only the hold can carry them.
ALTER TABLE held_merges ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}';
