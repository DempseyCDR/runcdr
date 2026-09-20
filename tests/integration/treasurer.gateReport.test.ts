import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, jsonReqAs, ctx } from "./helpers/http";
import {
  makeActor,
  makeBand,
  makeEvent,
  makeDoorRecord,
  makePerformer,
  contactRow,
} from "./helpers/factories";
import { eq } from "drizzle-orm";
import { contacts, events, series, venues } from "@/server/db/schema";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { voidPerformerPayment } from "@/server/domain/payments/performerPaymentService";
import { GET as REPORT } from "@/app/api/events/[id]/treasurer-report/route";
import { POST as CREATE_CHECK } from "@/app/api/door-records/[id]/checks/route";
import { POST as CREATE_SALE } from "@/app/api/door-records/[id]/sales/route";
import { PATCH as PATCH_DOOR } from "@/app/api/door-records/[id]/route";
import { POST as CREATE_PAYMENT } from "@/app/api/performer-payments/route";

// Feature 082 US6 (FR-031–FR-036, contracts/gate.md): the treasurer page becomes the evening's gate report.
// Each check is a receipt to the person who wrote it, with what it paid for; the cash is the gate's own; then
// each deposit, matching the bank; and who recorded the money and the payments.

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

async function contact(name: string): Promise<string> {
  const [row] = await db.insert(contacts).values(contactRow(name)).returning();
  return row!.id;
}

const report = async (eventId: string) =>
  (
    await REPORT(jsonReq("GET", `/api/events/${eventId}/treasurer-report`), ctx({ id: eventId }))
  ).json();

/**
 * An evening with cash, card and a cash T-shirt; Chuck's $95 check (admission for two, a T-shirt, a
 * donation for Dee); Big Donor's $500 check banked on its own; a named cash donation; and the evening's note.
 */
async function evening(opts: { recorder?: string } = {}) {
  const event = await makeEvent();
  const doorRecordId = await makeDoorRecord(event.id, [
    { category: "merchandise", paymentMethod: "cash", amount: 25 },
  ]);
  const chuck = await contact("Chuck Writer");
  const dee = await contact("Dee Member");
  const big = await contact("Big Donor");
  const jo = await contact("Jo Friend");
  const as = (method: string, path: string, body: unknown) =>
    opts.recorder ? jsonReqAs(opts.recorder, method, path, body) : jsonReq(method, path, body);

  await PATCH_DOOR(
    as("PATCH", `/api/door-records/${doorRecordId}`, {
      grossCash: 500,
      seedFloat: 15,
      pcGross: 180,
      posTransactionCount: 9,
      eveningNote: "the ice ran out at 9",
    }),
    ctx({ id: doorRecordId }),
  );
  await CREATE_CHECK(
    as("POST", `/api/door-records/${doorRecordId}/checks`, {
      writerContactId: chuck,
      note: "covers Jo too",
      lines: [
        { category: "admission", amount: 30, quantity: 2 },
        { category: "merchandise", amount: 25, note: "T-shirt, L" },
        { category: "donation", amount: 40, contactId: dee, note: "for the sound fund" },
      ],
    }),
    ctx({ id: doorRecordId }),
  );
  await CREATE_CHECK(
    as("POST", `/api/door-records/${doorRecordId}/checks`, {
      writerContactId: big,
      depositSeparately: true,
      lines: [{ category: "donation", amount: 500, contactId: big }],
    }),
    ctx({ id: doorRecordId }),
  );
  await CREATE_SALE(
    as("POST", `/api/door-records/${doorRecordId}/sales`, {
      category: "future_event",
      paymentMethod: "cash",
      amount: 15,
      contactId: jo,
      note: "for the March dance",
    }),
    ctx({ id: doorRecordId }),
  );
  return { eventId: event.id, doorRecordId };
}

