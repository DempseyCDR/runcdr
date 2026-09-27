import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { asc } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makePerformer } from "./helpers/factories";
import { bookings } from "@/server/db/schema";
import { createBand, getBand } from "@/server/domain/bands/bandService";
import { bookBand } from "@/server/domain/bands/bookBand";
import { patchBooking } from "@/server/domain/bookings/bookingService";
import { PATCH } from "@/app/api/bands/[id]/route";

/**
 * Feature 087 US3 (FR-025, research R4): a band's membership is UNDATED — who is in the band now, with no
 * "from" and "to". That is only safe if changing it can never reach a booking: the dances a band has
 * played, and the ones it is booked for, keep exactly the people and states they had.
 *
 * This is the property the undated-membership decision rests on, so it is asserted over EVERY booking,
 * byte for byte, across a run of membership changes — not over the one row a change might touch.
 */
describe("changing a band's membership (087 FR-025)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  const everyBooking = async () =>
    JSON.stringify(await db.select().from(bookings).orderBy(asc(bookings.id)));

  it("alters no booking, past or future, whatever the change", async () => {
    const [ann, bo, cy, dee] = await Promise.all(
      ["Ann Lead", "Bo Piano", "Cy Guitar", "Dee Bass"].map((n) => makePerformer(n)),
    );
    const band = await createBand(db, {
      name: "Glenrose",
      members: [
        { performerId: ann!.id, isLead: true },
        { performerId: bo!.id, isLead: false },
        { performerId: cy!.id, isLead: false },
      ],
    });
    const past = await makeEvent({ seriesKey: "tnc", eventDate: "2025-03-06" });
    const future = await makeEvent({ seriesKey: "tnc", eventDate: "2027-03-04" });
    await bookBand(db, past.id, band.id);
    const { bookings: booked } = await bookBand(db, future.id, band.id);
    // Some variety of state, so "unchanged" is not trivially "all proposed" (the lead cascades to its band).
    const lead = booked.find((b) => b.performerType === "lead_musician")!;
    await patchBooking(db, lead.id, { status: "requested" }, "test");

    const before = await everyBooking();
    expect(JSON.parse(before)).toHaveLength(6);

    const changes = [
      // take a member off
      [ann, cy].map((p, i) => ({ performerId: p!.id, isLead: i === 0 })),
      // take the LEAD off — the band is left with no lead (FR-023)
      [cy].map((p) => ({ performerId: p!.id, isLead: false })),
      // add someone who has never played with them
      [cy, dee].map((p) => ({ performerId: p!.id, isLead: false })),
      // name a new lead
      [cy, dee].map((p, i) => ({ performerId: p!.id, isLead: i === 1 })),
    ];
    for (const members of changes) {
      const res = await PATCH(
        jsonReq("PATCH", `/api/bands/${band.id}`, { members }),
        ctx({ id: band.id }),
      );
      expect(res.status).toBe(200);
      expect(await everyBooking()).toBe(before);
    }

    expect((await getBand(db, band.id)).members.map((m) => m.performerName).sort()).toEqual([
      "Cy Guitar",
      "Dee Bass",
    ]);
  });

  it("accepts a band with no lead, and still refuses two (FR-022, FR-023)", async () => {
    const [ann, bo] = await Promise.all(["Ann Lead", "Bo Piano"].map((n) => makePerformer(n)));
    const band = await createBand(db, {
      name: "Glenrose",
      members: [{ performerId: ann!.id, isLead: true }],
    });

    const none = await PATCH(
      jsonReq("PATCH", `/api/bands/${band.id}`, {
        members: [
          { performerId: ann!.id, isLead: false },
          { performerId: bo!.id, isLead: false },
        ],
      }),
      ctx({ id: band.id }),
    );
    expect(none.status).toBe(200);
    expect((await getBand(db, band.id)).members.some((m) => m.isLead)).toBe(false);

    const two = await PATCH(
      jsonReq("PATCH", `/api/bands/${band.id}`, {
        members: [
          { performerId: ann!.id, isLead: true },
          { performerId: bo!.id, isLead: true },
        ],
      }),
      ctx({ id: band.id }),
    );
    expect(two.status).toBe(422);
  });
});
