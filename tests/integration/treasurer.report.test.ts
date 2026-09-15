import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makeDoorRecord, makePerformer, contactRow } from "./helpers/factories";
import { contacts, doorRecords, treasurerReportAudit, venues } from "@/server/db/schema";
import { updateDoorRecord } from "@/server/domain/door/doorRecordService";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { createPerformerPayment } from "@/server/domain/payments/performerPaymentService";
import { recordAttendance } from "@/server/domain/attendance/attendanceService";
import { getAttendanceBreakdown } from "@/server/domain/attendance/breakdownService";
import { GET as REPORT } from "@/app/api/events/[id]/treasurer-report/route";

// FR-001/003/004/005/006/007/012/014
describe("GET /api/events/:id/treasurer-report", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function report(eventId: string) {
    const res = await REPORT(
      jsonReq("GET", `/api/events/${eventId}/treasurer-report`),
      ctx({ id: eventId }),
    );
    return { status: res.status, body: await res.json() };
  }

  it("assembles all sections with mapping, named-customer split, and gift-card liability", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    const [buyer] = await db.insert(contacts).values(contactRow("Member Buyer")).returning();
    const drId = await makeDoorRecord(evt.id, [
      { category: "gift_card", paymentMethod: "card", amount: 25 },
      { category: "membership", paymentMethod: "card", amount: 40, contactId: buyer!.id },
    ]);
    // Gross cash 120, PC gross 145; admission derived: cash 120, card 145−(25+40)=80 → total 200.
    await updateDoorRecord(db, drId, {
      grossCash: 120,
      pcGross: 145,
      seedFloat: 0,
      posTransactionCount: 10,
    });
    const caller = await makePerformer("Pat Caller");
    const callerBooking = await createBooking(db, evt.id, {
      performerId: caller.id,
      performerType: "caller",
      pay: 150,
    });
    // Feature 019 US2: the report now derives performer lines from ACTUAL payments, not booked pay.
    await createPerformerPayment(db, {
      eventId: evt.id,
      payeePerformerId: caller.id,
      lines: [{ bookingId: callerBooking.id, amount: 150 }],
    });

    const { status, body } = await report(evt.id);
    expect(status).toBe(200);

    // Feature 038 (P6-R6): the non-dance-income section is removed from the report entirely.
    expect(body).not.toHaveProperty("nonDanceIncome");

    // Gate summary: anonymous customer, admission + gift_card lines present. Feature 039 (P6-R7): the GL
    // `account` annotation is gone from every line; `customer` + `class` are retained (FR-002).
    expect(body.gateSalesSummary.customer).toBe("Contra Gate");
    const adm = body.gateSalesSummary.lines.find(
      (l: { category: string }) => l.category === "admission",
    );
    expect(adm).not.toHaveProperty("account");
    expect(adm.class).toBe("TNC"); // retained boundary: the class column stays (FR-002)
    expect(adm.total).toBe(200);
    const gc = body.gateSalesSummary.lines.find(
      (l: { category: string }) => l.category === "gift_card",
    );
    expect(gc).not.toHaveProperty("account");
    // membership is NOT on the gate receipt
    expect(
      body.gateSalesSummary.lines.find((l: { category: string }) => l.category === "membership"),
    ).toBeUndefined();

    // Named-customer receipt for membership: no GL account, class retained (039).
    const mem = body.namedCustomerReceipts.find((r: { kind: string }) => r.kind === "membership");
    expect(mem).not.toHaveProperty("account");
    expect(mem.amount).toBe(40);
    expect(mem.contact).toBe("Member Buyer");

    // Performer payment: no GL account annotation (039); amount unchanged.
    expect(body.performerPayments[0]).not.toHaveProperty("account");
    expect(body.performerPayments[0].amount).toBe(150);

    // a report-generation audit row was written (FR-014)
    const audits = await db
      .select()
      .from(treasurerReportAudit)
      .where(eq(treasurerReportAudit.eventId, evt.id));
    expect(audits.length).toBe(1);
  });

  // Feature 040 (P6-R8): the report carries a Bills section — the venue rent as a bill owed to the venue's
  // landlord, amount derived from resolveEventRentCents; NO check/payment line (rent is paid outside the FS
  // check workflow).
  it("shows the venue rent as a bill to the landlord, with no check line", async () => {
    const [landlord] = await db
      .insert(contacts)
      .values(contactRow("Faith Lutheran Church"))
      .returning();
    const [venue] = await db
      .insert(venues)
      .values({ name: "Faith Lutheran", address: "123 Main St", landlordContactId: landlord!.id })
      .returning();
    const evt = await makeEvent({ seriesKey: "tnc", venueId: venue!.id, rentCents: 25000 });
    await makeDoorRecord(evt.id);
    const { body } = await report(evt.id);
    expect(body.bills).toHaveLength(1);
    expect(body.bills[0]).toEqual({
      vendor: "Faith Lutheran Church",
      class: "TNC",
      amount: 250, // rentCents 25000 (frozen override) → resolveEventRentCents → $250
    });
    // no check/payment line on a bill (FR-004)
    expect(body.bills[0]).not.toHaveProperty("checkNumber");
  });

  // Feature 040 (P6-R8/R9): a community-dance event is its own series, so its gate receipt is addressed to the
  // series' gate customer ("Contra Gate") with NO special-case code (FR-009). With no venue, rent resolves to
  // 0 and the bill still shows a $0 line to "(no landlord set)".
  it("community-dance event with no venue: gate to Contra Gate, $0 rent line, no landlord", async () => {
    const evt = await makeEvent({ seriesKey: "community_dance" });
    await makeDoorRecord(evt.id);
    const { body } = await report(evt.id);
    expect(body.gateSalesSummary.customer).toBe("Contra Gate");
    expect(body.bills).toHaveLength(1);
    expect(body.bills[0].amount).toBe(0);
    expect(body.bills[0].vendor).toBe("(no landlord set)");
  });

  // Feature 040 (P6-R9): the report surfaces the raw comp-admission count and gift-card-redemption count for
  // reconciliation (both from the door record; display-only, no money figure changes).
  it("surfaces comp-admission and gift-card-redemption counts", async () => {
    const evt = await makeEvent();
    const drId = await makeDoorRecord(evt.id);
    await db
      .update(doorRecords)
      .set({ compCount: 3, giftCardRedemptionCount: 2 })
      .where(eq(doorRecords.id, drId));
    const { body } = await report(evt.id);
    expect(body.compCount).toBe(3);
    expect(body.giftCardRedemptionCount).toBe(2);
  });

  it("shows zero comp / gift-card-redemption counts (not hidden)", async () => {
    const evt = await makeEvent();
    await makeDoorRecord(evt.id);
    const { body } = await report(evt.id);
    expect(body.compCount).toBe(0);
    expect(body.giftCardRedemptionCount).toBe(0);
  });

  it("computes deposit and shows POS verification", async () => {
    const evt = await makeEvent();
    const drId = await makeDoorRecord(evt.id);
    await updateDoorRecord(db, drId, { grossCash: 200, pcGross: 100, seedFloat: 15 });
    const { body } = await report(evt.id);
    expect(body.deposit).not.toHaveProperty("account"); // GL account annotation removed (039)
    expect(body.deposit.amount).toBe(185); // gross cash 200 − seed 15
    expect(body.gateSalesSummary.posVerification.gross).toBe(100); // PC gross (entered)
  });

  it("derives admission from gross cash/PC gross minus all non-admission (anon + named) lines", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    const [a] = await db.insert(contacts).values(contactRow("Donor A")).returning();
    const [b] = await db.insert(contacts).values(contactRow("Member B")).returning();
    const drId = await makeDoorRecord(evt.id, [
      { category: "merchandise", paymentMethod: "cash", amount: 30 },
      { category: "merchandise", paymentMethod: "card", amount: 20 },
      { category: "gift_card", paymentMethod: "cash", amount: 10 },
      { category: "misc_sales", paymentMethod: "cash", amount: 5 },
      { category: "donation", paymentMethod: "cash", amount: 25, contactId: a!.id },
      { category: "membership", paymentMethod: "card", amount: 40, contactId: b!.id },
    ]);
    // gross cash 300, seed 15, PC gross 200
    await updateDoorRecord(db, drId, { grossCash: 300, pcGross: 200, seedFloat: 15 });

    const { body } = await report(evt.id);
    const adm = body.gateSalesSummary.lines.find(
      (l: { category: string }) => l.category === "admission",
    );
    // cash: 300 − 15 − (30+10+5+25)=70 → 215 ; card: 200 − (20+40)=60 → 140
    expect(adm.cash).toBe(215);
    expect(adm.card).toBe(140);
    expect(adm.total).toBe(355);

    // anonymous income items are reported
    const merch = body.gateSalesSummary.lines.find(
      (l: { category: string }) => l.category === "merchandise",
    );
    expect(merch.total).toBe(50);
    expect(
      body.gateSalesSummary.lines.some((l: { category: string }) => l.category === "gift_card"),
    ).toBe(true);
    expect(
      body.gateSalesSummary.lines.some((l: { category: string }) => l.category === "misc_sales"),
    ).toBe(true);

    // named-customer receipts grouped by contact
    const don = body.namedCustomerReceipts.find((r: { kind: string }) => r.kind === "donation");
    expect(don.contact).toBe("Donor A");
    expect(don.amount).toBe(25);
    const mem = body.namedCustomerReceipts.find((r: { kind: string }) => r.kind === "membership");
    expect(mem.contact).toBe("Member B");
    expect(mem.amount).toBe(40);
  });

  it("404s when the event has no door record", async () => {
    const evt = await makeEvent();
    const { status, body } = await report(evt.id);
    expect(status).toBe(404);
    expect(body.error.code).toBe("DOOR_RECORD_NOT_FOUND");
  });

  /** Feature 079 (FR-027, MEG-R10): the treasurer report carries the evening's attendance breakdown. */
  it("carries the attendance breakdown, identical to the door's", async () => {
    const evt = await makeEvent({ seriesKey: "tnc" });
    const drId = await makeDoorRecord(evt.id);
    await updateDoorRecord(db, drId, { grossCash: 100, seedFloat: 0 });
    const caller = await makePerformer("Pat Caller");
    await createBooking(db, evt.id, { performerId: caller.id, performerType: "caller", pay: 0 });
    await recordAttendance(db, evt.id, { contactId: caller.contactId! });
    await recordAttendance(db, evt.id, { unmatched: true, childrenCount: 2, isComp: true });
    for (let i = 0; i < 6; i++) await recordAttendance(db, evt.id, { unmatched: true });

    const { status, body } = await report(evt.id);
    expect(status).toBe(200);
    expect(body.attendance).toEqual(await getAttendanceBreakdown(db, evt.id));
    expect(body.attendance).toMatchObject({ children: 2, performers: { caller: 1 } });
    // Existing fields are unchanged.
    expect(body.compCount).toBe(1);
  });
});
