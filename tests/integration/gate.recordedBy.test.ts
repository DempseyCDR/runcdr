import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, jsonReqAs, ctx } from "./helpers/http";
import {
  makeActor,
  makeEvent,
  makeDoorRecord,
  makePerformer,
  contactRow,
} from "./helpers/factories";
import {
  auditEvents,
  contacts,
  doorRecords,
  gateSales,
  performerPayments,
  staffIdentities,
} from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { PATCH as PATCH_DOOR } from "@/app/api/door-records/[id]/route";
import { POST as CREATE_SALE } from "@/app/api/door-records/[id]/sales/route";
import { POST as CREATE_PAYMENT } from "@/app/api/performer-payments/route";
import { PATCH as PATCH_PAYMENT } from "@/app/api/performer-payments/[id]/route";

// Feature 082 (FR-033/FR-034, research R7): the gate report names who recorded the gate money and who
// recorded the performer payments. A column on each thing the report names is what the report can read in
// one query; the durable audit rows are the trail, and they now name the volunteer, not "door" or "admin".

/** The contact the standing test session signs in as. */
async function standingContactId(): Promise<string> {
  const [row] = await db.select({ contactId: staffIdentities.contactId }).from(staffIdentities);
  return row!.contactId;
}

async function financialSecretary(email: string) {
  return makeActor({
    email,
    firstName: "Mary",
    lastName: "Fs",
    grants: [{ role: "financial_secretary" }],
  });
}

function saveMoney(doorRecordId: string, body: unknown, token?: string) {
  const path = `/api/door-records/${doorRecordId}`;
  const req = token ? jsonReqAs(token, "PATCH", path, body) : jsonReq("PATCH", path, body);
  return PATCH_DOOR(req, ctx({ id: doorRecordId }));
}

async function auditFor(kind: string) {
  return db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.kind, kind as (typeof auditEvents.$inferSelect)["kind"]));
}

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

describe("who recorded the gate money", () => {
  it("records the person who saves the evening's money", async () => {
    const event = await makeEvent();
    const doorRecordId = await makeDoorRecord(event.id);

    const res = await saveMoney(doorRecordId, { grossCash: 500 });
    expect(res.status).toBe(200);

    const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, doorRecordId) });
    expect(row!.moneyRecordedByContactId).toBe(await standingContactId());
  });

  it("names the last person to save it when someone else saves after", async () => {
    const event = await makeEvent();
    const doorRecordId = await makeDoorRecord(event.id);
    const mary = await financialSecretary("mary.fs@example.org");

    await saveMoney(doorRecordId, { grossCash: 500 });
    const res = await saveMoney(doorRecordId, { grossCash: 510 }, mary.token);
    expect(res.status).toBe(200);

    const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, doorRecordId) });
    expect(row!.moneyRecordedByContactId).toBe(mary.contactId);
  });

  it("writes a durable audit row naming the volunteer, not a placeholder", async () => {
    const event = await makeEvent();
    const doorRecordId = await makeDoorRecord(event.id);
    const mary = await financialSecretary("mary.fs@example.org");

    await saveMoney(doorRecordId, { grossCash: 500 }, mary.token);

    const rows = await auditFor("door_record.updated");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorContactId).toBe(mary.contactId);
  });
});

describe("who recorded a sale", () => {
  it("records the person who records a named sale, with an audit row", async () => {
    const event = await makeEvent();
    const doorRecordId = await makeDoorRecord(event.id);
    const [dee] = await db.insert(contacts).values(contactRow("Dee Member")).returning();
    const mary = await financialSecretary("mary.fs@example.org");

    const res = await CREATE_SALE(
      jsonReqAs(mary.token, "POST", `/api/door-records/${doorRecordId}/sales`, {
        category: "donation",
        paymentMethod: "cash",
        amount: 10,
        contactId: dee!.id,
      }),
      ctx({ id: doorRecordId }),
    );
    const sale = await res.json();

    const row = await db.query.gateSales.findFirst({ where: eq(gateSales.id, sale.id) });
    expect(row!.recordedByContactId).toBe(mary.contactId);
    const audit = await auditFor("gate_sale.created");
    expect(audit[0]!.actorContactId).toBe(mary.contactId);
  });
});

describe("who recorded a performer payment", () => {
  async function payable() {
    const event = await makeEvent();
    const performer = await makePerformer("Pat Caller");
    const booking = await createBooking(
      db,
      event.id,
      { performerId: performer.id, performerType: "caller", pay: 125 },
      "t",
    );
    return { event, performer, booking };
  }

  it("records the person who records a payment, and whoever changes it later", async () => {
    const { event, performer, booking } = await payable();
    const mary = await financialSecretary("mary.fs@example.org");

    const created = await CREATE_PAYMENT(
      jsonReqAs(mary.token, "POST", "/api/performer-payments", {
        method: "check",
        checkNumber: "1501",
        eventId: event.id,
        payeePerformerId: performer.id,
        lines: [{ bookingId: booking.id, amount: 125 }],
      }),
      ctx(),
    );
    expect(created.status).toBe(201);
    const payment = await created.json();

    let row = await db.query.performerPayments.findFirst({
      where: eq(performerPayments.id, payment.id),
    });
    expect(row!.recordedByContactId).toBe(mary.contactId);

    // Someone else corrects it — the report now names them.
    const patched = await PATCH_PAYMENT(
      jsonReq("PATCH", `/api/performer-payments/${payment.id}`, { checkNumber: "1502" }),
      ctx({ id: payment.id }),
    );
    expect(patched.status).toBe(200);
    row = await db.query.performerPayments.findFirst({
      where: eq(performerPayments.id, payment.id),
    });
    expect(row!.recordedByContactId).toBe(await standingContactId());
  });

  it("writes durable audit rows naming the volunteer", async () => {
    const { event, performer, booking } = await payable();
    const mary = await financialSecretary("mary.fs@example.org");

    const created = await CREATE_PAYMENT(
      jsonReqAs(mary.token, "POST", "/api/performer-payments", {
        method: "cash",
        eventId: event.id,
        payeePerformerId: performer.id,
        lines: [{ bookingId: booking.id, amount: 125 }],
      }),
      ctx(),
    );
    const payment = await created.json();

    const rows = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.kind, "performer_payment.created"),
          eq(auditEvents.actorContactId, mary.contactId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.details).toMatchObject({ paymentId: payment.id });
  });
});
