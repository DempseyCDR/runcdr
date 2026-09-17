import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReqAs, ctx } from "./helpers/http";
import { makeActor, makeEvent, makePerformer } from "./helpers/factories";
import { bookings, series } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { createPerformerPayment } from "@/server/domain/payments/performerPaymentService";
import { POST as DONATE } from "@/app/api/bookings/[id]/donate/route";

// Feature 030 (FR-007/008): the FS donates a performer's fee at settlement — flips the booking to donated
// via performer_payment.write (NOT booking.write), scoped to the event's series, refusing a live-paid or
// already-donated booking.
async function seriesId(key: string): Promise<string> {
  const row = await db.query.series.findFirst({ where: eq(series.key, key) });
  if (!row) throw new Error(`series ${key} not seeded`);
  return row.id;
}

describe("donate-at-settlement (030 US3)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function fsFor(key: string) {
    const { token } = await makeActor({
      email: `fs-${key}@cdrochester.org`,
      grants: [{ role: "financial_secretary", seriesId: await seriesId(key) }],
    });
    return token;
  }

  async function bookPaid(key = "tnc", pay = 125) {
    const evt = await makeEvent({ seriesKey: key });
    const p = await makePerformer("Lead Larry");
    const b = await createBooking(db, evt.id, {
      performerId: p.id,
      performerType: "lead_musician",
      pay,
    });
    return { evt, p, b };
  }

  const donate = (token: string, bookingId: string) =>
    DONATE(jsonReqAs(token, "POST", `/api/bookings/${bookingId}/donate`), ctx({ id: bookingId }));

  it("flips the booking to donated (is_donated, pay 0, no check) with payment-write, not booking-write", async () => {
    const { b } = await bookPaid();
    const res = await donate(await fsFor("tnc"), b.id);
    expect(res.status).toBe(200);

    const row = await db.query.bookings.findFirst({ where: eq(bookings.id, b.id) });
    expect(row?.isDonated).toBe(true);
    expect(row?.payCents).toBe(0);
    expect(row?.requiresCheck).toBe(false);
  });

  it("is refused for an FS scoped to a different series (performer_payment scope)", async () => {
    const { b } = await bookPaid("tnc");
    const res = await donate(await fsFor("ecd"), b.id); // wrong series
    expect(res.status).toBe(403);
    const row = await db.query.bookings.findFirst({ where: eq(bookings.id, b.id) });
    expect(row?.isDonated).toBe(false); // unchanged
  });

  it("refuses a booking already settled by a live check (void first)", async () => {
    const { evt, p, b } = await bookPaid();
    await createPerformerPayment(db, {
      method: "check",
      eventId: evt.id,
      payeePerformerId: p.id,
      checkNumber: "1001",
      lines: [{ bookingId: b.id, amount: 125 }],
    });
    const res = await donate(await fsFor("tnc"), b.id);
    expect(res.status).toBe(422);
  });

  it("refuses an already-donated booking", async () => {
    const { b } = await bookPaid();
    const token = await fsFor("tnc");
    expect((await donate(token, b.id)).status).toBe(200);
    expect((await donate(token, b.id)).status).toBe(422);
  });
});
