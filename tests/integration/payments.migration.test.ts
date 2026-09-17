import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TransactionSql } from "postgres";
import { ensureSchema, resetDb, closeDb } from "./helpers/db";
import { makeEvent, makePerformer } from "./helpers/factories";
import { sql } from "@/server/db/client";

/**
 * Feature 081 (data-model.md §Migration 0051, research R1–R3a): what migration 0051 guarantees, and that it
 * refuses to guess when the data it would constrain is already inconsistent.
 */
const MIGRATION = join(process.cwd(), "src/server/db/migrations/0051_payment_integrity.sql");

/** Thrown to roll a test transaction back after its assertions. */
class Rollback extends Error {}

/** Run `body` in a transaction that is always rolled back. */
async function inRolledBackTx(body: (tx: TransactionSql) => Promise<void>): Promise<void> {
  try {
    await sql.begin(async (tx) => {
      await body(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

/** The error the migration raises, or null — run inside a savepoint so the test transaction survives. */
async function migrationError(tx: TransactionSql, text: string): Promise<Error | null> {
  try {
    await tx.savepoint((sp) => sp.unsafe(text));
    return null;
  } catch (e) {
    return e as Error;
  }
}

async function eventAndBooking() {
  const event = await makeEvent();
  const performer = await makePerformer("Mig Rate");
  const [booking] = await sql<{ id: string }[]>`
    INSERT INTO bookings (event_id, performer_id, performer_type, pay_cents, requires_check)
    VALUES (${event.id}, ${performer.id}, 'musician', 10000, true) RETURNING id`;
  return { eventId: event.id, performerId: performer.id, bookingId: booking!.id };
}

async function insertPayment(
  q: TransactionSql | typeof sql,
  e: { eventId: string; performerId: string },
  cols: { method?: string; checkNumber?: string | null; voided?: boolean },
): Promise<string> {
  const [row] = await q<{ id: string }[]>`
    INSERT INTO performer_payments (event_id, payee_performer_id, amount_cents, check_number, method, voided_at)
    VALUES (${e.eventId}, ${e.performerId}, 10000, ${cols.checkNumber ?? null},
            ${cols.method ?? "check"}, CASE WHEN ${cols.voided ?? false} THEN now() END)
    RETURNING id`;
  return row!.id;
}

describe("migration 0051 — payment integrity (081)", () => {
  let text = "";
  beforeAll(async () => {
    await ensureSchema();
    text = await readFile(MIGRATION, "utf8");
  });
  beforeEach(resetDb);
  afterAll(closeDb);

  it("enforces a method, a well-formed unique check number and one live line per booking", async () => {
    const e = await eventAndBooking();

    await expect(insertPayment(sql, e, { method: "check", checkNumber: null })).rejects.toThrow();
    await expect(insertPayment(sql, e, { method: "cash", checkNumber: "1500" })).rejects.toThrow();
    await expect(insertPayment(sql, e, { checkNumber: "#1500" })).rejects.toThrow();

    const first = await insertPayment(sql, e, { checkNumber: "1500A" });
    await insertPayment(sql, e, { checkNumber: "1500" });
    await expect(insertPayment(sql, e, { checkNumber: "1500" })).rejects.toThrow();
    const second = await insertPayment(sql, e, { method: "cash" });

    await sql`INSERT INTO payment_bookings (payment_id, booking_id, amount_cents) VALUES (${first}, ${e.bookingId}, 10000)`;
    await expect(
      sql`INSERT INTO payment_bookings (payment_id, booking_id, amount_cents) VALUES (${second}, ${e.bookingId}, 10000)`,
    ).rejects.toThrow();

    await sql`UPDATE payment_bookings SET live = false WHERE payment_id = ${first}`;
    await sql`INSERT INTO payment_bookings (payment_id, booking_id, amount_cents) VALUES (${second}, ${e.bookingId}, 10000)`;
  });

  it("runs twice without error (idempotent)", async () => {
    await sql.unsafe(text);
    await sql.unsafe(text);
  });

  it("stops, naming them, when check numbers are duplicated", async () => {
    const e = await eventAndBooking();
    await inRolledBackTx(async (tx) => {
      await tx`DROP INDEX performer_payments_check_number`;
      await tx`ALTER TABLE performer_payments DROP CONSTRAINT performer_payments_check_number_form`;
      await insertPayment(tx, e, { checkNumber: " 9001" });
      await insertPayment(tx, e, { checkNumber: "9001" });
      const err = await migrationError(tx, text);
      expect(err?.message).toContain("9001");
    });
  });

  it("stops, naming them, when a check number is malformed", async () => {
    const e = await eventAndBooking();
    await inRolledBackTx(async (tx) => {
      await tx`ALTER TABLE performer_payments DROP CONSTRAINT performer_payments_check_number_form`;
      await insertPayment(tx, e, { checkNumber: "15OO" });
      const err = await migrationError(tx, text);
      expect(err?.message).toContain("15OO");
    });
  });

  it("stops, naming it, when a booking is settled by two live payments", async () => {
    const e = await eventAndBooking();
    await inRolledBackTx(async (tx) => {
      await tx`DROP INDEX payment_bookings_one_live`;
      for (const n of ["9101", "9102"]) {
        const id = await insertPayment(tx, e, { checkNumber: n });
        await tx`INSERT INTO payment_bookings (payment_id, booking_id, amount_cents) VALUES (${id}, ${e.bookingId}, 10000)`;
      }
      const err = await migrationError(tx, text);
      expect(err?.message).toContain(e.bookingId);
    });
  });

  it("backfills cash for number-less payments, capitals, and not-live lines for voided checks", async () => {
    const e = await eventAndBooking();
    await inRolledBackTx(async (tx) => {
      await tx`ALTER TABLE performer_payments DROP CONSTRAINT performer_payments_method_number`;
      await tx`ALTER TABLE performer_payments DROP CONSTRAINT performer_payments_check_number_form`;
      const numberless = await insertPayment(tx, e, { method: "check", checkNumber: null });
      const lower = await insertPayment(tx, e, { checkNumber: " 1500b " });
      const voided = await insertPayment(tx, e, { checkNumber: "1501", voided: true });
      await tx`INSERT INTO payment_bookings (payment_id, booking_id, amount_cents) VALUES (${voided}, ${e.bookingId}, 10000)`;

      expect(await migrationError(tx, text)).toBeNull();

      const rows = await tx<{ id: string; method: string; check_number: string | null }[]>`
        SELECT id, method, check_number FROM performer_payments WHERE id IN (${numberless}, ${lower})`;
      expect(rows.find((r) => r.id === numberless)?.method).toBe("cash");
      expect(rows.find((r) => r.id === lower)?.check_number).toBe("1500B");
      const [line] = await tx<{ live: boolean }[]>`
        SELECT live FROM payment_bookings WHERE payment_id = ${voided}`;
      expect(line?.live).toBe(false);
    });
  });
});
