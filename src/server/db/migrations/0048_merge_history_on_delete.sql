-- Feature 077 (close-out §2c): a contact's merge history is deleted with the contact.
--
-- Since feature 003 `merge_audit` referenced both contacts with no delete rule, so Postgres refused to
-- delete either contact a merge record named — forever, whether or not the merge was later undone. That
-- made undo, a SHORT-TERM recovery, leave both contacts permanently undeletable, and the delete check did
-- not know about it, so the refusal surfaced as a raw foreign-key error.
--
-- This matches the merge record to its nearest siblings, which already cascade: `held_merges` (a merge
-- that was attempted) and `dedup_rejections` (a judgement about a pair), and `status_change_audit`, a
-- contact's own history. No reason was ever recorded for `merge_audit` being the exception. Append-only
-- still holds — it forbids rewriting a merge record, not removing it with the contact it is about.
--
-- Deliberately NOT changed: the five references recording who DID something as staff
-- (`audit_events.actor_contact_id`, `role_grants.granted_by`, `dedup_rejections.rejected_by`,
-- `held_merges.attempted_by`, `contacts.volunteer_approved_by`). Anyone who has ever acted as staff is
-- never deleted; the application refuses that cleanly before the database has to.

ALTER TABLE merge_audit DROP CONSTRAINT IF EXISTS merge_audit_canonical_id_fkey;
ALTER TABLE merge_audit
  ADD CONSTRAINT merge_audit_canonical_id_fkey
  FOREIGN KEY (canonical_id) REFERENCES contacts(id) ON DELETE CASCADE;

ALTER TABLE merge_audit DROP CONSTRAINT IF EXISTS merge_audit_merged_id_fkey;
ALTER TABLE merge_audit
  ADD CONSTRAINT merge_audit_merged_id_fkey
  FOREIGN KEY (merged_id) REFERENCES contacts(id) ON DELETE CASCADE;

-- An undo record means nothing without the merge it reversed.
ALTER TABLE merge_reversals DROP CONSTRAINT IF EXISTS merge_reversals_merge_audit_id_fkey;
ALTER TABLE merge_reversals
  ADD CONSTRAINT merge_reversals_merge_audit_id_fkey
  FOREIGN KEY (merge_audit_id) REFERENCES merge_audit(id) ON DELETE CASCADE;

-- Deleting a survivor deletes the contacts merged into it, down the whole chain.
--
-- ⚠️ CASCADE, never SET NULL. A null `merged_into_id` is precisely what marks a contact ACTIVE, so nulling
-- it would silently resurrect every merged-away duplicate as a live contact. The retired records are the
-- same person's leftovers, name and phone included, so deleting the person takes them. Because a mistaken
-- merge may hold a DIFFERENT person, the application refuses the safe delete of a survivor that has
-- absorbed others and says to undo first; only the unrestricted delete reaches this cascade.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_merged_into_id_fkey;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_merged_into_id_fkey
  FOREIGN KEY (merged_into_id) REFERENCES contacts(id) ON DELETE CASCADE;
