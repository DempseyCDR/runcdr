import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeBand, makeEvent, makePerformer } from "./helpers/factories";
import { admissionPrices, bookings, events, series, venues } from "@/server/db/schema";
import { getPrintableCalendar, PAGE_LINE_BUDGET } from "@/server/domain/public/printableCalendar";
import { SERIES_KEYS } from "@/server/domain/series/seriesKeys";

// Feature 058 (P7-R15, real Postgres): the printable view-model assembler over live data — capped rows, the
// per-series footer (only series with a sentence + their price), cancelled preserved, future-start window, and
// the single-source reflection of live changes (US2). Read-only (no audit rows).

async function seriesId(key: string): Promise<string> {
  const [s] = await db.select({ id: series.id }).from(series).where(eq(series.key, key));
  return s!.id;
}

async function setSentence(key: string, sentence: string | null): Promise<void> {
  await db.update(series).set({ scheduleSentence: sentence }).where(eq(series.key, key));
}

async function seedTiers(
  key: string,
  tiers: { label: string; amountCents: number }[],
): Promise<void> {
  const sid = await seriesId(key);
  await db.insert(admissionPrices).values(
    tiers.map((t, i) => ({
      seriesId: sid,
      effectiveDate: "2026-01-01",
      label: t.label,
      amountCents: t.amountCents,
      sortOrder: i,
    })),
  );
}