describe("checks received (FR-031)", () => {
  it("shows each check as a receipt to its writer, with its lines, notes and class", async () => {
    const { eventId } = await evening();
    const r = await report(eventId);

    expect(r.checksReceived).toHaveLength(2);
    const chuck = r.checksReceived.find((c: { writer: string }) => c.writer === "Chuck Writer");
    expect(chuck).toMatchObject({
      writer: "Chuck Writer",
      amount: 95,
      note: "covers Jo too",
      depositSeparately: false,
    });
    expect(typeof chuck.class).toBe("string");
    expect(chuck.lines).toEqual(
      expect.arrayContaining([
        { category: "admission", amount: 30, quantity: 2, for: null, level: null, note: null },
        {
          category: "merchandise",
          amount: 25,
          quantity: null,
          for: null,
          level: null,
          note: "T-shirt, L",
        },
        {
          category: "donation",
          amount: 40,
          quantity: null,
          for: "Dee Member",
          level: null,
          note: "for the sound fund",
        },
      ]),
    );
    const big = r.checksReceived.find((c: { writer: string }) => c.writer === "Big Donor");
    expect(big.depositSeparately).toBe(true);
  });

  it("does not repeat a check's lines among the named cash and card receipts", async () => {
    const { eventId } = await evening();
    const r = await report(eventId);
    // Jo's cash payment is a named receipt; the donations paid by check are on their checks.
    expect(r.namedCustomerReceipts.map((n: { contact: string }) => n.contact)).toEqual([
      "Jo Friend",
    ]);
    expect(r.namedCustomerReceipts[0].notes).toEqual(["for the March dance"]);
  });

  it("says so plainly when there are none (FR-036)", async () => {
    const event = await makeEvent();
    await makeDoorRecord(event.id);
    const r = await report(event.id);
    expect(r.checksReceived).toEqual([]);
  });
});

describe("the gate sales summary (FR-020)", () => {
  it("counts admission paid by check, and keeps a check's T-shirt out of the card column", async () => {
    const { eventId } = await evening();
    const r = await report(eventId);
    const line = (cat: string) =>
      r.gateSalesSummary.lines.find((l: { category: string }) => l.category === cat);

    // Cash admission: $500 counted − $15 float − the $25 T-shirt − Jo's $15 for a future event.
    expect(line("admission")).toMatchObject({ cash: 445, card: 180, check: 30, total: 655 });
    expect(line("merchandise")).toMatchObject({ cash: 25, card: 0, check: 25, total: 50 });
  });
});

describe("deposits, the evening's note and who recorded it (FR-032, FR-033)", () => {
  it("lists each deposit with what makes it up", async () => {
    const { eventId } = await evening();
    const r = await report(eventId);
    expect(r.deposits).toEqual([
      {
        kind: "main",
        amount: 500 - 15 + 95,
        makeUp: { countedCash: 500, seedFloat: 15, otherPaidOut: 0, performerCash: 0, checks: 95 },
      },
      expect.objectContaining({ kind: "check", writer: "Big Donor", amount: 500 }),
    ]);
  });

  it("carries the evening's note", async () => {
    const { eventId } = await evening();
    expect((await report(eventId)).eveningNote).toBe("the ice ran out at 9");
  });

  it("names who recorded the gate money and who recorded the performer payments", async () => {
    const mary = await makeActor({
      email: "mary.fs@example.org",
      firstName: "Mary",
      lastName: "Fs",
      grants: [{ role: "financial_secretary" }],
    });
    const { eventId } = await evening({ recorder: mary.token });
    const performer = await makePerformer("Pat Caller");
    const booking = await createBooking(
      db,
      eventId,
      { performerId: performer.id, performerType: "caller", pay: 125 },
      "t",
    );
    await CREATE_PAYMENT(
      jsonReqAs(mary.token, "POST", "/api/performer-payments", {
        method: "check",
        checkNumber: "4401",
        eventId,
        payeePerformerId: performer.id,
        lines: [{ bookingId: booking.id, amount: 125 }],
      }),
      ctx(),
    );

    const r = await report(eventId);
    expect(r.recordedBy).toEqual({ gateMoney: "Mary Fs", performerPayments: "Mary Fs" });
  });

  it("names no one for an evening recorded before the gate report said who", async () => {
    const event = await makeEvent();
    await makeDoorRecord(event.id);
    const r = await report(event.id);
    expect(r.recordedBy).toEqual({ gateMoney: null, performerPayments: null });
    expect(r.eveningNote).toBeNull();
  });
});

/**
 * Feature 082 (research R18, R19 — the P1 review): the report laid out as the paper one. Receipts on the
 * left, a line per sale with its payer and its note; expenses on the right, a line per payment with its
 * notes beneath; the header says whose evening it was.
 */
