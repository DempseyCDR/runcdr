-- Feature 081 (research R1–R3a, R11): performer payments the treasurer can trust.
--
-- A payment is a CHECK (with a number) or CASH (without one). A check number is digits with an optional
-- letter — a letter tells a duplicate check book apart — stored in capitals and used once club-wide, live
-- or voided. A booking is settled by at most one LIVE payment: `payment_bookings.live` mirrors "the
-- payment is not voided" (voiding clears it, and nothing sets it back) so a partial unique index can say
-- so. Instructor and open-band bookings are free unless given an amount, so `requires_check` becomes
-- simply "has a booked amount" for every role.
--
-- The migration never guesses: if existing data already breaks a rule it stops and lists the rows, for a
-- person to decide which to keep. Every statement is safe to run again.

DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%s (payments %s)', num, ids), '; ')
    INTO bad
    FROM (
      SELECT upper(btrim(check_number)) AS num, string_agg(id::text, ', ') AS ids
        FROM performer_payments
       WHERE check_number IS NOT NULL
       GROUP BY upper(btrim(check_number))
      HAVING count(*) > 1
    ) d;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '0051: check numbers used more than once — keep one of each and delete the rest: %', bad;
  END IF;

  SELECT string_agg(format('%s (payment %s)', check_number, id), '; ')
    INTO bad
    FROM performer_payments
   WHERE check_number IS NOT NULL
     AND upper(btrim(check_number)) !~ '^[0-9]+[A-Z]?$';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '0051: check numbers must be digits with an optional letter — correct these: %', bad;
  END IF;

  SELECT string_agg(format('booking %s (payments %s)', booking_id, ids), '; ')
    INTO bad
    FROM (
      SELECT pb.booking_id, string_agg(p.id::text, ', ') AS ids
        FROM payment_bookings pb
        JOIN performer_payments p ON p.id = pb.payment_id
       WHERE p.voided_at IS NULL
       GROUP BY pb.booking_id
      HAVING count(*) > 1
    ) d;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '0051: bookings settled by more than one live payment — void or delete the extras: %', bad;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'performer_payment_method') THEN
    CREATE TYPE performer_payment_method AS ENUM ('check', 'cash');
  END IF;
END $$;

ALTER TABLE performer_payments
  ADD COLUMN IF NOT EXISTS method performer_payment_method NOT NULL DEFAULT 'check';

UPDATE performer_payments SET method = 'cash' WHERE check_number IS NULL AND method <> 'cash';
UPDATE performer_payments
   SET check_number = upper(btrim(check_number))
 WHERE check_number IS NOT NULL AND check_number <> upper(btrim(check_number));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performer_payments_method_number') THEN
    ALTER TABLE performer_payments
      ADD CONSTRAINT performer_payments_method_number
      CHECK ((method = 'check') = (check_number IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'performer_payments_check_number_form') THEN
    ALTER TABLE performer_payments
      ADD CONSTRAINT performer_payments_check_number_form
      CHECK (check_number ~ '^[0-9]+[A-Z]?$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS performer_payments_check_number
  ON performer_payments (check_number) WHERE check_number IS NOT NULL;

ALTER TABLE payment_bookings ADD COLUMN IF NOT EXISTS live boolean NOT NULL DEFAULT true;

UPDATE payment_bookings pb
   SET live = false
  FROM performer_payments p
 WHERE p.id = pb.payment_id AND p.voided_at IS NOT NULL AND pb.live;

CREATE UNIQUE INDEX IF NOT EXISTS payment_bookings_one_live
  ON payment_bookings (booking_id) WHERE live;

UPDATE bookings
   SET requires_check = (pay_cents > 0 AND NOT is_donated)
 WHERE requires_check IS DISTINCT FROM (pay_cents > 0 AND NOT is_donated);
