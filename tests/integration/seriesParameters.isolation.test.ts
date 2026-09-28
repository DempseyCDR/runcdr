import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { series } from "@/server/db/schema";
import {
  createRateParameter,
  resolveParameterCents,
} from "@/server/domain/parameters/seriesParameterService";
import { SERIES_KEYS } from "@/server/domain/series/seriesKeys";

// FR-002, FR-003, SC-001
describe("series-scoped rate isolation", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a rate set for one series has no effect on another series", async () => {
    await createRateParameter(db, {
      seriesKey: "tnc",
      kind: "caller",
      amount: 150,
      effectiveDate: "2026-01-01",
    });
    await createRateParameter(db, {
      seriesKey: "ecd",
      kind: "caller",
      amount: 120,
      effectiveDate: "2026-01-01",
    });

    const tnc = await db.query.series.findFirst({ where: eq(series.key, "tnc") });
    const ecd = await db.query.series.findFirst({ where: eq(series.key, "ecd") });
    const communityDance = await db.query.series.findFirst({
      where: eq(series.key, SERIES_KEYS.cdob),
    });

    expect(
      await resolveParameterCents(db, {
        category: "rate",
        kind: "caller",
        seriesId: tnc!.id,
        onDate: "2026-06-18",
      }),
    ).toBe(15000);
    expect(
      await resolveParameterCents(db, {
        category: "rate",
        kind: "caller",
        seriesId: ecd!.id,
        onDate: "2026-06-18",
      }),
    ).toBe(12000);
    // A third series with no rate set at all resolves to 0 — no leakage from either.
    expect(
      await resolveParameterCents(db, {
        category: "rate",
        kind: "caller",
        seriesId: communityDance!.id,
        onDate: "2026-06-18",
      }),
    ).toBe(0);
  });
});
