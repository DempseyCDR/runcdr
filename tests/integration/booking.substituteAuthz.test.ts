import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReqAs, ctx } from "./helpers/http";
import { makeEvent, makePerformer, makeActor } from "./helpers/factories";
import { bookings } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { createPerformerPayment } from "@/server/domain/payments/performerPaymentService";
import { POST as SUBSTITUTE } from "@/app/api/bookings/[id]/substitute/route";

// Feature 043 (P6-R12): substitution is re-gated so EITHER booking.write (the Booker) OR
// performer_payment.write (the FS) authorizes it — the FS's former 403 is fixed, the Booker keeps access,
// and a volunteer with neither is refused. Semantics (024) are unchanged.
describe("POST /api/bookings/:id/substitute — either-capability authz (043)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function seedBooking(seriesKey = "tnc") {
    const evt = await makeEvent({ seriesKey });
    const orig = await makePerformer("Orig Player");
    const sub = await makePerformer("Sub Player");
    const b = await createBooking(db, evt.id, {
      performerId: orig.id,
      performerType: "lead_musician",
      pay: 100,
    });
    return { evt, orig, sub, b };
  }

  it("the FS (performer_payment.write) can substitute an unpaid booking → clean re-point", async () => {
    const { evt, sub, b } = await seedBooking();
    const { token } = await makeActor({
      email: "fs.sub@cdrochester.org",
      grants: [{ role: "financial_secretary", seriesId: evt.seriesId }],
    });
    const res = await SUBSTITUTE(
      jsonReqAs(token, "POST", `/api/bookings/${b.id}/substitute`, { newPerformerId: sub.id }),
      ctx({ id: b.id }),
    );
    expect(res.status).toBe(201);
    // unpaid → the same booking is re-pointed to the substitute (024 semantics unchanged)
    const row = await db.query.bookings.findFirst({ where: eq(bookings.id, b.id) });
    expect(row?.performerId).toBe(sub.id);
  });

  it("the Booker (booking.write) keeps substitute access → 201", async () => {
    const { evt, sub, b } = await seedBooking();
    const { token } = await makeActor({
      email: "booker.sub@cdrochester.org",
      grants: [{ role: "booker", seriesId: evt.seriesId }],
    });
    const res = await SUBSTITUTE(
      jsonReqAs(token, "POST", `/api/bookings/${b.id}/substitute`, { newPerformerId: sub.id }),
      ctx({ id: b.id }),
    );
    expect(res.status).toBe(201);
  });

  it("a volunteer with neither capability is refused", async () => {
    const { sub, b } = await seedBooking();
    const { token } = await makeActor({
      email: "door.sub@cdrochester.org",
      grants: [{ role: "door_attendant" }],
    });
    const res = await SUBSTITUTE(
      jsonReqAs(token, "POST", `/api/bookings/${b.id}/substitute`, { newPerformerId: sub.id }),
      ctx({ id: b.id }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("live-paid substitution keeps the original as a declined no-show + a fresh booking (024)", async () => {
    const { evt, orig, sub, b } = await seedBooking();
    // make the booking live-paid so the discriminator branch (keep no-show + fresh booking) fires
    await createPerformerPayment(db, {
      method: "cash",
      eventId: evt.id,
      payeePerformerId: orig.id,
      lines: [{ bookingId: b.id, amount: 100 }],
    });
    const { token } = await makeActor({
      email: "fs.sub2@cdrochester.org",
      grants: [{ role: "financial_secretary", seriesId: evt.seriesId }],
    });
    const res = await SUBSTITUTE(
      jsonReqAs(token, "POST", `/api/bookings/${b.id}/substitute`, { newPerformerId: sub.id }),
      ctx({ id: b.id }),
    );
    expect(res.status).toBe(201);
    // original kept as a declined no-show, still pointing at the original performer
    const original = await db.query.bookings.findFirst({ where: eq(bookings.id, b.id) });
    expect(original?.performerId).toBe(orig.id);
    expect(original?.status).toBe("declined");
    // a fresh booking exists for the substitute on the event
    const all = await db.query.bookings.findMany({ where: eq(bookings.eventId, evt.id) });
    expect(all.some((x) => x.performerId === sub.id && x.id !== b.id)).toBe(true);
  });
});
