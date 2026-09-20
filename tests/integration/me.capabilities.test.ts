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

/**
 * Feature 082 (FR-027, edge case "someone without gate authority"): the gate page offers the money and its
 * Save only to someone who may record gate money; the door may still record a sale or a check.
 */
describe("GET /api/me/capabilities — the gate and the door (082)", () => {
  it("tells the gate from the door", async () => {
    const fs = await makeActor({
      email: "fs@example.com",
      grants: [{ role: "financial_secretary" }],
    });
    const meg = await makeActor({ email: "meg@example.com", grants: [{ role: "door_attendant" }] });
    const base = await makeBaseActor("base@example.com");

    expect(await capabilities(fs.token)).toMatchObject({ gateWrite: true, attendanceWrite: true });
    // FR-027: the door corrects its own entries, so the page must know whose they are.
    expect((await capabilities(meg.token)).contactId).toBe(meg.contactId);
    expect(await capabilities(meg.token)).toMatchObject({
      gateWrite: false,
      attendanceWrite: true,
    });
    expect(await capabilities(base.token)).toMatchObject({
      gateWrite: false,
      attendanceWrite: false,
    });
  });
});