describe("getPrintableCalendar", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("maps rows: series short code, confirmed band, venue short-name fallback, cancelled", async () => {
    const [venue] = await db
      .insert(venues)
      .values({ name: "German House Grand Ballroom", shortName: "GH", address: "315 Gregory St" })
      .returning();
    const e1 = await makeEvent({ seriesKey: "tnc", eventDate: "2026-09-03", venueId: venue!.id });
    const e2 = await makeEvent({ seriesKey: "ecd", eventDate: "2026-09-10" }); // no venue → null
    await db.update(events).set({ status: "cancelled" }).where(eq(events.id, e2.id));
    await db
      .update(events)
      .set({ description: "Driving fiddle-and-piano contra; lesson at 7." })
      .where(eq(events.id, e1.id));

    // A confirmed band + caller on e1 → they show in the "Band / Caller" column.
    const band = await makeBand("The Reel Thing");
    const player = await makePerformer("Ann Player");
    const caller = await makePerformer("Cal Caller");
    await db.insert(bookings).values([
      {
        eventId: e1.id,
        bandId: band.id,
        performerId: player.id,
        performerType: "musician",
        status: "confirmed",
      },
      {
        eventId: e1.id,
        bandId: null,
        performerId: caller.id,
        performerType: "caller",
        status: "confirmed",
      },
    ]);

    const cal = await getPrintableCalendar(db, "2026-09-01");
    expect(cal.startISO).toBe("2026-09-01");
    expect(cal.rows.map((r) => r.dateISO)).toEqual(["2026-09-03", "2026-09-10"]); // nearest-first
    expect(cal.rows[0]!.series).toBe("TNC"); // short code
    expect(cal.rows[0]!.band).toBe("The Reel Thing");
    expect(cal.rows[0]!.caller).toBe("Cal Caller");
    expect(cal.rows[0]!.description).toBe("Driving fiddle-and-piano contra; lesson at 7.");
    expect(cal.rows[0]!.venue).toBe("GH"); // short-name
    expect(cal.rows[1]!.series).toBe("ECD");
    expect(cal.rows[1]!.band).toBeNull(); // no confirmed band
    expect(cal.rows[1]!.caller).toBeNull(); // no confirmed caller
    expect(cal.rows[1]!.description).toBeNull(); // no blurb
    expect(cal.rows[1]!.venue).toBeNull(); // fallback when no venue
    expect(cal.rows[1]!.cancelled).toBe(true);
    expect(cal.truncated).toBe(false);
  });

  // 088: the community dance keeps the code visitors read, whatever its key.
  it('codes a community dance "CD" in the Series column', async () => {
    await makeEvent({ seriesKey: SERIES_KEYS.cdob, eventDate: "2026-09-10" });
    const cal = await getPrintableCalendar(db, "2026-09-01");
    expect(cal.rows.map((r) => r.series)).toEqual(["CD"]);
  });

  it("a future startISO excludes earlier events (advance planning)", async () => {
    await makeEvent({ seriesKey: "tnc", eventDate: "2026-09-03" });
    await makeEvent({ seriesKey: "tnc", eventDate: "2026-10-01" });
    const cal = await getPrintableCalendar(db, "2026-10-01");
    expect(cal.rows.map((r) => r.dateISO)).toEqual(["2026-10-01"]);
  });

  it("dynamically caps to the page line budget; described rows cost more so fewer fit", async () => {
    const ids: string[] = [];
    for (let i = 0; i < PAGE_LINE_BUDGET + 3; i++) {
      const day = String(i + 1).padStart(2, "0");
      const e = await makeEvent({ seriesKey: "tnc", eventDate: `2026-09-${day}` });
      ids.push(e.id);
    }
    // Plain events cost one line each → exactly PAGE_LINE_BUDGET fit.
    let cal = await getPrintableCalendar(db, "2026-09-01");
    expect(cal.rows).toHaveLength(PAGE_LINE_BUDGET);
    expect(cal.truncated).toBe(true);

    // Give every event a short (1-line) description → each row now costs two lines → half as many fit.
    await db
      .update(events)
      .set({ description: "Live music and calling; all are welcome." })
      .where(inArray(events.id, ids));
    cal = await getPrintableCalendar(db, "2026-09-01");
    expect(cal.rows.length).toBe(Math.floor(PAGE_LINE_BUDGET / 2));
    expect(cal.rows.every((r) => r.description)).toBe(true);
    expect(cal.truncated).toBe(true);
  });

  it("footer lists only series with a schedule sentence, each with its price (Free for all-$0)", async () => {
    await setSentence("tnc", "Thursdays, 7:30 PM at the German House.");
    await setSentence("ecd", "Second Sundays, 6:30 PM.");
    await setSentence(SERIES_KEYS.cdob, null); // no sentence → omitted
    await seedTiers("tnc", [
      { label: "Supporter", amountCents: 1500 },
      { label: "Dancer", amountCents: 1200 },
    ]);
    await seedTiers("ecd", [{ label: "All", amountCents: 0 }]); // configured-free

    const cal = await getPrintableCalendar(db, "2026-09-01");
    const byKey = Object.fromEntries(cal.seriesSchedules.map((s) => [s.seriesKey, s]));
    expect(Object.keys(byKey).sort()).toEqual(["ecd", "tnc"]); // the community dance and general omitted (no sentence)
    expect(byKey.tnc!.sentence).toBe("Thursdays, 7:30 PM at the German House.");
    expect(byKey.tnc!.price).toBe("$12–$15");
    expect(byKey.ecd!.price).toBe("Free");
  });

  it("empty window → no rows, not truncated, footer still populated", async () => {
    await setSentence("tnc", "Thursdays, 7:30 PM.");
    const cal = await getPrintableCalendar(db, "2099-01-01");
    expect(cal.rows).toEqual([]);
    expect(cal.truncated).toBe(false);
    expect(cal.seriesSchedules.some((s) => s.seriesKey === "tnc")).toBe(true);
  });

  // US2 (T008): single-source — a live change is reflected with no calendar-specific write.
  it("reflects live changes: cancelling an event and editing a series sentence (single source)", async () => {
    const e = await makeEvent({ seriesKey: "tnc", eventDate: "2026-09-03" });
    await setSentence("tnc", "Thursdays, 7:30 PM.");

    let cal = await getPrintableCalendar(db, "2026-09-01");
    expect(cal.rows[0]!.cancelled).toBe(false);
    expect(cal.seriesSchedules.find((s) => s.seriesKey === "tnc")!.sentence).toBe(
      "Thursdays, 7:30 PM.",
    );

    await db.update(events).set({ status: "cancelled" }).where(eq(events.id, e.id));
    await setSentence("tnc", "Now Thursdays at 8 PM.");

    cal = await getPrintableCalendar(db, "2026-09-01");
    expect(cal.rows[0]!.cancelled).toBe(true);
    expect(cal.seriesSchedules.find((s) => s.seriesKey === "tnc")!.sentence).toBe(
      "Now Thursdays at 8 PM.",
    );
  });
});
