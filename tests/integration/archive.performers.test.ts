import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makePerformer } from "./helpers/factories";
import { bookings, performers } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { listPerformers, searchPerformers } from "@/server/domain/performers/performerService";
import { listPublicCallers } from "@/server/domain/public/publicPerformers";
import { matchPerformers } from "@/server/domain/contactLoad/matchPerformers";
import { POST as ARCHIVE } from "@/app/api/performers/[id]/archive/route";
import { POST as RESTORE } from "@/app/api/performers/[id]/restore/route";

// Feature 084 US3 (FR-010 to FR-014, FR-031): a caller who stops calling leaves the roster and the public
// site, while every booking they ever played still names them.

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

const archive = (id: string, body: unknown = {}) =>
  ARCHIVE(jsonReq("POST", `/api/performers/${id}/archive`, body), ctx({ id }));
const restore = (id: string) =>
  RESTORE(jsonReq("POST", `/api/performers/${id}/restore`), ctx({ id }));

/** A caller who is on the public roster. */
async function aPublicCaller(name = "Pat Caller") {
  const p = await makePerformer(name);
  await db
    .update(performers)
    .set({ isPublic: true, isCaller: true })
    .where(eq(performers.id, p.id));
  return p;
}

describe("archiving a performer", () => {
  it("takes them off every list that offers them, including the public roster (FR-031)", async () => {
    const pat = await aPublicCaller();
    expect((await listPublicCallers(db)).map((c) => c.name)).toContain("Pat Caller");

    expect((await archive(pat.id)).status).toBe(200);

    expect((await listPerformers(db)).map((p) => p.id)).not.toContain(pat.id);
    expect((await searchPerformers(db, "Pat")).map((p) => p.id)).not.toContain(pat.id);
    expect((await listPublicCallers(db)).map((c) => c.name)).not.toContain("Pat Caller");
    // The public flag is left exactly as it was, so restoring restores the listing.
    const row = await db.query.performers.findFirst({ where: eq(performers.id, pat.id) });
    expect(row!.isPublic).toBe(true);
  });

  it("leaves a past booking still naming them (FR-011)", async () => {
    const pat = await aPublicCaller();
    const event = await makeEvent({ eventDate: "2024-06-18" });
    const booking = await createBooking(db, event.id, {
      performerId: pat.id,
      performerType: "caller",
    });
    await archive(pat.id);

    const row = await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) });
    expect(row!.performerId).toBe(pat.id);
  });

  it("is no longer offered as a contact-link candidate", async () => {
    const pat = await makePerformer("Pat Caller");
    await db.update(performers).set({ contactId: null }).where(eq(performers.id, pat.id));
    const before = await matchPerformers(db);
    expect(
      [...before.auto, ...before.ambiguous, ...before.unmatched].some(
        (r) => r.performerId === pat.id,
      ),
    ).toBe(true);

    await archive(pat.id);
    const after = await matchPerformers(db);
    expect(
      [...after.auto, ...after.ambiguous, ...after.unmatched].some((r) => r.performerId === pat.id),
    ).toBe(false);
  });

  it("warns before retiring one with bookings still to come, then proceeds (FR-014)", async () => {
    const pat = await aPublicCaller();
    const soon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const event = await makeEvent({ eventDate: soon });
    await createBooking(db, event.id, { performerId: pat.id, performerType: "caller" });

    const refused = await archive(pat.id);
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.error.code).toBe("STILL_IN_USE");
    expect(body.error.details.futureCount).toBe(1);
    expect(body.error.details.nextDate).toBe(soon);

    expect((await archive(pat.id, { confirm: true })).status).toBe(200);
  });

  it("is undone by restore, listing and public roster with it (FR-012)", async () => {
    const pat = await aPublicCaller();
    await archive(pat.id);
    expect((await restore(pat.id)).status).toBe(200);

    expect((await listPerformers(db)).map((p) => p.id)).toContain(pat.id);
    expect((await listPublicCallers(db)).map((c) => c.name)).toContain("Pat Caller");
  });
});
