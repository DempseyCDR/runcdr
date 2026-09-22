import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makePerformer } from "./helpers/factories";
import { bands, performers } from "@/server/db/schema";
import { createBand } from "@/server/domain/bands/bandService";
import { GET as LIST } from "@/app/api/bands/route";
import { POST as RESTORE } from "@/app/api/bands/[id]/restore/route";
import { DELETE } from "@/app/api/bands/[id]/route";

// FR-011
describe("band soft-delete", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("archives the band (drops from list, row persists, performer untouched), idempotently", async () => {
    const lead = await makePerformer("Lead");
    const band = await createBand(db, {
      name: "Doomed",
      members: [{ performerId: lead.id, isLead: true }],
    });

    const res = await DELETE(jsonReq("DELETE", `/api/bands/${band.id}`), ctx({ id: band.id }));
    expect(res.status).toBe(204);

    const list = await LIST(jsonReq("GET", "/api/bands"), ctx());
    expect((await list.json()).items.map((b: { id: string }) => b.id)).not.toContain(band.id);

    const row = await db.query.bands.findFirst({ where: eq(bands.id, band.id) });
    expect(row?.archivedAt).toBeTruthy(); // row persists, archived

    const performer = await db.query.performers.findFirst({ where: eq(performers.id, lead.id) });
    expect(performer).toBeTruthy(); // performer untouched

    // Idempotent: deleting again is still 204.
    const again = await DELETE(jsonReq("DELETE", `/api/bands/${band.id}`), ctx({ id: band.id }));
    expect(again.status).toBe(204);
  });

  // Feature 084 (FR-012, research R1): bands could be archived since feature 008 and never put back —
  // the one thing the pattern was missing.
  it("restores an archived band to the roster", async () => {
    const lead = await makePerformer("Lead Fiddle");
    const band = await createBand(db, {
      name: "The Fiddleheads",
      members: [{ performerId: lead.id, isLead: true }],
    });
    await DELETE(jsonReq("DELETE", `/api/bands/${band.id}`), ctx({ id: band.id }));

    const res = await RESTORE(
      jsonReq("POST", `/api/bands/${band.id}/restore`),
      ctx({ id: band.id }),
    );
    expect(res.status).toBe(200);

    const row = await db.query.bands.findFirst({ where: eq(bands.id, band.id) });
    expect(row!.archivedAt).toBeNull();
    const list = await LIST(jsonReq("GET", "/api/bands"), ctx());
    expect((await list.json()).items.map((b: { id: string }) => b.id)).toContain(band.id);

    // Restoring an active band changes nothing.
    expect(
      (await RESTORE(jsonReq("POST", `/api/bands/${band.id}/restore`), ctx({ id: band.id })))
        .status,
    ).toBe(200);
  });
});
