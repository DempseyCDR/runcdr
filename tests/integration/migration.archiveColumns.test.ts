import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureSchema, closeDb, resetDb, db } from "./helpers/db";
import { sql } from "@/server/db/client";
import { performers, venues } from "@/server/db/schema";
import { isNull } from "drizzle-orm";

// Feature 084 (data-model.md): venues and performers gain the `archived_at` bands has had since feature
// 008 — a nullable timestamp, null meaning active. Executing the migration file itself is the single
// source of truth, and it must be safe to re-run.
const M0056 = join(process.cwd(), "src/server/db/migrations/0056_archive_venues_performers.sql");

async function columnOf(table: string, column: string) {
  const rows = await sql<
    { data_type: string; is_nullable: string; column_default: string | null }[]
  >`
    SELECT data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_name = ${table} AND column_name = ${column}`;
  return rows[0] ?? null;
}

beforeAll(ensureSchema);
afterAll(closeDb);

describe("migration 0056 — archived_at on venues and performers", () => {
  it("adds a nullable timestamp to both tables, defaulting to null", async () => {
    for (const table of ["venues", "performers"]) {
      const col = await columnOf(table, "archived_at");
      expect(col, `${table}.archived_at`).not.toBeNull();
      expect(col!.data_type).toBe("timestamp with time zone");
      expect(col!.is_nullable).toBe("YES");
      expect(col!.column_default).toBeNull();
    }
  });

  it("leaves every existing row active", async () => {
    await resetDb();
    const [venue] = await db
      .insert(venues)
      .values({ name: "Grange Hall", address: "1 Main" })
      .returning();
    const [performer] = await db
      .insert(performers)
      .values({ displayName: "Pat Caller" })
      .returning();
    expect(venue!.archivedAt).toBeNull();
    expect(performer!.archivedAt).toBeNull();

    const active = await db.select().from(venues).where(isNull(venues.archivedAt));
    expect(active.map((v) => v.id)).toContain(venue!.id);
  });

  it("re-runs without error", async () => {
    const text = await readFile(M0056, "utf8");
    await sql.unsafe(text);
    await sql.unsafe(text);
  });
});
