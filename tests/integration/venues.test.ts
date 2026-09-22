import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent } from "./helpers/factories";
import { events } from "@/server/db/schema";
import { GET as LIST, POST as CREATE } from "@/app/api/venues/route";
import { GET as GET_ONE, PATCH as PATCH_VENUE } from "@/app/api/venues/[id]/route";
import { PATCH as PATCH_EVENT } from "@/app/api/events/[id]/route";

// FR-002 support
describe("venue CRUD + event assignment", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function createVenue(name = "German House", address = "315 Gregory St") {
    const res = await CREATE(jsonReq("POST", "/api/venues", { name, address }), ctx());
    return res.json();
  }

  it("creates, lists, gets, and patches a venue", async () => {
    const v = await createVenue();
    const list = await LIST(jsonReq("GET", "/api/venues"), ctx());
    expect((await list.json()).items.map((x: { id: string }) => x.id)).toContain(v.id);

    const one = await GET_ONE(jsonReq("GET", `/api/venues/${v.id}`), ctx({ id: v.id }));
    expect((await one.json()).address).toBe("315 Gregory St");

    const patched = await PATCH_VENUE(
      jsonReq("PATCH", `/api/venues/${v.id}`, { name: "German House (Main Hall)" }),
      ctx({ id: v.id }),
    );
    expect((await patched.json()).name).toBe("German House (Main Hall)");
  });

  it("assigns a venue to an event via PATCH /api/events/:id", async () => {
    const v = await createVenue();
    const evt = await makeEvent();
    const res = await PATCH_EVENT(
      jsonReq("PATCH", `/api/events/${evt.id}`, { venueId: v.id }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(200);
    const row = await db.query.events.findFirst({ where: eq(events.id, evt.id) });
    expect(row?.venueId).toBe(v.id);
  });

  // Feature 084 (FR-001, FR-028): every field is changeable afterwards, and a PATCH carrying one field
  // leaves the others exactly as they were — which is what lets two people edit one venue safely.
  it("changes any single field, leaving the rest untouched", async () => {
    const v = await createVenue();
    await PATCH_VENUE(
      jsonReq("PATCH", `/api/venues/${v.id}`, {
        shortName: "GH",
        directions: "Park behind the hall",
        isPublic: true,
      }),
      ctx({ id: v.id }),
    );

    const res = await PATCH_VENUE(
      jsonReq("PATCH", `/api/venues/${v.id}`, { name: "Grange Hall Annexe" }),
      ctx({ id: v.id }),
    );
    expect(res.status).toBe(200);
    const after = await res.json();
    expect(after.name).toBe("Grange Hall Annexe");
    expect(after.shortName).toBe("GH");
    expect(after.directions).toBe("Park behind the hall");
    expect(after.isPublic).toBe(true);
    expect(after.address).toBe(v.address);
  });

  it("404s VENUE_NOT_FOUND when assigning an unknown venue", async () => {
    const evt = await makeEvent();
    const res = await PATCH_EVENT(
      jsonReq("PATCH", `/api/events/${evt.id}`, {
        venueId: "00000000-0000-0000-0000-000000000009",
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("VENUE_NOT_FOUND");
  });
});
