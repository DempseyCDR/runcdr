-- Feature 082 (research R17, the P1 review 2026-09-18): a quantity on any gate-sale line.
--
-- 0053 gave a check's admission line a required `people_count`. Rich's review made the count optional
-- ("How many?" is only there to read a check writer's intent — the evening's attendance comes from
-- check-in) and asked for an optional quantity on merchandise, gift cards and other items too. One
-- general `quantity` column serves both, and the two constraints that tied a count to admission go.
-- Admission itself still exists only on a check's line (`gate_sales_admission_on_check` stays).
--
-- Idempotent: the rename happens only while `people_count` exists; constraints are dropped IF EXISTS
-- and added only when absent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'gate_sales' AND column_name = 'people_count'
  ) THEN
    ALTER TABLE gate_sales RENAME COLUMN people_count TO quantity;
  END IF;
END $$;

ALTER TABLE gate_sales DROP CONSTRAINT IF EXISTS gate_sales_people_on_admission;
ALTER TABLE gate_sales DROP CONSTRAINT IF EXISTS gate_sales_admission_needs_people;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gate_sales_quantity_positive') THEN
    ALTER TABLE gate_sales ADD CONSTRAINT gate_sales_quantity_positive
      CHECK (quantity IS NULL OR quantity > 0);
  END IF;
END $$;
