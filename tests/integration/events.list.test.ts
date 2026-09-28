import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent } from "./helpers/factories";
import { GET as LIST_EVENTS } from "@/app/api/events/route";
import { GET as LIST_SERIES } from "@/app/api/series/route";
import { GET as LIST_GROUPS, POST as CREATE_GROUP } from "@/app/api/event-groups/route";

// Supports the bookings pick list (FR-012/013) + event-management UI (FR-014).
describe("events / series / groups listing", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("lists the seeded series", async () => {
    const res = await LIST_SERIES(jsonReq("GET", "/api/series"), ctx());
    const keys = (await res.json()).items.map((s: { key: string }) => s.key).sort();
    expect(keys).toEqual(["cdob", "ecd", "general", "tnc"]);
  });

  it("filters events by `from` (recency window for the pick list)", async () => {
    await makeEvent({ eventDate: "2026-01-01" }); // old
    await makeEvent({ eventDate: "2026-06-18" }); // recent
    const res = await LIST_EVENTS(jsonReq("GET", "/api/events?from=2026-06-01"), ctx());
    const dates = (await res.json()).items.map((e: { eventDate: string }) => e.eventDate);
    expect(dates).toEqual(["2026-06-18"]);
  });

  it("lists created event groups", async () => {
    await CREATE_GROUP(
      jsonReq("POST", "/api/event-groups", { name: "Fall Weekend", kind: "weekend" }),
      ctx(),
    );
    const res = await LIST_GROUPS(jsonReq("GET", "/api/event-groups"), ctx());
    const names = (await res.json()).items.map((g: { name: string }) => g.name);
    expect(names).toContain("Fall Weekend");
  });
});
