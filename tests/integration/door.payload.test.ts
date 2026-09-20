import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db, TEST_STAFF_DISPLAY_NAME } from "./helpers/db";
import { jsonReq, jsonReqAs, ctx } from "./helpers/http";
import { makeActor, makeEvent, makeDoorRecord, contactRow } from "./helpers/factories";
import { contacts, doorRecords, gateChecks, gateSales } from "@/server/db/schema";
import { computeEventGate } from "@/server/domain/gate/eventMoney";
import { refreshDeposit } from "@/server/domain/door/doorRecordService";
import { POST as OPEN_DOOR } from "@/app/api/events/[id]/door-record/route";
import { GET as GET_DOOR, PATCH as PATCH_DOOR } from "@/app/api/door-records/[id]/route";

// Feature 082 (contracts/gate.md): what the gate page loads. The door record now carries the evening's
// money worked out — admission by all three sources, the card fee, the checks total and the deposits —
// and the payload carries the checks, each with its lines, beside the other sales.

async function contact(name: string): Promise<string> {
  const [row] = await db.insert(contacts).values(contactRow(name)).returning();
  return row!.id;
}

/** An evening with cash, card, one anonymous sale, one named sale and two checks (one marked). */
async function evening() {
  const event = await makeEvent();
  const dee = await contact("Dee Member");
  const chuck = await contact("Chuck Writer");
  const big = await contact("Big Donor");
  const doorRecordId = await makeDoorRecord(event.id, [
    { category: "merchandise", paymentMethod: "cash", amount: 25 },
    { category: "donation", paymentMethod: "card", amount: 40, contactId: dee },
  ]);
  await db
    .update(doorRecords)
    .set({
      grossCashCents: 50000,
      seedFloatCents: 1500,
      pcGrossCents: 18000,
      posTransactionCount: 9,
      eveningNote: "quiet night",
    })
    .where(eq(doorRecords.id, doorRecordId));

  const [chucks] = await db
    .insert(gateChecks)
    .values({ doorRecordId, writerContactId: chuck, note: "covers Jo too" })
    .returning();
  await db.insert(gateSales).values([
    {
      doorRecordId,
      category: "admission",
      paymentMethod: "check",
      amountCents: 3000,
      checkId: chucks!.id,
      quantity: 2,
    },
    {
      doorRecordId,
      category: "merchandise",
      paymentMethod: "check",
      amountCents: 2500,
      checkId: chucks!.id,
      note: "T-shirt, L",
    },
  ]);
  const [bigs] = await db
    .insert(gateChecks)
    .values({ doorRecordId, writerContactId: big, depositSeparately: true })
    .returning();
  await db.insert(gateSales).values({
    doorRecordId,
    category: "donation",
    paymentMethod: "check",
    amountCents: 50000,
    checkId: bigs!.id,
    contactId: big,
  });
  await refreshDeposit(db, event.id);
  return { eventId: event.id, doorRecordId, chuckCheckId: chucks!.id, bigCheckId: bigs!.id };
}

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

