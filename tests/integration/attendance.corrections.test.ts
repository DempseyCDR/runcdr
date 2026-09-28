import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makeContactWithEmail } from "./helpers/factories";
import { attendance, doorRecords, events } from "@/server/db/schema";
import { createEventGroup, getGroupSiblings } from "@/server/domain/events/eventService";
import {
  recordAttendance,
  deleteAttendance,
  patchAttendance,
  moveAttendance,
} from "@/server/domain/attendance/attendanceService";
import { adjustDoorCount } from "@/server/domain/door/doorRecordService";
import { SERIES_KEYS } from "@/server/domain/series/seriesKeys";

// Feature 025 US1 (FR-001..FR-010): per-record roster corrections keep the denormalized head count (and the
// door-record counts) exact. Delete / edit children / reassign / open-band toggle / comp-gift ±1 / move to a
// same-group sibling — with the move guarded against non-siblings (L1), duplicates on the target (G1), and an
// open-band admission landing on a non-community-dance sibling (G2).
describe("attendance corrections", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function headCount(eventId: string): Promise<number> {
    const e = await db.query.events.findFirst({ where: eq(events.id, eventId) });
    return e!.attendanceCount;
  }
  async function doorCounts(eventId: string) {
    const d = await db.query.doorRecords.findFirst({ where: eq(doorRecords.eventId, eventId) });
    return {
      comp: d?.compCount ?? 0,
      gift: d?.giftCardRedemptionCount ?? 0,
      openBand: d?.openBandCount ?? 0,
    };
  }
  async function contact(name: string) {
    const { contactId } = await makeContactWithEmail({ firstName: name, email: `${name}@ex.com` });
    return contactId;
  }

  it("delete removes the row and drops the head count by 1 + children", async () => {
    const evt = await makeEvent();
    const c = await contact("Del");
    const row = await recordAttendance(db, evt.id, { contactId: c, childrenCount: 2 });
    expect(await headCount(evt.id)).toBe(3); // 1 + 2 children

    await deleteAttendance(db, row.id, "t");
    expect(
      await db.query.attendance.findFirst({ where: eq(attendance.id, row.id) }),
    ).toBeUndefined();
    expect(await headCount(evt.id)).toBe(0);
  });

  it("editing children moves the head count by exactly the delta", async () => {
    const evt = await makeEvent();
    const c = await contact("Kid");
    const row = await recordAttendance(db, evt.id, { contactId: c, childrenCount: 1 });
    expect(await headCount(evt.id)).toBe(2);

    await patchAttendance(db, row.id, { childrenCount: 3 }, "t");
    expect(await headCount(evt.id)).toBe(4); // +2

    await patchAttendance(db, row.id, { childrenCount: 0 }, "t");
    expect(await headCount(evt.id)).toBe(1); // -3
  });

  it("reassigns an unmatched admission to a contact; refuses when that contact is already present", async () => {
    const evt = await makeEvent();
    const unmatched = await recordAttendance(db, evt.id, { unmatched: true });
    const c = await contact("Ida");
    const updated = await patchAttendance(db, unmatched.id, { contactId: c }, "t");
    expect(updated.contactId).toBe(c);
    expect(await headCount(evt.id)).toBe(1); // still one admission

    // A second unmatched row reassigned to the SAME contact is refused (dup).
    const other = await recordAttendance(db, evt.id, { unmatched: true });
    await expect(patchAttendance(db, other.id, { contactId: c }, "t")).rejects.toThrow();
  });

  it("toggles open-band, adjusting the door open_band_count and enforcing the community-dance rule", async () => {
    const cd = await makeEvent({ seriesKey: SERIES_KEYS.cdob });
    const c = await contact("Ozzy");
    const row = await recordAttendance(db, cd.id, { contactId: c });
    expect((await doorCounts(cd.id)).openBand).toBe(0);

    await patchAttendance(db, row.id, { isOpenBand: true }, "t");
    expect((await doorCounts(cd.id)).openBand).toBe(1);
    expect(await headCount(cd.id)).toBe(1); // head count unchanged

    await patchAttendance(db, row.id, { isOpenBand: false }, "t");
    expect((await doorCounts(cd.id)).openBand).toBe(0);

    // Open-band on a non-community-dance event is refused.
    const tnc = await makeEvent({ seriesKey: "tnc" });
    const c2 = await contact("Nope");
    const row2 = await recordAttendance(db, tnc.id, { contactId: c2 });
    await expect(patchAttendance(db, row2.id, { isOpenBand: true }, "t")).rejects.toThrow();
  });

  it("adjusts comp / gift-card aggregates by ±1, never below zero", async () => {
    const evt = await makeEvent();
    await adjustDoorCount(db, evt.id, "comp", 1, "t");
    await adjustDoorCount(db, evt.id, "comp", 1, "t");
    await adjustDoorCount(db, evt.id, "gift", 1, "t");
    expect(await doorCounts(evt.id)).toMatchObject({ comp: 2, gift: 1 });

    await adjustDoorCount(db, evt.id, "comp", -1, "t");
    expect((await doorCounts(evt.id)).comp).toBe(1);
    // Floor at zero.
    await adjustDoorCount(db, evt.id, "gift", -1, "t");
    await adjustDoorCount(db, evt.id, "gift", -1, "t");
    expect((await doorCounts(evt.id)).gift).toBe(0);
  });

  it("moves a dancer to a same-group sibling, keeping both head counts exact", async () => {
    const group = await createEventGroup(db, { name: "Same-day double" });
    const cd = await makeEvent({ seriesKey: SERIES_KEYS.cdob, groupId: group.id });
    const contra = await makeEvent({ seriesKey: "tnc", groupId: group.id });
    const c = await contact("Mover");
    const row = await recordAttendance(db, cd.id, { contactId: c, childrenCount: 1 });
    expect(await headCount(cd.id)).toBe(2);

    const moved = await moveAttendance(db, row.id, contra.id, "t");
    expect(moved.eventId).toBe(contra.id);
    expect(await headCount(cd.id)).toBe(0);
    expect(await headCount(contra.id)).toBe(2);
  });

  it("refuses a move to a non-sibling event (L1) and to a target where the dancer is already present (G1)", async () => {
    const group = await createEventGroup(db, { name: "Grp" });
    const a = await makeEvent({ seriesKey: SERIES_KEYS.cdob, groupId: group.id });
    const b = await makeEvent({ seriesKey: "tnc", groupId: group.id });
    const outsider = await makeEvent({ seriesKey: "ecd" }); // no group → not a sibling
    const c = await contact("Al");
    const row = await recordAttendance(db, a.id, { contactId: c });

    await expect(moveAttendance(db, row.id, outsider.id, "t")).rejects.toThrow();

    // Dancer already on the target → refuse (no duplicate).
    await recordAttendance(db, b.id, { contactId: c });
    await expect(moveAttendance(db, row.id, b.id, "t")).rejects.toThrow();
  });

  it("moving an open-band admission to a non-community-dance sibling clears the flag + decrements source open_band_count (G2)", async () => {
    const group = await createEventGroup(db, { name: "CD + Contra" });
    const cd = await makeEvent({ seriesKey: SERIES_KEYS.cdob, groupId: group.id });
    const contra = await makeEvent({ seriesKey: "tnc", groupId: group.id });
    const c = await contact("Fiddler");
    const row = await recordAttendance(db, cd.id, { contactId: c, isOpenBand: true });
    expect((await doorCounts(cd.id)).openBand).toBe(1);

    const moved = await moveAttendance(db, row.id, contra.id, "t");
    expect(moved.eventId).toBe(contra.id);
    expect(moved.isOpenBand).toBe(false); // open-band is community-dance-only
    expect((await doorCounts(cd.id)).openBand).toBe(0); // source count released, not stranded
  });

  it("getGroupSiblings returns the other same-group events, empty when ungrouped", async () => {
    const group = await createEventGroup(db, { name: "Pair" });
    const a = await makeEvent({ seriesKey: SERIES_KEYS.cdob, groupId: group.id });
    const b = await makeEvent({ seriesKey: "tnc", groupId: group.id });
    const lone = await makeEvent({ seriesKey: "ecd" });

    const siblings = await getGroupSiblings(db, a.id);
    expect(siblings.map((s) => s.id)).toEqual([b.id]);
    expect(await getGroupSiblings(db, lone.id)).toEqual([]);
  });
});
