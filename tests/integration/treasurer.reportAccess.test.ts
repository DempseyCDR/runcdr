import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb } from "./helpers/db";
import { jsonReqAs, ctx } from "./helpers/http";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { series } from "@/server/db/schema";
import { makeActor, makeEvent, makeDoorRecord } from "./helpers/factories";
import { GET as REPORT } from "@/app/api/events/[id]/treasurer-report/route";

/**
 * Feature 086 US2 (FR-006, FR-006a, FR-006c): who may open the gate report.
 *
 * ⚠️ This NARROWS a documented rule, deliberately. Feature 016's FR-015 says the club's money is open
 * to its volunteers, and it still is: the door record's raw figures stay readable by anyone signed in
 * (see `authz.boundaries.test.ts`). What is carved out is the ASSEMBLED report — the whole evening's
 * receipts, expenses, deposits and payees in one document, which is a different thing from the figures
 * it is built on. Before this feature every signed-in volunteer could open it, which was never intended.
 *
 * The other half is just as deliberate: the capability is NOT confined by series. The club has two
 * Financial Secretaries and they cover for each other, so a scoped read would refuse a fill-in. Which
 * series a page offers FIRST is presentation, and lives in US3.
 */
describe("who may read the gate report", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function reportFor(token: string, eventId: string) {
    return REPORT(
      jsonReqAs(token, "GET", `/api/events/${eventId}/treasurer-report`),
      ctx({ id: eventId }),
    );
  }

  async function seriesId(key: string): Promise<string> {
    const row = await db.query.series.findFirst({ where: eq(series.key, key) });
    if (!row) throw new Error(`series ${key} not seeded`);
    return row.id;
  }

  async function anEvening(seriesKey: string) {
    const event = await makeEvent({ seriesKey });
    await makeDoorRecord(event.id);
    return event.id;
  }

  it("refuses a Door Attendant — not merely leaving it out of their menu (FR-006a)", async () => {
    const eventId = await anEvening("tnc");
    const { token } = await makeActor({
      email: "door.report@cdrochester.org",
      grants: [{ role: "door_attendant" }],
    });

    expect((await reportFor(token, eventId)).status).toBe(403);
  });

  it("refuses a volunteer holding none of the six roles", async () => {
    const eventId = await anEvening("tnc");
    const { token } = await makeActor({
      email: "webmaster.report@cdrochester.org",
      grants: [{ role: "webmaster" }],
    });

    expect((await reportFor(token, eventId)).status).toBe(403);
  });

  // Added at the walk-through (2026-09-23, Rich): the Booker negotiates performer fees, so what an
  // evening took and paid out is their business — reading it, never recording it.
  it("answers a Booker", async () => {
    const eventId = await anEvening("tnc");
    const { token } = await makeActor({
      email: "booker.report@cdrochester.org",
      grants: [{ role: "booker" }],
    });

    expect((await reportFor(token, eventId)).status).toBe(200);
  });

  it("answers a Financial Secretary", async () => {
    const eventId = await anEvening("tnc");
    const { token } = await makeActor({
      email: "fs.report@cdrochester.org",
      grants: [{ role: "financial_secretary", seriesId: await seriesId("tnc") }],
    });

    expect((await reportFor(token, eventId)).status).toBe(200);
  });

  it("answers a Financial Secretary covering for the other one's series (FR-006c)", async () => {
    const eventId = await anEvening("ecd");
    const { token } = await makeActor({
      email: "fs.fillin@cdrochester.org",
      grants: [{ role: "financial_secretary", seriesId: await seriesId("tnc") }],
    });

    // Her grant names tnc; the evening is ecd. She reads it, because covering is ordinary work.
    expect((await reportFor(token, eventId)).status).toBe(200);
  });

  it("answers the Treasurer and the officers", async () => {
    const eventId = await anEvening("tnc");
    for (const role of ["treasurer", "president", "vice_president"] as const) {
      const { token } = await makeActor({
        email: `${role}.report@cdrochester.org`,
        grants: [{ role }],
      });
      expect((await reportFor(token, eventId)).status, role).toBe(200);
    }
  });
});
