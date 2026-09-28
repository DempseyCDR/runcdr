import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makePerformer } from "./helpers/factories";
import { POST as BOOK } from "@/app/api/events/[id]/bookings/route";
import { SERIES_KEYS } from "@/server/domain/series/seriesKeys";

// FR-004
describe("Sound Tech on Community Dance", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("rejects a Sound Tech booking on a community dance event", async () => {
    const evt = await makeEvent({ seriesKey: SERIES_KEYS.cdob });
    const p = await makePerformer("Tech");
    const res = await BOOK(
      jsonReq("POST", `/api/events/${evt.id}/bookings`, {
        performerId: p.id,
        performerType: "sound_tech",
        pay: 100,
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("SOUND_TECH_NOT_ALLOWED");
  });

  it("allows a Sound Tech on a TNC event", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    const p = await makePerformer("Tech");
    const res = await BOOK(
      jsonReq("POST", `/api/events/${evt.id}/bookings`, {
        performerId: p.id,
        performerType: "sound_tech",
        pay: 100,
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(201);
  });
});
