import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureSchema, closeDb, resetDb, db } from "./helpers/db";
import { sql } from "@/server/db/client";
import { contacts, doorRecords } from "@/server/db/schema";
import { makeEvent, contactRow } from "./helpers/factories";

// Feature 082 (research R2): the enum value must be added in its own migration, because Postgres cannot
// use a value in the transaction that adds it and the runner wraps each file in one. Executing the actual
// migration SQL is the single source of truth; both files must be safe to re-run (FR — data-model.md).
const M0052 = join(process.cwd(), "src/server/db/migrations/0052_gate_payment_method_check.sql");
const M0054 = join(process.cwd(), "src/server/db/migrations/0054_payout_reason_is_a_warning.sql");
const M0055 = join(process.cwd(), "src/server/db/migrations/0055_gate_sale_quantity.sql");

async function columnOf(table: string, column: string) {
  const rows = await sql<{ is_nullable: string; column_default: string | null }[]>`
    SELECT is_nullable, column_default FROM information_schema.columns
    WHERE table_name = ${table} AND column_name = ${column}`;
  return rows[0] ?? null;
}

/** A door record and a contact to hang checks off. */
async function scaffold(): Promise<{ doorRecordId: string; contactId: string }> {
  const event = await makeEvent();
  const [dr] = await db.insert(doorRecords).values({ eventId: event.id }).returning();
  const [contact] = await db.insert(contacts).values(contactRow("Chuck Writer")).returning();
  if (!dr || !contact) throw new Error("scaffold failed");
  return { doorRecordId: dr.id, contactId: contact.id };
}

