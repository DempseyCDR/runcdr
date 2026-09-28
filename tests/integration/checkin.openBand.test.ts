import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makePerformer } from "./helpers/factories";
import { createContact } from "@/server/domain/contacts/contactService";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { mergeContacts } from "@/server/domain/dedup/mergeService";
import { attendance, doorRecords, events, performers } from "@/server/db/schema";
import { POST as ATTEND } from "@/app/api/events/[id]/attendance/route";
import { SERIES_KEYS } from "@/server/domain/series/seriesKeys";

// Feature 017 (B36): open-band musician check-in at a community dance — counts as attending and adds a
// comp on the door record (open_band_count), applied per event on redemption (no cross-event counter).
// File-level DB lifecycle: this file now has two describes, and a per-describe `afterAll(closeDb)` would
// close the shared pool before the second one ran.
beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

describe("POST /api/events/:id/attendance (open-band musician)", () => {
  it("flags the row, counts as attending, and comps on the door record (the community dance)", async () => {
    const evt = await makeEvent({ seriesKey: SERIES_KEYS.cdob });
    const musician = await createContact(db, { firstName: "Ollie", lastName: "Openband" });

    const res = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, {
        contactId: musician.id,
        isOpenBand: true,
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(201);
    const att = await res.json();

    const row = await db.query.attendance.findFirst({ where: eq(attendance.id, att.id) });
    expect(row?.isOpenBand).toBe(true);

    const ev = await db.query.events.findFirst({ where: eq(events.id, evt.id) });
    expect(ev?.attendanceCount).toBe(1); // counts as attending

    const dr = await db.query.doorRecords.findFirst({ where: eq(doorRecords.eventId, evt.id) });
    expect(dr?.openBandCount).toBe(1); // comped
    expect(dr?.compCount).toBe(0); // separate from the manual comp count
  });

  it("accepts the flag on the new-contact path", async () => {
    const evt = await makeEvent({ seriesKey: SERIES_KEYS.cdob });
    const res = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, {
        newContact: { firstName: "New", lastName: "Fiddler" },
        isOpenBand: true,
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(201);
    const dr = await db.query.doorRecords.findFirst({ where: eq(doorRecords.eventId, evt.id) });
    expect(dr?.openBandCount).toBe(1);
  });

  it("rejects the flag on an event that is not a community dance (FR-022)", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    const musician = await createContact(db, { firstName: "Wrong", lastName: "Series" });
    const res = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, {
        contactId: musician.id,
        isOpenBand: true,
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(422);
  });

  it("rejects the flag when the contact is a booked performer for the event (FR-022a)", async () => {
    const evt = await makeEvent({ seriesKey: SERIES_KEYS.cdob });
    const perf = await makePerformer("Fiona Fiddle"); // auto-creates a linked contact
    await createBooking(db, evt.id, {
      performerId: perf.id,
      performerType: "musician",
      pay: 100,
    });

    const res = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, {
        contactId: perf.contactId,
        isOpenBand: true,
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(422);
  });

  it("rejects the flag on the unmatched variant", async () => {
    const evt = await makeEvent({ seriesKey: SERIES_KEYS.cdob });
    const res = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, { unmatched: true, isOpenBand: true }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(422);
  });
});

/**
 * Feature 072 (SC-007). The open-band guard asks "is this contact a booked performer on this event?" by
 * joining `performers.contact_id`. Before this feature a merge left the performer pointing at the retired
 * shell, so checking the person in under the SURVIVOR missed the guard entirely: they were counted as a
 * booked performer AND an unpaid open-band comp, and the organizer report double-subtracted them.
 *
 * Nothing raised an error — the number was simply wrong. This is one of the three silent failures the
 * feature exists to fix, and it is fixed by relinking `performers.contact_id`, not by touching the guard.
 */
describe("the open-band guard follows a merge (feature 072, SC-007)", () => {
  it("refuses an open-band comp for a booked performer reached through the SURVIVOR", async () => {
    const evt = await makeEvent({ seriesKey: SERIES_KEYS.cdob });

    // The performer is booked against the contact that will be merged away.
    const duplicate = await createContact(db, { firstName: "Fiddler", lastName: "Duplicate" });
    const survivor = await createContact(db, { firstName: "Fiddler", lastName: "Survivor" });
    const performer = await makePerformer("Fiddler Duplicate");
    await db
      .update(performers)
      .set({ contactId: duplicate.id })
      .where(eq(performers.id, performer.id));
    await createBooking(db, evt.id, {
      performerId: performer.id,
      performerType: "musician",
    });

    await mergeContacts(db, survivor.id, duplicate.id, survivor.id);

    // The door checks the person in as the survivor, flagged open-band. FR-022a must still refuse it,
    // because the performer record now resolves through the survivor.
    const res = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, {
        contactId: survivor.id,
        isOpenBand: true,
      }),
      ctx({ id: evt.id }),
    );
    expect(res.status).toBe(422);

    // And no open-band comp was recorded, so paying dancers is not double-subtracted.
    const dr = await db.query.doorRecords.findFirst({ where: eq(doorRecords.eventId, evt.id) });
    expect(dr?.openBandCount ?? 0).toBe(0);
  });
});
