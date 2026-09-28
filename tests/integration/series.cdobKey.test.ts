import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent } from "./helpers/factories";
import { events, series } from "@/server/db/schema";
import { SERIES_KEYS } from "@/server/domain/series/seriesKeys";
import { GET as ORGANIZER_REPORT } from "@/app/api/organizer/[seriesKey]/report/route";

/**
 * Feature 088 (US1): the community dance series' key is `cdob` — Community Dance / Open Band — and
 * `community_dance` identifies nothing. A rename that changes behaviour is a bug, so this also rehearses
 * the migration on a row that owns dances, and checks the old address is simply unknown.
 */
const MIGRATION = join(
  __dirname,
  "..",
  "..",
  "src",
  "server",
  "db",
  "migrations",
  "0060_cdob_series_key.sql",
);

describe("the community dance's key is cdob (088 US1)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  // The rehearsal below gives the row its old key back; never leave it that way for the next test.
  afterEach(() => db.execute(sql`UPDATE series SET key = 'cdob' WHERE key = 'community_dance'`));
  afterAll(closeDb);

  it("is cdob, named Community Dance, with no sound tech — and the old key is gone (T005a)", async () => {
    const rows = await db.select().from(series);
    expect(rows.map((s) => s.key).sort()).toEqual(["cdob", "ecd", "general", "tnc"]);

    const cdob = rows.find((s) => s.key === SERIES_KEYS.cdob)!;
    expect(cdob.name).toBe("Community Dance");
    expect(cdob.hasSoundTech).toBe(false);
  });

  it("renames the one row, keeping its id and every dance (T005b, FR-005)", async () => {
    const [cdob] = await db.select().from(series).where(eq(series.key, SERIES_KEYS.cdob));
    // Rehearse the real path: the row as it was before 0060, owning dances.
    await db.update(series).set({ key: "community_dance" }).where(eq(series.id, cdob!.id));
    const first = await makeEvent({ seriesKey: "community_dance", eventDate: "2026-07-09" });
    const second = await makeEvent({ seriesKey: "community_dance", eventDate: "2026-08-13" });

    await db.execute(sql.raw(readFileSync(MIGRATION, "utf8")));

    const [after] = await db.select().from(series).where(eq(series.id, cdob!.id));
    expect(after!.key).toBe("cdob");
    const owned = await db.select().from(events).where(eq(events.seriesId, cdob!.id));
    expect(owned.map((e) => e.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("answers the organizer report at cdob, and not at the old key (T005c, FR-007)", async () => {
    const at = (key: string) =>
      ORGANIZER_REPORT(
        jsonReq("GET", `/api/organizer/${key}/report?year=2026`),
        ctx({ seriesKey: key }),
      );

    expect((await at("cdob")).status).toBe(200);
    expect((await at("community_dance")).status).toBe(404);
  });
});
