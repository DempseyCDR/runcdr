import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent } from "./helpers/factories";
import { POST as CREATE_DR } from "@/app/api/door-records/route";
import { SERIES_KEYS } from "@/server/domain/series/seriesKeys";

// FR-009
describe("POST /api/door-records", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("gives two same-date events their own door records", async () => {
    const tnc = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const cd = await makeEvent({ seriesKey: SERIES_KEYS.cdob, eventDate: "2026-06-18" });

    const r1 = await CREATE_DR(jsonReq("POST", "/api/door-records", { eventId: tnc.id }), ctx());
    const r2 = await CREATE_DR(jsonReq("POST", "/api/door-records", { eventId: cd.id }), ctx());
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect((await r1.json()).id).not.toBe((await r2.json()).id);
  });

  it("rejects a second door record for the same event (409 DOOR_RECORD_EXISTS)", async () => {
    const evt = await makeEvent();
    await CREATE_DR(jsonReq("POST", "/api/door-records", { eventId: evt.id }), ctx());
    const dup = await CREATE_DR(jsonReq("POST", "/api/door-records", { eventId: evt.id }), ctx());
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe("DOOR_RECORD_EXISTS");
  });
});
