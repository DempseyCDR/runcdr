import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReqAs, ctx } from "./helpers/http";
import { makeBaseActor, makeEvent } from "./helpers/factories";
import { createRateParameter } from "@/server/domain/parameters/seriesParameterService";
import { GET as ROLES } from "@/app/api/events/[id]/roles/route";

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

const roles = async (eventId: string) => {
  const base = await makeBaseActor(`base-${eventId}@example.com`);
  return ROLES(jsonReqAs(base.token, "GET", `/api/events/${eventId}/roles`), ctx({ id: eventId }));
};

/** Feature 081 (FR-023, research R12): the roles an event's series allows, with each role's rate that day. */
describe("GET /api/events/{id}/roles (081)", () => {
  it("lists every role the series allows, at the rate in effect on the event date", async () => {
    for (const [kind, amount] of [
      ["caller", 120],
      ["musician", 75],
      ["sound_tech", 60],
    ] as const) {
      await createRateParameter(db, {
        seriesKey: "tnc",
        kind,
        amount,
        effectiveDate: "2026-01-01",
      });
    }
    await createRateParameter(db, {
      seriesKey: "tnc",
      kind: "caller",
      amount: 150,
      effectiveDate: "2026-12-01", // after the event — not yet in effect
    });
    const evt = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const res = await roles(evt.id);
    expect(res.status).toBe(200);
    expect((await res.json()).roles).toEqual([
      { performerType: "caller", rate: 120 },
      { performerType: "lead_musician", rate: 75 },
      { performerType: "musician", rate: 75 },
      { performerType: "sound_tech", rate: 60 },
      { performerType: "instructor", rate: 0 },
      { performerType: "open_band_musician", rate: 0 },
    ]);
  });

  it("leaves out sound tech where the series has none", async () => {
    const evt = await makeEvent({ seriesKey: "community_dance" });
    const { roles: list } = await (await roles(evt.id)).json();
    expect(list.map((r: { performerType: string }) => r.performerType)).not.toContain("sound_tech");
  });

  it("is 404 for an unknown event", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    expect((await roles(id)).status).toBe(404);
  });
});
