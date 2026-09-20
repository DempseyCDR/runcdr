-- Feature 082: checks received at the gate, the evening's note and count, and who recorded what.
--
-- The Treasurer's answer (spec Context) is that every check must be recorded: whose it is and what it
-- pays for. A check's lines ARE gate sales — a membership, a donation, a T-shirt, admission — so a check
-- becomes a small `gate_checks` row and its lines become `gate_sales` rows carrying `check_id` and
-- `payment_method = 'check'` (research R1). Every existing reader of gate sales — the money derivation,
-- the membership enrolment, both reports, the mailing-list exports — then needs one change, not two.
--
-- 'check' itself is added in 0052: it cannot be used in the transaction that adds it (research R2).
--
-- Nothing is backfilled. Existing evenings have no checks, no notes and no recorded-by, and the report
-- says so rather than inventing one.

-- 1. The check: its writer (always a contact, FR-015), its note, whether it is deposited on its own, and
--    who recorded it. Its AMOUNT is never stored — it is the sum of its lines (FR-017).
CREATE TABLE IF NOT EXISTS gate_checks (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  door_record_id          uuid NOT NULL REFERENCES door_records(id) ON DELETE CASCADE,
  writer_contact_id       uuid NOT NULL REFERENCES contacts(id),
  note                    text,
  deposit_separately      boolean NOT NULL DEFAULT false,
  recorded_by_contact_id  uuid REFERENCES contacts(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gate_checks_door_record_idx ON gate_checks (door_record_id);

-- 2. A check's lines are gate sales. `people_count` is how many an admission line covers — for the books
--    (FR-016); the evening's attendance still comes from check-ins.
ALTER TABLE gate_sales ADD COLUMN IF NOT EXISTS check_id uuid REFERENCES gate_checks(id) ON DELETE CASCADE;
ALTER TABLE gate_sales ADD COLUMN IF NOT EXISTS people_count integer;
ALTER TABLE gate_sales ADD COLUMN IF NOT EXISTS recorded_by_contact_id uuid REFERENCES contacts(id);

CREATE INDEX IF NOT EXISTS gate_sales_check_idx ON gate_sales (check_id);

DO $$
BEGIN
  -- A line OF a check is paid BY check, and a check payment belongs to a check. The two halves are
  -- separate constraints so a violation names which rule was broken.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gate_sales_check_line_method') THEN
    ALTER TABLE gate_sales ADD CONSTRAINT gate_sales_check_line_method
      CHECK (check_id IS NULL OR payment_method = 'check');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gate_sales_check_method_line') THEN
    ALTER TABLE gate_sales ADD CONSTRAINT gate_sales_check_method_line
      CHECK (payment_method <> 'check' OR check_id IS NOT NULL);
  END IF;

  -- Admission in cash and by card is DERIVED (it always has been); only a check states it as a line.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gate_sales_admission_on_check') THEN
    ALTER TABLE gate_sales ADD CONSTRAINT gate_sales_admission_on_check
      CHECK (category <> 'admission' OR check_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gate_sales_people_on_admission') THEN
    ALTER TABLE gate_sales ADD CONSTRAINT gate_sales_people_on_admission
      CHECK (people_count IS NULL OR category = 'admission');
  END IF;

  -- An admission line says how many people it covers (FR-017).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gate_sales_admission_needs_people') THEN
    ALTER TABLE gate_sales ADD CONSTRAINT gate_sales_admission_needs_people
      CHECK (category <> 'admission' OR (people_count IS NOT NULL AND people_count > 0));
  END IF;
END $$;

-- 3. The evening: the paper report's freehand note (FR-030), the count in progress (FR-012 — written as
--    Mary keys it, cleared when the money is saved, research R8), and who last saved the money (FR-033).
ALTER TABLE door_records ADD COLUMN IF NOT EXISTS evening_note text;
ALTER TABLE door_records ADD COLUMN IF NOT EXISTS cash_count jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE door_records ADD COLUMN IF NOT EXISTS money_recorded_by_contact_id uuid REFERENCES contacts(id);

-- 4. Who recorded a performer payment, so the gate report can name them (FR-033, FR-034).
ALTER TABLE performer_payments ADD COLUMN IF NOT EXISTS recorded_by_contact_id uuid REFERENCES contacts(id);
