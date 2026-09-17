import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makePerformer } from "./helpers/factories";
import { auditEvents, paymentBookings, performerPayments } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import {
  createPerformerPayment,
  deletePerformerPayment,
  listPerformerPayments,
  patchPerformerPayment,
  voidPerformerPayment,
} from "@/server/domain/payments/performerPaymentService";
import { PATCH } from "@/app/api/performer-payments/[id]/route";
import { POST as VOID } from "@/app/api/performer-payments/[id]/void/route";

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

async function evening() {
  const event = await makeEvent();
  const mk = async (name: string, pay: number) => {
    const performer = await makePerformer(name);
    const booking = await createBooking(db, event.id, {
      performerId: performer.id,
      performerType: "musician",
      pay,
    });
    return { performer, booking };
  };
  return {
    event,
    a: await mk("Ann Able", 100),
    b: await mk("Bea Bow", 80),
    c: await mk("Cy Cello", 60),
  };
}

const check = (
  eventId: string,
  payeeId: string,
  lines: { bookingId: string; amount: number }[],
  checkNumber: string,
) =>
  createPerformerPayment(db, {
    eventId,
    payeePerformerId: payeeId,
    method: "check",
    checkNumber,
    lines,
  });

/** Feature 081 (FR-015, SC-003): a check entered by mistake can be corrected, whatever it settles. */
describe("correcting a check (081)", () => {
  it("changes the number, payee, amounts and which bookings a check settles", async () => {
    const { event, a, b, c } = await evening();
    const pay = await check(
      event.id,
      a.performer.id,
      [
        { bookingId: a.booking.id, amount: 100 },
        { bookingId: b.booking.id, amount: 80 },
      ],
      "9001",
    );
    const edited = await patchPerformerPayment(db, pay.id, {
      checkNumber: "9001b",
      payeePerformerId: c.performer.id,
      lines: [
        { bookingId: a.booking.id, amount: 90 },
        { bookingId: b.booking.id, amount: 80 },
        { bookingId: c.booking.id, amount: 60 },
      ],
    });
    expect(edited).toMatchObject({
      checkNumber: "9001B",
      payeePerformerId: c.performer.id,
      amount: 230,
    });
    expect(edited.lines).toHaveLength(3);

    const fewer = await patchPerformerPayment(db, pay.id, {
      lines: [{ bookingId: c.booking.id, amount: 60 }],
    });
    expect(fewer.amount).toBe(60);
  });

  it("refuses a line for a booking another payment settles, and a check with no lines", async () => {
    const { event, a, b } = await evening();
    const first = await check(
      event.id,
      a.performer.id,
      [{ bookingId: a.booking.id, amount: 100 }],
      "9001",
    );
    await check(event.id, b.performer.id, [{ bookingId: b.booking.id, amount: 80 }], "9002");
    await expect(
      patchPerformerPayment(db, first.id, {
        lines: [
          { bookingId: a.booking.id, amount: 100 },
          { bookingId: b.booking.id, amount: 80 },
        ],
      }),
    ).rejects.toMatchObject({ code: "BOOKING_ALREADY_PAID" });

    const res = await PATCH(
      jsonReq("PATCH", `/api/performer-payments/${first.id}`, { lines: [] }),
      ctx({ id: first.id }),
    );
    expect(res.status).toBe(422);
  });

  it("does not edit a voided check", async () => {
    const { event, a } = await evening();
    const pay = await check(
      event.id,
      a.performer.id,
      [{ bookingId: a.booking.id, amount: 100 }],
      "9001",
    );
    await voidPerformerPayment(db, pay.id, "wrong amount");
    await expect(patchPerformerPayment(db, pay.id, { checkNumber: "9002" })).rejects.toMatchObject({
      code: "ALREADY_VOIDED",
    });
  });
});

