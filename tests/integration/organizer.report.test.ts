import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makeDoorRecord, makePerformer, makeBand } from "./helpers/factories";
import { attendance, events } from "@/server/db/schema";
import { updateDoorRecord } from "@/server/domain/door/doorRecordService";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { createContact } from "@/server/domain/contacts/contactService";
import { recordAttendance } from "@/server/domain/attendance/attendanceService";
import { purgeOldAttendance } from "@/server/domain/attendance/retentionService";
import { assembleOrganizerReport } from "@/server/domain/organizer/reportService";
import { createGateCheck } from "@/server/domain/door/gateCheckService";
import { getAttendanceBreakdown } from "@/server/domain/attendance/breakdownService";

const year = 2026;

describe("organizer report", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("computes a per-dance row's Dance Net and metrics (FR-002/003/006/013)", async () => {
    const evt = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    await db.update(events).set({ rentCents: 8000 }).where(eq(events.id, evt.id)); // $80 per-event rent
    // admission derived = gross cash − seed float − non-admission cash
    const drId = await makeDoorRecord(evt.id, [
      { category: "merchandise", paymentMethod: "cash", amount: 50 },
    ]);
    await updateDoorRecord(db, drId, { grossCash: 350, seedFloat: 0 });
    // admission = 350 − 0 − 50(merch cash) = 300
    const caller = await makePerformer("Cal Caller");
    await createBooking(db, evt.id, { performerId: caller.id, performerType: "caller", pay: 150 });
    // Feature 079: the caller counts as a performer only once checked in — they are one of the 20.
    await recordAttendance(db, evt.id, { contactId: caller.contactId! });
    for (let i = 1; i < 20; i++) await recordAttendance(db, evt.id, { unmatched: true });

    const report = await assembleOrganizerReport(db, "tnc", year);
    const row = report.perDanceRows[0] as Record<string, unknown>;
    // Dance Net = 300 + 50 − 80 − 150 − 0 − 0 = 120
    expect(row.grossGate).toBe(300);
    expect(row.merchandise).toBe(50);
    expect(row.rent).toBe(80);
    expect(row.performerTotal).toBe(150);
    expect(row.danceNet).toBe(120);
    // dancers = 20 attendance − 1 checked-in performer (caller) − 1 door = 18
    expect(row.dancers).toBe(18);
    expect(row.caller).toBe("Cal Caller");
    expect((row.performers as unknown[]).length).toBe(1);
  });

  // Feature 041 (P6-R11): the band field shows the booked BAND's name (not the joined member names) when a
  // named band plays; ad-hoc / open-band / no-musicians fall back exactly as before; no computed figure moves.
  // Feature 082 (research R3, FR-020): admission gains a third source — admission a check paid for — and
  // the organizer report reads the same `computeEventGate`, so its gross gate follows without change.
  it("counts admission paid by check in the gross gate", async () => {
    const evt = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const drId = await makeDoorRecord(evt.id);
    await updateDoorRecord(db, drId, { grossCash: 300, seedFloat: 0 });
    const writer = await createContact(db, { firstName: "Chuck", lastName: "Writer" });
    await createGateCheck(db, drId, {
      writerContactId: writer.id,
      lines: [
        { category: "admission", amount: 30, quantity: 2 },
        // A check's T-shirt is merchandise, not admission, and never comes off the cash.
        { category: "merchandise", amount: 25 },
      ],
    });

    const report = await assembleOrganizerReport(db, "tnc", year);
    const row = report.perDanceRows[0] as Record<string, unknown>;
    expect(row.grossGate).toBe(300 + 30);
    expect(row.merchandise).toBe(25);
  });

  it("shows the band's name for a named band, with figures unchanged (FR-001/FR-005)", async () => {
    const evt = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const drId = await makeDoorRecord(evt.id);
    await updateDoorRecord(db, drId, { grossCash: 350, seedFloat: 0 });
    const band = await makeBand("The Fiddleheads");
    const lead = await makePerformer("Alice Fiddle");
    const musician = await makePerformer("Bob Piano");
    await createBooking(
      db,
      evt.id,
      { performerId: lead.id, performerType: "lead_musician", pay: 100 },
      null,
      band.id,
    );
    await createBooking(
      db,
      evt.id,
      { performerId: musician.id, performerType: "musician", pay: 100 },
      null,
      band.id,
    );
    const caller = await makePerformer("Cal Caller");
    await createBooking(db, evt.id, { performerId: caller.id, performerType: "caller", pay: 150 });
    for (const p of [lead, musician, caller]) {
      await recordAttendance(db, evt.id, { contactId: p.contactId! });
    }
    for (let i = 3; i < 20; i++) await recordAttendance(db, evt.id, { unmatched: true });

    const report = await assembleOrganizerReport(db, "tnc", year);
    const row = report.perDanceRows[0] as Record<string, unknown>;
    expect(row.band).toBe("The Fiddleheads"); // the band NAME, not "Alice Fiddle, Bob Piano"
    // FR-005 parity: the band-name change touches no computed figure.
    expect(row.grossGate).toBe(350);
    expect(row.performerTotal).toBe(350); // 100 + 100 + 150
    expect(row.dancers).toBe(16); // 20 attendance − 3 checked-in performers − 1 door
    expect(row.danceNet).toBe(0); // 350 admission − 350 performers
    // the member roster is still available for the drill-in detail
    expect((row.performers as unknown[]).length).toBe(3);
  });

  it("falls back to joined member names for ad-hoc musicians (FR-002)", async () => {
    const evt = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const m1 = await makePerformer("Ada Adhoc");
    const m2 = await makePerformer("Ben Busker");
    await createBooking(db, evt.id, {
      performerId: m1.id,
      performerType: "lead_musician",
      pay: 100,
    });
    await createBooking(db, evt.id, { performerId: m2.id, performerType: "musician", pay: 100 });
    const report = await assembleOrganizerReport(db, "tnc", year);
    const row = report.perDanceRows[0] as { band: string };
    expect(row.band).toContain("Ada Adhoc");
    expect(row.band).toContain("Ben Busker");
  });

  it("shows 'Open Band' for open-band-only and blank when no musicians play (FR-003)", async () => {
    const evt1 = await makeEvent({ seriesKey: "community_dance", eventDate: "2026-06-10" });
    const ob = await makePerformer("Ollie Openband");
    await createBooking(db, evt1.id, {
      performerId: ob.id,
      performerType: "open_band_musician",
    });
    const evt2 = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const caller = await makePerformer("Solo Caller");
    await createBooking(db, evt2.id, { performerId: caller.id, performerType: "caller", pay: 150 });

    const report = await assembleOrganizerReport(db, "tnc", year);
    const bandFor = (id: string) =>
      (report.perDanceRows.find((r) => (r as { eventId: string }).eventId === id) as {
        band: string;
      })!.band;
    expect(bandFor(evt1.id)).toBe("Open Band");
    expect(bandFor(evt2.id)).toBe("");
  });

  it("joins the names of multiple bands on one dance (FR-004)", async () => {
    const evt = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const bandA = await makeBand("Band Alpha");
    const bandB = await makeBand("Band Beta");
    const mA = await makePerformer("Amy A");
    const mB = await makePerformer("Baz B");
    await createBooking(
      db,
      evt.id,
      { performerId: mA.id, performerType: "lead_musician", pay: 100 },
      null,
      bandA.id,
    );
    await createBooking(
      db,
      evt.id,
      { performerId: mB.id, performerType: "lead_musician", pay: 100 },
      null,
      bandB.id,
    );
    const report = await assembleOrganizerReport(db, "tnc", year);
    const row = report.perDanceRows[0] as { band: string };
    expect(row.band).toContain("Band Alpha");
    expect(row.band).toContain("Band Beta");
  });

  it("counts a family's children as paying dancers (B35)", async () => {
    const evt = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const parent = await createContact(db, { firstName: "Fam", lastName: "Ily" });
    await recordAttendance(db, evt.id, { contactId: parent.id, childrenCount: 3 });

    const report = await assembleOrganizerReport(db, "tnc", year);
    const row = report.perDanceRows[0] as { dancers: number };
    // attendance = 4 (parent + 3 children); dancers = 4 − 0 performers − 1 door = 3.
    // Without counting children it would be 1 − 0 − 1 = 0, so the children are counted as paying.
    expect(row.dancers).toBe(3);
  });

  it("counts an open-band musician as attending but not paying (B36)", async () => {
    const evt = await makeEvent({ seriesKey: "community_dance", eventDate: "2026-06-18" });
    const musician = await createContact(db, { firstName: "Ollie", lastName: "Openband" });
    await recordAttendance(db, evt.id, { contactId: musician.id, isOpenBand: true });
    for (let i = 0; i < 5; i++) await recordAttendance(db, evt.id, { unmatched: true });

    const report = await assembleOrganizerReport(db, "community_dance", year);
    const row = report.perDanceRows[0] as { dancers: number };
    // attendance = 6 (musician + 5); effective comps = 0 manual + 1 open-band; performers = 0.
    // dancers = 6 − 0 − 1 door − 1 comp = 4 (the musician attends but does not pay).
    expect(row.dancers).toBe(4);
  });

  it("TNC report includes same-evening Community Dance events (FR-001)", async () => {
    await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    await makeEvent({ seriesKey: "community_dance", eventDate: "2026-06-18" });
    const report = await assembleOrganizerReport(db, "tnc", year);
    const seriesInRows = new Set(
      (report.perDanceRows as { series: string }[]).map((r) => r.series),
    );
    expect(seriesInRows.has("tnc")).toBe(true);
    expect(seriesInRows.has("community_dance")).toBe(true);
  });

  it("per-event dancer count survives the 90-day purge (FR-014)", async () => {
    const evt = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    for (let i = 0; i < 30; i++) await recordAttendance(db, evt.id, { unmatched: true });
    // age attendance rows and purge
    await db
      .update(attendance)
      .set({ createdAt: sql`now() - interval '100 days'` })
      .where(eq(attendance.eventId, evt.id));
    await purgeOldAttendance(db);

    const after = await db.query.events.findFirst({ where: eq(events.id, evt.id) });
    expect(after?.attendanceCount).toBe(30); // counter persists
    const report = await assembleOrganizerReport(db, "tnc", year);
    const row = report.perDanceRows[0] as { dancers: number };
    expect(row.dancers).toBe(29); // 30 − 0 performers − 1 door
  });

  it("hides the trend below 12 weeks and shows it at >=12 weeks (FR-011)", async () => {
    // 3 weekly events → <12 weeks
    for (const d of ["2026-06-04", "2026-06-11", "2026-06-18"]) {
      await makeEvent({ seriesKey: "tnc", eventDate: d });
    }
    expect((await assembleOrganizerReport(db, "tnc", year)).trend).toBeNull();

    // add events spanning >12 weeks
    for (let w = 0; w < 16; w++) {
      const d = new Date(Date.UTC(2026, 0, 1) + w * 7 * 86400000).toISOString().slice(0, 10);
      await makeEvent({ seriesKey: "ecd", eventDate: d });
    }
    const t = (await assembleOrganizerReport(db, "ecd", year)).trend;
    expect(t).not.toBeNull();
    expect(t!.danceNet.length).toBeGreaterThanOrEqual(12);
  });

  it("builds a full-year (≥53-week) series report in under 2 seconds (SC-003)", async () => {
    // 53 weekly events across the year, each with a door record + booking
    for (let w = 0; w < 53; w++) {
      const d = new Date(Date.UTC(2026, 0, 1) + w * 7 * 86400000).toISOString().slice(0, 10);
      const evt = await makeEvent({ seriesKey: "tnc", eventDate: d });
      const drId = await makeDoorRecord(evt.id, [
        { category: "merchandise", paymentMethod: "cash", amount: 20 },
      ]);
      await updateDoorRecord(db, drId, { grossCash: 300, seedFloat: 0 });
      const caller = await makePerformer(`Caller ${w}`);
      await createBooking(db, evt.id, {
        performerId: caller.id,
        performerType: "caller",
        pay: 120,
      });
    }
    const start = performance.now();
    const report = await assembleOrganizerReport(db, "tnc", year);
    const elapsedMs = performance.now() - start;
    expect(report.perDanceRows.length).toBe(53);
    expect(report.trend).not.toBeNull();
    expect(elapsedMs).toBeLessThan(2000);
  });

  /**
   * Feature 079 (FR-023, FR-028; research R3). A booked performer is subtracted from paying dancers only once
   * checked in — someone who never came through the door was never counted in attendance, so subtracting
   * them made paying one too low. And the report's paying figure is the attendance breakdown's.
   */
  it("subtracts only the booked performers who were checked in, matching the breakdown", async () => {
    const evt = await makeEvent({ seriesKey: "tnc", eventDate: "2026-06-18" });
    const drId = await makeDoorRecord(evt.id);
    await updateDoorRecord(db, drId, { grossCash: 300, seedFloat: 0 });
    const caller = await makePerformer("Cal Caller");
    const sound = await makePerformer("Sam Sound");
    await createBooking(db, evt.id, { performerId: caller.id, performerType: "caller", pay: 150 });
    await createBooking(db, evt.id, {
      performerId: sound.id,
      performerType: "sound_tech",
      pay: 50,
    });
    await recordAttendance(db, evt.id, { contactId: caller.contactId! });
    for (let i = 0; i < 19; i++) await recordAttendance(db, evt.id, { unmatched: true });

    const report = await assembleOrganizerReport(db, "tnc", year);
    const row = report.perDanceRows[0] as { dancers: number; avgTicket: number };
    // 20 through the door − the caller (checked in) − 1 door; the sound tech never checked in.
    expect(row.dancers).toBe(18);
    expect(row.dancers).toBe((await getAttendanceBreakdown(db, evt.id)).paying);
    expect(row.avgTicket).toBeCloseTo(300 / 18, 2); // dollars
  });
});