describe("the paper layout (research R18, R19)", () => {
  async function book(eventId: string, name: string, type: string, pay: number, bandId?: string) {
    const performer = await makePerformer(name);
    const booking = await createBooking(
      db,
      eventId,
      { performerId: performer.id, performerType: type as "caller", pay },
      "t",
      bandId ?? null,
    );
    return { performer, booking };
  }

  const pay = async (body: Record<string, unknown>) =>
    (await CREATE_PAYMENT(jsonReq("POST", "/api/performer-payments", body), ctx())).json();

  it("heads the report with the evening and whose it was", async () => {
    const [venue] = await db
      .insert(venues)
      .values({ name: "Faith Lutheran", address: "1 Main" })
      .returning();
    const event = await makeEvent({ venueId: venue!.id });
    await db.update(events).set({ startTime: "19:30" }).where(eq(events.id, event.id));
    await makeDoorRecord(event.id);
    const band = await makeBand("The Trio");
    await book(event.id, "Fiona Fiddle", "musician", 100, band.id);
    await book(event.id, "Cal Caller", "caller", 150);
    await book(event.id, "Sam Sound", "sound_tech", 60);

    const r = await report(event.id);
    const s = await db.query.series.findFirst({ where: eq(series.id, event.seriesId) });
    expect(r.header).toEqual({
      date: event.eventDate,
      startTime: "19:30:00",
      title: s!.name,
      venue: "Faith Lutheran",
      band: "The Trio",
      musicians: [],
      caller: "Cal Caller",
      soundTech: "Sam Sound",
    });
  });

  it("names the musicians, lead first, when no band was booked — and the label over the series", async () => {
    const event = await makeEvent();
    await db.update(events).set({ label: "Gatecheck Test" }).where(eq(events.id, event.id));
    await makeDoorRecord(event.id);
    await book(event.id, "Petra Piano", "musician", 100);
    await book(event.id, "Lena Lead", "lead_musician", 120);

    const { header } = await report(event.id);
    expect(header).toMatchObject({ title: "Gatecheck Test", band: null, venue: null });
    expect(header.musicians).toEqual(["Lead", "Piano"]);
  });

  it("lists every sale as a receipt, a check's lines under its payer, each in its own column", async () => {
    const { eventId } = await evening();
    const { receipts } = await report(eventId);

    expect(receipts.lines).toEqual(
      expect.arrayContaining([
        {
          category: "merchandise",
          quantity: null,
          level: null,
          members: [],
          name: null,
          for: null,
          cash: 25,
          check: 0,
          card: 0,
          notes: [],
        },
        {
          category: "future_event",
          quantity: null,
          level: null,
          members: [],
          name: "Jo Friend",
          for: null,
          cash: 15,
          check: 0,
          card: 0,
          notes: ["for the March dance"],
        },
        {
          category: "admission",
          quantity: 2,
          level: null,
          members: [],
          name: "Chuck Writer",
          for: null,
          cash: 0,
          check: 30,
          card: 0,
          notes: [],
        },
        {
          category: "donation",
          quantity: null,
          level: null,
          members: [],
          name: "Chuck Writer",
          for: "Dee Member",
          cash: 0,
          check: 40,
          card: 0,
          // The note on the check comes after its last line.
          notes: ["for the sound fund", "covers Jo too"],
        },
      ]),
    );
    expect(receipts.lines).toHaveLength(6);
    // Admission in cash and by card is worked out; by check it is among the lines.
    expect(receipts.admission).toEqual({ cash: 445, card: 180 });
    expect(receipts.totals).toEqual({ cash: 485, check: 595, card: 180, total: 1260 });
  });

  it("lists the payments as expenses, voided ones with their reason, and rent unpaid", async () => {
    const venue = (
      await db.insert(venues).values({ name: "Grange Hall", address: "1 Main" }).returning()
    )[0]!;
    const event = await makeEvent({ venueId: venue.id, rentCents: 25000 });
    const earlier = await makeEvent({ eventDate: "2026-06-11" });
    const doorRecordId = await makeDoorRecord(event.id);
    await PATCH_DOOR(
      jsonReq("PATCH", `/api/door-records/${doorRecordId}`, {
        cashPaidOut: 20,
        cashPaidOutReason: "ice",
      }),
      ctx({ id: doorRecordId }),
    );
    const cal = await book(event.id, "Cal Caller", "caller", 175);
    const sam = await book(event.id, "Sam Sound", "sound_tech", 60);
    const eve = await book(earlier.id, "Eve Later", "musician", 90);

    // Cal's check also pays Eve's booking from an earlier evening, and pays Cal less than booked.
    await pay({
      method: "check",
      checkNumber: "1502",
      eventId: event.id,
      payeePerformerId: cal.performer.id,
      overrideReason: "left early",
      lines: [
        { bookingId: cal.booking.id, amount: 150 },
        { bookingId: eve.booking.id, amount: 90 },
      ],
    });
    const wrong = await pay({
      method: "check",
      checkNumber: "1501",
      eventId: event.id,
      payeePerformerId: sam.performer.id,
      lines: [{ bookingId: sam.booking.id, amount: 60 }],
    });
    await voidPerformerPayment(db, wrong.id, "torn");
    await pay({
      method: "cash",
      eventId: event.id,
      payeePerformerId: sam.performer.id,
      lines: [{ bookingId: sam.booking.id, amount: 60 }],
    });

    const r = await report(event.id);
    expect(r.expenses.payments).toEqual([
      {
        role: "sound_tech",
        payee: "Sam Sound",
        checkNumber: "1501",
        cash: false,
        amount: 60,
        voided: true,
        notes: ["Void — torn"],
      },
      {
        role: "caller",
        payee: "Cal Caller",
        checkNumber: "1502",
        cash: false,
        amount: 240,
        voided: false,
        notes: [
          "booked $175.00 · paid $150.00",
          "left early",
          "also pays Eve Later $90.00 (2026-06-11)",
        ],
      },
      {
        role: "sound_tech",
        payee: "Sam Sound",
        checkNumber: null,
        cash: true,
        amount: 60,
        voided: false,
        notes: [],
      },
    ]);
    expect(r.expenses.otherPaidOut).toEqual({ amount: 20, reason: "ice" });
    // The voided check and the rent are out of the totals.
    expect(r.expenses.totals).toEqual({ check: 240, cash: 80, total: 320 });
    expect(r.expenses.rent).toEqual({ vendor: "(no landlord set)", amount: 250, unpaid: true });
    expect(r.paidTonightForEarlier).toEqual([
      { performer: "Eve Later", amount: 90, eventDate: "2026-06-11" },
    ]);
  });

  it("gives the card's gross, transactions and fee", async () => {
    const { eventId } = await evening();
    const { card } = await report(eventId);
    expect(card).toMatchObject({ gross: 180, transactions: 9 });
    expect(card.fee).toBeGreaterThan(0);
  });
});

