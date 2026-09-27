import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb } from "./helpers/db";
import { jsonReqAs, ctx } from "./helpers/http";
import { db } from "@/server/db/client";
import { events, series, venues } from "@/server/db/schema";
import { makeActor, makeEvent } from "./helpers/factories";
import { PATCH as PATCH_EVENT } from "@/app/api/events/[id]/route";
import { POST as CREATE_MEMBERSHIP } from "@/app/api/memberships/route";

/**
 * US3 — field-level authority INSIDE a shared record (FR-021, FR-022).
 *
 * The split runs through the record, not around it. An event is written by the Webmaster (its public
 * description) and the Booker (its venue), each refused the other's fields. The route requirement is
 * the weaker capability both hold (`event.public.write`); this refuses what each does not own.
 */

async function seriesId(key: string): Promise<string> {
  const row = await db.query.series.findFirst({ where: eq(series.key, key) });
  if (!row) throw new Error(`series ${key} not seeded`);
  return row.id;
}

async function aVenue(): Promise<string> {
  const [v] = await db
    .insert(venues)
    .values({ name: "Grange Hall", address: "1 Main" })
    .returning();
  return v!.id;
}

function patchEvent(token: string, id: string, body: Record<string, unknown>) {
  return PATCH_EVENT(jsonReqAs(token, "PATCH", `/api/events/${id}`, body), ctx({ id }));
}

describe("US3: field-level authority", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  describe("event: public fields vs. structural (FR-021)", () => {
    it("a Webmaster edits the public description — succeeds", async () => {
      const event = await makeEvent({ seriesKey: "ecd" });
      const { token } = await makeActor({
        email: "wm@cdrochester.org",
        grants: [{ role: "webmaster" }],
      });
      const res = await patchEvent(token, event.id, { description: "A lovely evening" });
      expect(res.status).toBe(200);
      const [row] = await db.select().from(events).where(eq(events.id, event.id));
      expect(row?.description).toBe("A lovely evening");
    });

    it("a Webmaster editing the VENUE is refused (FIELD_NOT_PERMITTED)", async () => {
      const event = await makeEvent({ seriesKey: "ecd" });
      const venueId = await aVenue();
      const { token } = await makeActor({
        email: "wm2@cdrochester.org",
        grants: [{ role: "webmaster" }],
      });
      const res = await patchEvent(token, event.id, { venueId });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FIELD_NOT_PERMITTED");
      expect(body.error.message).toContain("venueId");
    });

    it("a Booker-of-ecd edits the venue — succeeds", async () => {
      const event = await makeEvent({ seriesKey: "ecd" });
      const venueId = await aVenue();
      const { token } = await makeActor({
        email: "bk@cdrochester.org",
        grants: [{ role: "booker", seriesId: await seriesId("ecd") }],
      });
      const res = await patchEvent(token, event.id, { venueId });
      expect(res.status).toBe(200);
    });

    /**
     * Feature 087 (FR-014, FR-016): the Booker's private note on a dance is STRUCTURE, not public display.
     * The events page never shows it — but a Webmaster, who holds only `event.public.write`, must also be
     * refused it straight at the route. Hiding a field in a form has never been a control.
     */
    it("a Webmaster writing the Booker's NOTE is refused (087)", async () => {
      const event = await makeEvent({ seriesKey: "ecd" });
      const { token } = await makeActor({
        email: "wm.note@cdrochester.org",
        grants: [{ role: "webmaster" }],
      });
      const res = await patchEvent(token, event.id, { note: "not yours to write" });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FIELD_NOT_PERMITTED");
      const [row] = await db.select().from(events).where(eq(events.id, event.id));
      expect(row?.note).toBeNull();
    });

    it("a Booker-of-ecd writes the note on an ecd dance — succeeds (087)", async () => {
      const event = await makeEvent({ seriesKey: "ecd" });
      const { token } = await makeActor({
        email: "bk.note@cdrochester.org",
        grants: [{ role: "booker", seriesId: await seriesId("ecd") }],
      });
      const res = await patchEvent(token, event.id, { note: "ask Dave first" });
      expect(res.status).toBe(200);
      const [row] = await db.select().from(events).where(eq(events.id, event.id));
      expect(row?.note).toBe("ask Dave first");
    });

    it("FR-022: a MIXED submission (permitted + forbidden) is refused ENTIRELY — no partial write", async () => {
      const event = await makeEvent({ seriesKey: "ecd" });
      const venueId = await aVenue();
      const { token } = await makeActor({
        email: "wm3@cdrochester.org",
        grants: [{ role: "webmaster" }],
      });
      // description is permitted (Webmaster), venueId is not — the whole write must be refused.
      const res = await patchEvent(token, event.id, { description: "Should not persist", venueId });
      expect(res.status).toBe(403);

      const [row] = await db.select().from(events).where(eq(events.id, event.id));
      expect(row?.description).toBeNull(); // the permitted field did NOT slip through
      expect(row?.venueId).toBeNull();
    });
  });

  describe("contact: mailing side vs. membership (row 17, already split across endpoints)", () => {
    it("a VP is refused the membership endpoint — it is not their field (FR-021)", async () => {
      // The VP owns the mailing side (emails/consent) but NOT membership records. Those are a separate
      // route (`membership.write`), so the split is enforced at layer 1: the VP simply lacks it.
      const { token } = await makeActor({
        email: "vp@cdrochester.org",
        grants: [{ role: "vice_president" }],
      });
      const res = await CREATE_MEMBERSHIP(
        jsonReqAs(token, "POST", "/api/memberships", {
          contactId: "00000000-0000-0000-0000-000000000000",
          payerId: "00000000-0000-0000-0000-000000000000",
          expiryDate: "2026-01-01",
        }),
        ctx(),
      );
      // Refused at layer 1 (UNAUTHORIZED), before the body is even validated — the VP simply lacks
      // membership.write. That IS the field split for contacts: it lives across endpoints.
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    });

    it("the Treasurer is NOT refused membership.write (passes authorization)", async () => {
      const { token } = await makeActor({
        email: "treas@cdrochester.org",
        grants: [{ role: "treasurer" }],
      });
      // Sent with an unknown contact/payer, so it will fail LATER (404/422) — but crucially NOT with a
      // 403 UNAUTHORIZED. Authorization is what US3 is testing here, not the membership domain.
      const res = await CREATE_MEMBERSHIP(
        jsonReqAs(token, "POST", "/api/memberships", {
          contactId: "00000000-0000-0000-0000-000000000000",
          payerId: "00000000-0000-0000-0000-000000000000",
          expiryDate: "2026-01-01",
        }),
        ctx(),
      );
      expect(res.status).not.toBe(403);
    });
  });
});