async function insertCheck(doorRecordId: string, contactId: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO gate_checks (door_record_id, writer_contact_id) VALUES (${doorRecordId}, ${contactId})
    RETURNING id`;
  return rows[0]!.id;
}

describe("0052–0055 gate checks", () => {
  beforeAll(async () => {
    await ensureSchema();
    await resetDb();
  });
  afterAll(closeDb);

  it("adds 'check' to payment_method", async () => {
    const rows = await sql<{ enumlabel: string }[]>`
      SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'payment_method'`;
    expect(rows.map((r) => r.enumlabel)).toContain("check");
  });

  it("creates gate_checks, requiring a writer and cascading from the door record", async () => {
    const { doorRecordId, contactId } = await scaffold();
    expect((await columnOf("gate_checks", "writer_contact_id"))?.is_nullable).toBe("NO");

    // A check without a writer is refused (FR-015): a check is never recorded without a contact.
    await expect(
      sql`INSERT INTO gate_checks (door_record_id, writer_contact_id) VALUES (${doorRecordId}, NULL)`,
    ).rejects.toThrow();

    const checkId = await insertCheck(doorRecordId, contactId);
    await sql`DELETE FROM door_records WHERE id = ${doorRecordId}`;
    const left = await sql`SELECT 1 FROM gate_checks WHERE id = ${checkId}`;
    expect(left.length).toBe(0);
  });

  it("deletes a check's lines with the check", async () => {
    const { doorRecordId, contactId } = await scaffold();
    const checkId = await insertCheck(doorRecordId, contactId);
    await sql`
      INSERT INTO gate_sales (door_record_id, category, payment_method, amount_cents, check_id, quantity)
      VALUES (${doorRecordId}, 'admission', 'check', 3000, ${checkId}, 2)`;

    await sql`DELETE FROM gate_checks WHERE id = ${checkId}`;
    const lines = await sql`SELECT 1 FROM gate_sales WHERE check_id = ${checkId}`;
    expect(lines.length).toBe(0);
  });

  it("refuses a line that contradicts its check", async () => {
    const { doorRecordId, contactId } = await scaffold();
    const checkId = await insertCheck(doorRecordId, contactId);

    // A check's line is paid by check.
    await expect(
      sql`INSERT INTO gate_sales (door_record_id, category, payment_method, amount_cents, check_id)
          VALUES (${doorRecordId}, 'merchandise', 'cash', 2500, ${checkId})`,
    ).rejects.toThrow();

    // A check payment belongs to a check.
    await expect(
      sql`INSERT INTO gate_sales (door_record_id, category, payment_method, amount_cents)
          VALUES (${doorRecordId}, 'merchandise', 'check', 2500)`,
    ).rejects.toThrow();

    // Admission is derived everywhere else, so it exists only on a check (FR-020).
    await expect(
      sql`INSERT INTO gate_sales (door_record_id, category, payment_method, amount_cents, quantity)
          VALUES (${doorRecordId}, 'admission', 'cash', 3000, 2)`,
    ).rejects.toThrow();

    // Migration 0055 (R17): a quantity, when given, is above zero.
    await expect(
      sql`INSERT INTO gate_sales (door_record_id, category, payment_method, amount_cents, check_id, quantity)
          VALUES (${doorRecordId}, 'admission', 'check', 3000, ${checkId}, 0)`,
    ).rejects.toThrow();
  });

  it("takes a quantity on any line, and none on admission (0055, research R17)", async () => {
    expect(await columnOf("gate_sales", "quantity")).not.toBeNull();
    expect(await columnOf("gate_sales", "people_count")).toBeNull();

    const { doorRecordId, contactId } = await scaffold();
    const checkId = await insertCheck(doorRecordId, contactId);
    // "How many?" is optional on a check's admission line …
    await sql`INSERT INTO gate_sales (door_record_id, category, payment_method, amount_cents, check_id)
              VALUES (${doorRecordId}, 'admission', 'check', 3000, ${checkId})`;
    // … and a quantity may go on any other line, anonymous or a check's.
    await sql`INSERT INTO gate_sales (door_record_id, category, payment_method, amount_cents, quantity)
              VALUES (${doorRecordId}, 'merchandise', 'cash', 7500, 3)`;
    await sql`INSERT INTO gate_sales (door_record_id, category, payment_method, amount_cents, check_id, quantity)
              VALUES (${doorRecordId}, 'merchandise', 'check', 2500, ${checkId}, 1)`;
    const rows = await sql`SELECT 1 FROM gate_sales WHERE door_record_id = ${doorRecordId}`;
    expect(rows.length).toBe(3);
  });

  it("accepts a well-formed check line", async () => {
    const { doorRecordId, contactId } = await scaffold();
    const checkId = await insertCheck(doorRecordId, contactId);
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gate_sales (door_record_id, category, payment_method, amount_cents, check_id, quantity)
      VALUES (${doorRecordId}, 'admission', 'check', 3000, ${checkId}, 2) RETURNING id`;
    expect(rows.length).toBe(1);
  });

  it("adds the evening's note, the cash count and who recorded what", async () => {
    const note = await columnOf("door_records", "evening_note");
    expect(note?.is_nullable).toBe("YES");

    const count = await columnOf("door_records", "cash_count");
    expect(count?.is_nullable).toBe("NO");
    expect(count?.column_default).toContain("{}");

    expect((await columnOf("door_records", "money_recorded_by_contact_id"))?.is_nullable).toBe(
      "YES",
    );
    expect((await columnOf("gate_sales", "recorded_by_contact_id"))?.is_nullable).toBe("YES");
    expect((await columnOf("gate_checks", "recorded_by_contact_id"))?.is_nullable).toBe("YES");
    expect((await columnOf("performer_payments", "recorded_by_contact_id"))?.is_nullable).toBe(
      "YES",
    );

    const { doorRecordId } = await scaffold();
    const rows = await sql<{ cash_count: unknown }[]>`
      SELECT cash_count FROM door_records WHERE id = ${doorRecordId}`;
    expect(rows[0]?.cash_count).toEqual({});
  });

  it("lets cash be paid out with no reason — the Save warns instead (FR-007)", async () => {
    const { doorRecordId } = await scaffold();
    await sql`UPDATE door_records SET cash_paid_out_cents = 2000, cash_paid_out_reason = NULL
              WHERE id = ${doorRecordId}`;
    const rows = await sql<{ cash_paid_out_cents: number }[]>`
      SELECT cash_paid_out_cents FROM door_records WHERE id = ${doorRecordId}`;
    expect(rows[0]!.cash_paid_out_cents).toBe(2000);
  });

  it("is idempotent — the migrations re-run without error", async () => {
    // Each is re-run against the schema as it now stands. 0053 is not: 0055 renames the column 0053
    // adds, so re-running 0053 would re-create it. The runner never re-reads an applied file; 0053's
    // own re-run was proven here while it was the latest migration.
    for (const file of [M0052, M0054, M0055]) {
      const text = await readFile(file, "utf8");
      await sql.unsafe(text);
      await sql.unsafe(text);
    }

    const { doorRecordId, contactId } = await scaffold();
    const checkId = await insertCheck(doorRecordId, contactId);
    expect(checkId).toBeTruthy();
  });
});
