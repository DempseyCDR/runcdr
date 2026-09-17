import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReqAs, ctx } from "./helpers/http";
import { makeActor, makeBaseActor } from "./helpers/factories";
import { series } from "@/server/db/schema";
import { GET as CAPABILITIES } from "@/app/api/me/capabilities/route";

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

const capabilities = async (token: string) =>
  (await CAPABILITIES(jsonReqAs(token, "GET", "/api/me/capabilities"), ctx())).json();

/** Feature 081 (FR-030, analysis C1): whether the payments page offers its controls. */
describe("GET /api/me/capabilities — performer payments (081)", () => {
  it("says a Financial Secretary may record payments, and a base volunteer may not", async () => {
    const tnc = await db.query.series.findFirst({ where: eq(series.key, "tnc") });
    const fs = await makeActor({
      email: "fs@example.com",
      grants: [{ role: "financial_secretary", seriesId: tnc!.id }],
    });
    const base = await makeBaseActor("base@example.com");

    expect(await capabilities(fs.token)).toMatchObject({ performerPaymentWrite: true });
    expect(await capabilities(base.token)).toMatchObject({ performerPaymentWrite: false });
  });
});
