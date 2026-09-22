import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, closeDb, db } from "./helpers/db";
import { sql } from "drizzle-orm";

/**
 * Feature 085 (FR-009, SC-005): the QuickBooks mapping is retired. Nothing in the app reads a class or a
 * customer any more, so the table that supplied them — and the audit trail of a table that will not
 * exist — go with migration 0057.
 */
describe("the QuickBooks mapping is retired", () => {
  beforeAll(ensureSchema);
  afterAll(closeDb);

  const exists = async (table: string) => {
    const rows = await db.execute<{ present: boolean }>(
      sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS present`,
    );
    return rows[0]!.present;
  };

  it("has dropped series_qbo_map and mapping_audit", async () => {
    expect(await exists("series_qbo_map")).toBe(false);
    expect(await exists("mapping_audit")).toBe(false);
  });

  it("leaves the treasurer's own audit trail alone", async () => {
    expect(await exists("treasurer_report_audit")).toBe(true);
  });

  it("re-runs without error — the drop is idempotent", async () => {
    await db.execute(sql`DROP TABLE IF EXISTS mapping_audit`);
    await db.execute(sql`DROP TABLE IF EXISTS series_qbo_map`);
    expect(await exists("series_qbo_map")).toBe(false);
  });
});
