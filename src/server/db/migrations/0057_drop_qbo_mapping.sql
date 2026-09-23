-- Feature 085 (FR-009): the sequel to 0032. That migration dropped `account_mapping` and recorded that
-- `series_qbo_map` and `mapping_audit` were unaffected "because the report keeps its class/customer
-- columns". Feature 085 removed those columns: the gate report now answers with only the parts the page
-- shows, and no part of it carries a QuickBooks class or customer. The mapping therefore has no consumer
-- either, so it goes the same way as its sibling.
--
-- `mapping_audit` is the change history of a table that will no longer exist, and nothing else writes to
-- it, so it goes too. The four rows the club had recorded (tnc, ecd, community_dance, general) are written
-- out in specs/085-treasurer-report-pruning/research.md R3 before this runs — a mapping nobody wrote down
-- is a mapping lost.
--
-- Consequence, stated so it does not read as an omission: the seed stops seeding a mapping, so a freshly
-- seeded database holds no QuickBooks class anywhere. That is intended. QuickBooks entry is manual and
-- stays manual; the class and customer names live at the QuickBooks end.
--
-- Idempotent — safe to re-run.
DROP TABLE IF EXISTS mapping_audit;
DROP TABLE IF EXISTS series_qbo_map;
