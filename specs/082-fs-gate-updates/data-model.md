# Data Model: The gate evening, and the report the Treasurer reads

Two migrations, **`0052_gate_payment_method_check.sql`** and **`0053_gate_checks.sql`** — Postgres
cannot use a value added to an enum in the transaction that adds it, and the runner wraps each file
in one (research R2).

## Migration 0052 — the enum value

```sql
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'check';
```

## Migration 0053 — checks, lines, the evening's note, and who recorded it

**1. `gate_checks`** (new), indexed on `door_record_id`:

| Column | Rule |
|---|---|
| `id` | uuid, primary key |
| `door_record_id` | uuid, not null, → `door_records` on delete cascade |
| `writer_contact_id` | uuid, **not null**, → `contacts` (never without a contact, FR-015) |
| `note` | text, null |
| `deposit_separately` | boolean, not null, default false |
| `recorded_by_contact_id` | uuid, null, → `contacts` |
| `created_at`, `updated_at` | timestamptz, not null, default now |

**2. `gate_sales`** gains:

- `check_id` uuid → `gate_checks` on delete cascade (null on a sale that is not a check's line);
- `people_count` integer (how many an `admission` line covers);
- `recorded_by_contact_id` uuid → `contacts`;
- checks:
  - `check_id IS NULL OR payment_method = 'check'` — a line of a check is paid by check;
  - `payment_method <> 'check' OR check_id IS NOT NULL` — a check payment belongs to a check;
  - `category <> 'admission' OR check_id IS NOT NULL` — admission is otherwise derived;
  - `people_count IS NULL OR category = 'admission'`;
  - `category <> 'admission' OR people_count > 0` — an admission line says how many (FR-017).
- index on `check_id`.

**3. `door_records`** gains:

- `evening_note` text (FR-030);
- `cash_count` jsonb, not null, default `{}` (the count in progress, cleared on save — FR-012);
- `money_recorded_by_contact_id` uuid → `contacts` (FR-033).

**4. `performer_payments`** gains `recorded_by_contact_id` uuid → `contacts` (FR-033, FR-034).

Nothing is backfilled: existing evenings have no checks, no notes and no recorded-by (the report
says so rather than inventing one).

## Entities

### Check received (`gate_checks`)

A check handed in at the door. Its **amount is the sum of its lines** — never stored. Deleting it
deletes its lines (they are meaningless without it). `deposit_separately` puts it in its own deposit
(FR-021, FR-022).

### Check line / gate sale (`gate_sales`)

| Field | Change | Rule |
|---|---|---|
| `category` | `admission` now reachable | On a check's line only |
| `payment_method` | gains `check` | `check` ⇔ `check_id` is set |
| `amount_cents` | — | |
| `contact_id` | — | Required for `donation`, `future_event`, `membership`; on a check's line it is whose membership or donation it is, which may differ from the writer |
| `membership_level` | — | Required on `membership`, forbidden elsewhere (068/080) |
| `people_count` | **new** | `admission` only, > 0 |
| `note` | meaning widened | Was the anonymous-sales comment; now any sale or line may carry one (FR-028) |
| `check_id` | **new** | The check this line belongs to |
| `recorded_by_contact_id` | **new** | Who recorded it; also who may correct it without `gate.write` (research R6) |

### Door record (`door_records`)

| Field | Change | Rule |
|---|---|---|
| `gross_cash_cents` | meaning narrowed | The cash counted — bills and coins, no checks (FR-019) |
| `cash_paid_out_cents`, `..._reason` | — | Other payouts; performers' cash is separate (081) |
| `deposit_cents` | rule widened | The **main** deposit: counted cash − float − other payouts − performers' cash + the checks not marked (research R4) |
| `cash_count` | **new** | `{ "100": 3, "20": 11, …, "coins": 4.35 }` while counting; `{}` once saved |
| `evening_note` | **new** | The freehand note of the paper report |
| `money_recorded_by_contact_id` | **new** | The last person to save the money |

### Derived views

- **`deriveGateMoney`** (pure, shared by the page's preview and the server): admission by cash, card
  and check; the card fee; the checks total; the main deposit.
- **`eventDeposits(db, eventId)`**: the main deposit, then one per separately deposited check — each
  with what makes it up (FR-022, FR-032).
- **Who recorded it**: the door record's money recorder, and the most recent payment's recorder
  (FR-033).

## Rules that are not columns

- A check with no lines is refused (FR-017); removing a check's last line removes the check.
- `admission` lines exist only on checks; the page never sends one otherwise.
- The evening's Save writes only the money figures and the anonymous sales; named sales and checks
  are written one at a time (FR-026, research R5).
- Paying a booking that is `proposed`, `requested` or `tentative` sets it `confirmed`; `declined` is
  untouched (FR-039, FR-040, research R12).

## Migration 0055 — a quantity on any line (2026-09-18, research R17)

```sql
ALTER TABLE gate_sales RENAME COLUMN people_count TO quantity;  -- only if people_count exists
ALTER TABLE gate_sales DROP CONSTRAINT IF EXISTS gate_sales_people_on_admission;
ALTER TABLE gate_sales DROP CONSTRAINT IF EXISTS gate_sales_admission_needs_people;
ALTER TABLE gate_sales ADD CONSTRAINT gate_sales_quantity_positive
  CHECK (quantity IS NULL OR quantity > 0);                       -- guarded: only if absent
```

`quantity` replaces `people_count` in the entities above: optional on every line — "How many?" on a
check's admission line, the number sold on merchandise, gift cards and other items. Admission still
exists only on a check's line (`gate_sales_admission_on_check` stays).

After R16 there is no replace-all path: every `gate_sales` row, anonymous or named, is written and
corrected one at a time.
