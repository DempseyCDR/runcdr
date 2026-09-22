-- Feature 084 (data-model.md): retire a venue or a performer without deleting it.
--
-- The same shape bands has carried since feature 008: a nullable timestamp, null meaning active. Reads
-- that OFFER a record gain the predicate; reads that REPORT one (a past event's venue, a past booking's
-- performer, the treasurer and organizer reports) deliberately do not — history must keep naming them.
ALTER TABLE venues ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE performers ADD COLUMN IF NOT EXISTS archived_at timestamptz;
