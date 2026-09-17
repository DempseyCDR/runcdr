import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent, makePerformer } from "./helpers/factories";
import { bookings } from "@/server/db/schema";
import { createBand } from "@/server/domain/bands/bandService";
import { bookBand } from "@/server/domain/bands/bookBand";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { repointBand } from "@/server/domain/bookings/bandRepoint";
import { createPerformerPayment } from "@/server/domain/payments/performerPaymentService";

// Feature 024 US2 (FR-003 + FR-005): re-point an event's whole band — remove the outgoing band's unpaid
// bookings, keep any live-paid one as a no-show, and book the incoming band's roster fresh. Only the named
// outgoing band is touched (analyze L1).
describe("band re-point", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function makeBand(name: string) {
    const lead = await makePerformer(`${name} Lead`);
    const m = await makePerformer(`${name} Member`);
    const band = await createBand(db, {
      name,
      members: [
        { performerId: lead.id, isLead: true },
        { performerId: m.id, isLead: false },
      ],
    });
    return { band, lead, m };
  }

  it("books the incoming roster fresh and removes the outgoing band's unpaid bookings", async () => {
    const { band: A } = await makeBand("Band A");
    const { band: B, lead: bLead } = await makeBand("Band B");
    const evt = await makeEvent();
    await bookBand(db, evt.id, A.id);

    const result = await repointBand(db, evt.id, A.id, B.id);
    expect(result.removed).toBe(2); // A's two unpaid bookings gone
    expect(result.keptNoShow).toBe(0);

    // A has no bookings left; B's roster is booked fresh, proposed, lead as lead_musician.
    const aRows = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.eventId, evt.id), eq(bookings.bandId, A.id)));
    expect(aRows).toHaveLength(0);

    const bRows = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.eventId, evt.id), eq(bookings.bandId, B.id)));
    expect(bRows).toHaveLength(2);
    expect(bRows.every((r) => r.status === "proposed")).toBe(true);
    expect(bRows.find((r) => r.performerId === bLead.id)?.performerType).toBe("lead_musician");
    expect(bRows.filter((r) => r.performerType === "musician")).toHaveLength(1);
  });

  it("keeps an outgoing member settled by a live check as a declined no-show", async () => {
    const { band: A, lead: aLead } = await makeBand("Band A");
    const { band: B } = await makeBand("Band B");
    const evt = await makeEvent();
    await bookBand(db, evt.id, A.id);

    // A's lead is settled by a live check.
    const aLeadBooking = (
      await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.eventId, evt.id), eq(bookings.performerId, aLead.id)))
    )[0]!;
    await createPerformerPayment(db, {
      method: "check",
      eventId: evt.id,
      payeePerformerId: aLead.id,
      checkNumber: "2001",
      lines: [{ bookingId: aLeadBooking.id, amount: 125 }],
    });

    const result = await repointBand(db, evt.id, A.id, B.id);
    expect(result.removed).toBe(1); // the unpaid A member removed
    expect(result.keptNoShow).toBe(1); // the paid A lead kept

    const keptRow = await db.query.bookings.findFirst({ where: eq(bookings.id, aLeadBooking.id) });
    expect(keptRow?.status).toBe("declined"); // kept on the record, not orphaned
    expect(keptRow?.performerId).toBe(aLead.id);
  });

  it("touches only the named outgoing band — other bands and non-band bookings are left alone", async () => {
    const { band: A } = await makeBand("Band A");
    const { band: B } = await makeBand("Band B");
    const { band: C } = await makeBand("Band C");
    const caller = await makePerformer("Cal Caller");
    const evt = await makeEvent();
    await bookBand(db, evt.id, A.id);
    await bookBand(db, evt.id, C.id);
    const callerBooking = await createBooking(db, evt.id, {
      performerId: caller.id,
      performerType: "caller",
      pay: 150,
    });

    await repointBand(db, evt.id, A.id, B.id);

    // Band C untouched.
    const cRows = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.eventId, evt.id), eq(bookings.bandId, C.id)));
    expect(cRows).toHaveLength(2);
    // Caller untouched.
    const callerRow = await db.query.bookings.findFirst({
      where: eq(bookings.id, callerBooking.id),
    });
    expect(callerRow?.performerId).toBe(caller.id);
    expect(callerRow?.status).toBe("proposed");
  });
});