/**
 * The quickstart walk (§3.3): a membership covers the payer and whoever was added to it. The report reads
 * that from the account the sale opened — the account IS the record — so it shows who it covers today.
 */
describe("who a membership covers", () => {
  it("names the members of the payer's account on the membership line", async () => {
    const event = await makeEvent();
    const doorRecordId = await makeDoorRecord(event.id);
    const will = await contact("Will Payer");
    const rachel = await contact("Rachel Payer");
    const finn = await contact("Finn Payer");
    await CREATE_CHECK(
      jsonReq("POST", `/api/door-records/${doorRecordId}/checks`, {
        writerContactId: will,
        lines: [
          {
            category: "membership",
            amount: 60,
            contactId: will,
            membershipLevel: "family",
            memberContactIds: [rachel, finn],
          },
        ],
      }),
      ctx({ id: doorRecordId }),
    );

    const r = await report(event.id);
    const line = r.receipts.lines.find((l: { category: string }) => l.category === "membership");
    expect(line).toMatchObject({ name: "Will Payer", level: "family" });
    expect([...line.members].sort()).toEqual(["Finn Payer", "Rachel Payer"]);
  });

  it("leaves the members empty on a line that is not a membership", async () => {
    const { eventId } = await evening();
    const r = await report(eventId);
    for (const line of r.receipts.lines) {
      if (line.category !== "membership") expect(line.members).toEqual([]);
    }
  });
});
