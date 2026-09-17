import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReqAs, ctx } from "./helpers/http";
import { makeActor, makeDoorRecord, makeEvent, makePerformer } from "./helpers/factories";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { bookings, series } from "@/server/db/schema";
import { POST as CREATE } from "@/app/api/performer-payments/route";
import { PATCH, DELETE } from "@/app/api/performer-payments/[id]/route";
import { GET as LIST } from "@/app/api/events/[id]/performer-payments/route";
import {
  createPerformerPayment,
  listPerformerPayments,
  voidPerformerPayment,
} from "@/server/domain/payments/performerPaymentService";
import { assembleTreasurerReport } from "@/server/domain/treasurer/reportService";

async function seriesId(key: string): Promise<string> {
  const s = await db.query.series.findFirst({ where: eq(series.key, key) });
  if (!s) throw new Error(`series ${key} missing`);
  return s.id;
}

// Feature 019 US2 + 023: actual disbursements, separate from bookings. Substitute payee, one check across
// bookings (per-line amounts), cross-event settlement (023); booked pay_cents never altered; reconciliation.
afterAll(closeDb);

describe("performer payments", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);

  async function fsToken() {
    const { token } = await makeActor({
      email: "fs@ex.com",
      grants: [{ role: "financial_secretary", seriesId: await seriesId("tnc") }],
    });
    return token;
  }

  async function book(eventId: string, performerId: string, pay: number) {
    return createBooking(db, eventId, { performerId, performerType: "musician", pay }, "test");
  }

  it("records a payment to a SUBSTITUTE payee without touching the booking", async () => {
    const token = await fsToken();
    const event = await makeEvent();
    const booked = await makePerformer("Booked Betty");
    const sub = await makePerformer("Substitute Sue");
    const b = await book(event.id, booked.id, 125);

    const res = await CREATE(
      jsonReqAs(token, "POST", "/api/performer-payments", {
        method: "check",
        eventId: event.id,
        payeePerformerId: sub.id,
        checkNumber: "1001",
        overrideReason: "Betty snowed in",
        lines: [{ bookingId: b.id, amount: 125 }],
      }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.payeePerformerId).toBe(sub.id);
    expect(body.amount).toBe(125); // total = Σ lines

    // FR-007 / SC-003: the booking's rate is unchanged.
    const row = await db.query.bookings.findFirst({ where: eq(bookings.id, b.id) });
    expect(row?.payCents).toBe(12500);
    expect(row?.performerId).toBe(booked.id);
  });

  it("aggregates several bookings under one check, with per-line amounts summing to the total", async () => {
    const token = await fsToken();
    const event = await makeEvent();
    const p1 = await makePerformer("P1");
    const p2 = await makePerformer("P2");
    const b1 = await book(event.id, p1.id, 125);
    const b2 = await book(event.id, p2.id, 125);

    const res = await CREATE(
      jsonReqAs(token, "POST", "/api/performer-payments", {
        method: "check",
        eventId: event.id,
        payeePerformerId: p1.id, // one check to the lead
        checkNumber: "1002",
        lines: [
          { bookingId: b1.id, amount: 125 },
          { bookingId: b2.id, amount: 125 },
        ],
      }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.lines).toHaveLength(2);
    expect(body.amount).toBe(250); // SC-002: total = Σ line amounts
  });

  it("accepts a booking from a different event (cross-event delayed check, 023)", async () => {
    const token = await fsToken();
    const event = await makeEvent(); // the check is written/recorded here
    const other = await makeEvent({ eventDate: "2026-06-25" }); // the booking was performed here
    const p = await makePerformer("P");
    const bOther = await book(other.id, p.id, 100);

    const res = await CREATE(
      jsonReqAs(token, "POST", "/api/performer-payments", {
        method: "cash",
        eventId: event.id,
        payeePerformerId: p.id,
        lines: [{ bookingId: bOther.id, amount: 100 }],
      }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.eventId).toBe(event.id); // recorded-at = the writing event
    expect(body.lines[0].bookingId).toBe(bOther.id); // line settles the past booking
    // Feature 081 (T010): the view says how it was paid and what each line settles, where and for what.
    expect(body).toMatchObject({
      method: "cash",
      checkNumber: null,
      voidedAt: null,
      replacedByCheckNumber: null,
    });
    expect(body.lines[0]).toEqual({
      bookingId: bOther.id,
      amount: 100,
      booked: 100,
      eventId: other.id,
      eventDate: "2026-06-25",
      performer: "P",
      performerType: "musician",
    });
  });

  it("GET lists payments with a reconciliation delta", async () => {
    const token = await fsToken();
    const event = await makeEvent();
    const p = await makePerformer("P");
    const b = await book(event.id, p.id, 125); // expected 12500
    await CREATE(
      jsonReqAs(token, "POST", "/api/performer-payments", {
        method: "cash",
        eventId: event.id,
        payeePerformerId: p.id,
        lines: [{ bookingId: b.id, amount: 100 }], // actual under expected → delta -25
      }),
      ctx(),
    );
    const res = await LIST(
      jsonReqAs(token, "GET", `/api/events/${event.id}/performer-payments`),
      ctx({ id: event.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.payments).toHaveLength(1);
    expect(body.reconciliation).toEqual({ expected: 125, actual: 100, delta: -25 });
  });

  it("PATCH replaces the allocation lines", async () => {
    const token = await fsToken();
    const event = await makeEvent();
    const p1 = await makePerformer("P1");
    const p2 = await makePerformer("P2");
    const b1 = await book(event.id, p1.id, 125);
    const b2 = await book(event.id, p2.id, 125);
    const created = await (
      await CREATE(
        jsonReqAs(token, "POST", "/api/performer-payments", {
          method: "cash",
          eventId: event.id,
          payeePerformerId: p1.id,
          lines: [{ bookingId: b1.id, amount: 125 }],
        }),
        ctx(),
      )
    ).json();

    const res = await PATCH(
      jsonReqAs(token, "PATCH", `/api/performer-payments/${created.id}`, {
        lines: [{ bookingId: b2.id, amount: 125 }],
      }),
      ctx({ id: created.id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].bookingId).toBe(b2.id);
  });

  it("DELETE removes the payment and its links", async () => {
    const token = await fsToken();
    const event = await makeEvent();
    const p = await makePerformer("P");
    const b = await book(event.id, p.id, 125);
    const created = await (
      await CREATE(
        jsonReqAs(token, "POST", "/api/performer-payments", {
          method: "cash",
          eventId: event.id,
          payeePerformerId: p.id,
          lines: [{ bookingId: b.id, amount: 125 }],
        }),
        ctx(),
      )
    ).json();
    const res = await DELETE(
      jsonReqAs(token, "DELETE", `/api/performer-payments/${created.id}`),
      ctx({ id: created.id }),
    );
    expect(res.status).toBe(204);
  });

  it("refuses an FS scoped to a DIFFERENT series (layer-2 scope)", async () => {
    const { token } = await makeActor({
      email: "fsecd@ex.com",
      grants: [{ role: "financial_secretary", seriesId: await seriesId("ecd") }],
    });
    const event = await makeEvent({ seriesKey: "tnc" }); // FS holds ecd, not tnc
    const p = await makePerformer("P");
    const b = await book(event.id, p.id, 125);
    const res = await CREATE(
      jsonReqAs(token, "POST", "/api/performer-payments", {
        method: "cash",
        eventId: event.id,
        payeePerformerId: p.id,
        lines: [{ bookingId: b.id, amount: 125 }],
      }),
      ctx(),
    );
    expect(res.status).toBe(403);
  });
});

/**
 * Feature 081 (FR-017, FR-021, research R17): the list shows voided checks under the bookings they settled,
 * wherever they were recorded, and when the treasurer report was last generated.
 */
describe("performer payments list — voids and the treasurer report (081)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);

  it("lists voided checks by booking, and the latest treasurer report", async () => {
    const tonight = await makeEvent({ eventDate: "2026-06-18" });
    const later = await makeEvent({ eventDate: "2026-06-25" });
    const p = await makePerformer("Pat Fiddle");
    const b = await createBooking(db, tonight.id, {
      performerId: p.id,
      performerType: "musician",
      pay: 100,
    });
    const here = await createPerformerPayment(db, {
      eventId: tonight.id,
      payeePerformerId: p.id,
      method: "check",
      checkNumber: "9001",
      lines: [{ bookingId: b.id, amount: 100 }],
    });
    await voidPerformerPayment(db, here.id, "wrong amount");
    const elsewhere = await createPerformerPayment(db, {
      eventId: later.id,
      payeePerformerId: p.id,
      method: "check",
      checkNumber: "9002",
      lines: [{ bookingId: b.id, amount: 100 }],
    });
    await voidPerformerPayment(db, elsewhere.id, "lost");

    let list = await listPerformerPayments(db, tonight.id);
    expect(list.voidedByBooking[b.id]).toEqual([
      { paymentId: here.id, checkNumber: "9001", reason: "wrong amount" },
      { paymentId: elsewhere.id, checkNumber: "9002", reason: "lost" },
    ]);
    expect(list.treasurerReportGeneratedAt).toBeNull();

    await makeDoorRecord(tonight.id);
    await assembleTreasurerReport(db, tonight.id, "t");
    list = await listPerformerPayments(db, tonight.id);
    expect(list.treasurerReportGeneratedAt).toEqual(expect.any(String));
  });
});
