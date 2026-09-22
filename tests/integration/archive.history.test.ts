import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makeDoorRecord, makePerformer } from "./helpers/factories";
import { performers, venues } from "@/server/db/schema";
import { createBand, getBand } from "@/server/domain/bands/bandService";
import { assembleTreasurerReport } from "@/server/domain/treasurer/reportService";
import { POST as ARCHIVE_VENUE } from "@/app/api/venues/[id]/archive/route";
import { POST as ARCHIVE_PERFORMER } from "@/app/api/performers/[id]/archive/route";
import { PATCH as PATCH_VENUE } from "@/app/api/venues/[id]/route";

// Feature 084: the rule that runs through this feature — a read that OFFERS a record gates on archived;
// a read that REPORTS one never does. Getting this wrong loses the record of what happened.

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

describe("history is never gated", () => {
  it("still names an archived venue in the report of an event held there (FR-011)", async () => {
    const [venue] = await db
      .insert(venues)
      .values({ name: "Grange Hall", address: "1 Main" })
      .returning();
    const event = await makeEvent({
      eventDate: "2024-06-18",
      venueId: venue!.id,
      rentCents: 25000,
    });
    await makeDoorRecord(event.id);

    await ARCHIVE_VENUE(
      jsonReq("POST", `/api/venues/${venue!.id}/archive`, { confirm: true }),
      ctx({ id: venue!.id }),
    );

    const report = await assembleTreasurerReport(db, event.id);
    expect(report.header.venue).toBe("Grange Hall");
    expect(report.expenses.rent.amount).toBe(250);
  });

  // FR-004: a change is shown wherever the record appears — including a report of an event long past.
  it("reads a renamed venue by its new name in an older event's report", async () => {
    const [venue] = await db
      .insert(venues)
      .values({ name: "Grange Hall", address: "1 Main" })
      .returning();
    const event = await makeEvent({ eventDate: "2024-06-18", venueId: venue!.id });
    await makeDoorRecord(event.id);

    await PATCH_VENUE(
      jsonReq("PATCH", `/api/venues/${venue!.id}`, { name: "Grange Hall Annexe" }),
      ctx({ id: venue!.id }),
    );

    const report = await assembleTreasurerReport(db, event.id);
    expect(report.header.venue).toBe("Grange Hall Annexe");
  });

  // Analysis C2: gating `listPerformers` must not blank a band's existing roster.
  it("still lists an archived member in the band they play in", async () => {
    const lead = await makePerformer("Lead Fiddle");
    const retired = await makePerformer("Retired Piano");
    const band = await createBand(db, {
      name: "The Fiddleheads",
      members: [
        { performerId: lead.id, isLead: true },
        { performerId: retired.id, isLead: false },
      ],
    });

    await ARCHIVE_PERFORMER(
      jsonReq("POST", `/api/performers/${retired.id}/archive`, { confirm: true }),
      ctx({ id: retired.id }),
    );

    const after = await getBand(db, band.id);
    expect(after.members.map((m) => m.performerName)).toContain("Retired Piano");
    // …while the roster that OFFERS performers no longer does.
    const row = await db.query.performers.findFirst({ where: eq(performers.id, retired.id) });
    expect(row!.archivedAt).not.toBeNull();
  });
});