describe("the door-record payload", () => {
  it("opens with the evening's money worked out", async () => {
    const { eventId } = await evening();
    const res = await OPEN_DOOR(
      jsonReq("POST", `/api/events/${eventId}/door-record`),
      ctx({ id: eventId }),
    );
    expect(res.status).toBe(200);
    const { doorRecord } = await res.json();

    expect(doorRecord.admission).toEqual({
      cash: 500 - 15 - 25,
      card: 180 - 40,
      check: 30,
      total: 460 + 140 + 30,
    });
    expect(doorRecord.checksTotal).toBe(55 + 500);
    expect(doorRecord.cardFee).toBeCloseTo((9 * 9 + Math.round(18000 * 0.0229)) / 100, 2);
    expect(doorRecord.eveningNote).toBe("quiet night");
    expect(doorRecord.cashCount).toEqual({});
  });

  it("lists the deposits with what makes each up", async () => {
    const { eventId, bigCheckId } = await evening();
    const res = await OPEN_DOOR(
      jsonReq("POST", `/api/events/${eventId}/door-record`),
      ctx({ id: eventId }),
    );
    const { doorRecord } = await res.json();

    expect(doorRecord.deposits).toEqual([
      {
        kind: "main",
        amount: 500 - 15 + 55,
        makeUp: { countedCash: 500, seedFloat: 15, otherPaidOut: 0, performerCash: 0, checks: 55 },
      },
      { kind: "check", checkId: bigCheckId, writer: "Big Donor", amount: 500 },
    ]);
  });

  it("carries the checks, each with its lines, apart from the other sales", async () => {
    const { eventId, chuckCheckId } = await evening();
    const res = await OPEN_DOOR(
      jsonReq("POST", `/api/events/${eventId}/door-record`),
      ctx({ id: eventId }),
    );
    const body = await res.json();

    // The other sales are the anonymous and named ones — never a check's lines.
    expect(body.gateSales.map((s: { category: string }) => s.category).sort()).toEqual([
      "donation",
      "merchandise",
    ]);
    expect(body.gateSales.every((s: { checkId: string | null }) => s.checkId === null)).toBe(true);

    expect(body.checks).toHaveLength(2);
    const chuck = body.checks.find((c: { id: string }) => c.id === chuckCheckId);
    expect(chuck).toMatchObject({
      writer: "Chuck Writer",
      amount: 55,
      note: "covers Jo too",
      depositSeparately: false,
    });
    expect(chuck.lines).toHaveLength(2);
    expect(chuck.lines.find((l: { category: string }) => l.category === "admission")).toMatchObject(
      { amount: 30, quantity: 2, checkId: chuckCheckId },
    );
    expect(chuck.lines.find((l: { category: string }) => l.category === "merchandise").note).toBe(
      "T-shirt, L",
    );
  });

  it("returns the same payload from the door record's own route", async () => {
    const { eventId, doorRecordId } = await evening();
    const opened = await (
      await OPEN_DOOR(jsonReq("POST", `/api/events/${eventId}/door-record`), ctx({ id: eventId }))
    ).json();
    const got = await (
      await GET_DOOR(jsonReq("GET", `/api/door-records/${doorRecordId}`), ctx({ id: doorRecordId }))
    ).json();
    expect(got).toEqual(opened);
  });

  it("agrees with the money the reports read", async () => {
    const { eventId } = await evening();
    const { doorRecord } = await (
      await OPEN_DOOR(jsonReq("POST", `/api/events/${eventId}/door-record`), ctx({ id: eventId }))
    ).json();
    const gate = await computeEventGate(db, eventId);

    expect(doorRecord.admission.cash * 100).toBe(gate.admissionCashCents);
    expect(doorRecord.admission.card * 100).toBe(gate.admissionCardCents);
    expect(doorRecord.admission.check * 100).toBe(gate.admissionCheckCents);
    expect(doorRecord.checksTotal * 100).toBe(gate.checksCents);
    expect(doorRecord.deposits[0].amount * 100).toBe(gate.depositCents);
  });

  it("names who recorded the money once it is saved", async () => {
    const { eventId, doorRecordId } = await evening();
    let body = await (
      await OPEN_DOOR(jsonReq("POST", `/api/events/${eventId}/door-record`), ctx({ id: eventId }))
    ).json();
    expect(body.doorRecord.moneyRecordedBy).toBeNull();

    await PATCH_DOOR(
      jsonReq("PATCH", `/api/door-records/${doorRecordId}`, { grossCash: 500 }),
      ctx({ id: doorRecordId }),
    );
    body = await (
      await GET_DOOR(jsonReq("GET", `/api/door-records/${doorRecordId}`), ctx({ id: doorRecordId }))
    ).json();
    expect(body.doorRecord.moneyRecordedBy.displayName).toBe(TEST_STAFF_DISPLAY_NAME);
  });

  it("never gives the door the card fee (feature 002 FR-007, SC-003)", async () => {
    // The fee is Mary's to see on the gate page (MARY-R15 Q10) and never the door volunteer's. The door
    // opens the door record too — it needs the record's id to post a sale — so this is enforced here, in
    // the payload, rather than trusted to the check-in page not to render it.
    const { eventId } = await evening();
    const meg = await makeActor({
      email: "meg.door@example.org",
      grants: [{ role: "door_attendant" }],
    });
    const door = await (
      await OPEN_DOOR(
        jsonReqAs(meg.token, "POST", `/api/events/${eventId}/door-record`),
        ctx({ id: eventId }),
      )
    ).json();
    expect(door.doorRecord).not.toHaveProperty("cardFee");

    const gate = await (
      await OPEN_DOOR(jsonReq("POST", `/api/events/${eventId}/door-record`), ctx({ id: eventId }))
    ).json();
    expect(gate.doorRecord).toHaveProperty("cardFee");
  });

  it("returns no checks and the main deposit alone for an evening without checks", async () => {
    const event = await makeEvent();
    const body = await (
      await OPEN_DOOR(jsonReq("POST", `/api/events/${event.id}/door-record`), ctx({ id: event.id }))
    ).json();
    expect(body.checks).toEqual([]);
    expect(body.doorRecord.deposits).toHaveLength(1);
    expect(body.doorRecord.deposits[0].kind).toBe("main");
    expect(body.doorRecord.admission.check).toBe(0);
    expect(body.doorRecord.checksTotal).toBe(0);
  });
});
