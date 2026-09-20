-- Feature 082 (FR-007, MARY-R15 Q11): cash paid out with no reason is a WARNING, not a refusal.
--
-- Since feature 004 the database refused a door record that paid cash out without saying why. At the end
-- of an evening that refused Mary's whole Save — every figure she had typed — over one missing word. The
-- gate's Save now points the gap out after saving, with the other things that look wrong, and she adds
-- the reason and saves again.
--
-- Its own migration because 0053 was already applied when this surfaced, and the runner never re-reads
-- an applied file.

ALTER TABLE door_records DROP CONSTRAINT IF EXISTS payout_reason_required;
