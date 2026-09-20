-- Feature 082 (research R2): a check received at the gate is paid by 'check'.
--
-- This value is added ALONE, in its own migration, because Postgres cannot use a value added to an enum
-- in the transaction that adds it — and `runMigrations` wraps each file in exactly one transaction. The
-- columns and constraints that reference 'check' therefore live in 0053, which runs next.

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'check';