/** Feature 081 (FR-019–FR-022, FR-034): voiding once, with a reason, and replacing. */
describe("voiding a check (081)", () => {
  it("needs a reason, stops the lines counting, and happens only once", async () => {
    const { event, a } = await evening();
    const pay = await check(
      event.id,
      a.performer.id,
      [{ bookingId: a.booking.id, amount: 100 }],
      "9001",
    );

    const blank = await VOID(
      jsonReq("POST", `/api/performer-payments/${pay.id}/void`, { reason: "  " }),
      ctx({ id: pay.id }),
    );
    expect(blank.status).toBe(422);

    const voided = await voidPerformerPayment(db, pay.id, "wrong amount");
    expect(voided).toMatchObject({ voided: true, voidReason: "wrong amount" });
    const lines = await db
      .select()
      .from(paymentBookings)
      .where(eq(paymentBookings.paymentId, pay.id));
    expect(lines.every((l) => !l.live)).toBe(true);

    await expect(voidPerformerPayment(db, pay.id, "again")).rejects.toMatchObject({
      code: "ALREADY_VOIDED",
    });
    const [row] = await db.select().from(performerPayments).where(eq(performerPayments.id, pay.id));
    expect(row!.voidReason).toBe("wrong amount");
    expect(row!.voidedAt?.toISOString()).toBe(voided.voidedAt);
  });

  it("does not void cash", async () => {
    const { event, a } = await evening();
    const cash = await createPerformerPayment(db, {
      eventId: event.id,
      payeePerformerId: a.performer.id,
      method: "cash",
      lines: [{ bookingId: a.booking.id, amount: 100 }],
    });
    await expect(voidPerformerPayment(db, cash.id, "oops")).rejects.toMatchObject({
      code: "CASH_NOT_VOIDABLE",
    });
  });

  it("links a new payment to the voided check it replaces — the latest one", async () => {
    const { event, a } = await evening();
    const first = await check(
      event.id,
      a.performer.id,
      [{ bookingId: a.booking.id, amount: 100 }],
      "9001",
    );
    await voidPerformerPayment(db, first.id, "lost");
    const second = await check(
      event.id,
      a.performer.id,
      [{ bookingId: a.booking.id, amount: 100 }],
      "9002",
    );
    expect(second.replacesPaymentId).toBe(first.id);
    await voidPerformerPayment(db, second.id, "wrong amount");
    const third = await check(
      event.id,
      a.performer.id,
      [{ bookingId: a.booking.id, amount: 100 }],
      "9003",
    );
    expect(third.replacesPaymentId).toBe(second.id);

    const [firstNow] = await db
      .select()
      .from(performerPayments)
      .where(eq(performerPayments.id, first.id));
    expect(firstNow!.replacesPaymentId).toBeNull();
    const list = await listPerformerPayments(db, event.id);
    expect(list.payments.find((p) => p.id === second.id)?.replacedByCheckNumber).toBe("9003");
  });
});

/** Feature 081 (FR-016, FR-034): deleting a payment that was never made, on the record. */
describe("deleting a payment (081)", () => {
  it("erases it and its lines, and records what was erased", async () => {
    const { event, a, b } = await evening();
    const pay = await check(
      event.id,
      a.performer.id,
      [
        { bookingId: a.booking.id, amount: 100 },
        { bookingId: b.booking.id, amount: 80 },
      ],
      "9001",
    );
    await deletePerformerPayment(db, pay.id);
    expect(await db.select().from(performerPayments)).toHaveLength(0);
    expect(await db.select().from(paymentBookings)).toHaveLength(0);

    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.kind, "performer_payment.deleted"));
    expect(audit!.details).toMatchObject({
      paymentId: pay.id,
      eventId: event.id,
      method: "check",
      checkNumber: "9001",
      amount: 180,
    });
    expect((audit!.details as { lines: unknown[] }).lines).toEqual(
      expect.arrayContaining([
        { bookingId: a.booking.id, amount: 100 },
        { bookingId: b.booking.id, amount: 80 },
      ]),
    );
  });

  it("does not delete a voided check", async () => {
    const { event, a } = await evening();
    const pay = await check(
      event.id,
      a.performer.id,
      [{ bookingId: a.booking.id, amount: 100 }],
      "9001",
    );
    await voidPerformerPayment(db, pay.id, "lost");
    await expect(deletePerformerPayment(db, pay.id)).rejects.toMatchObject({
      code: "ALREADY_VOIDED",
    });
  });
});
