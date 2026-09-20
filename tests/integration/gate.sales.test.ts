import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db, TEST_STAFF_DISPLAY_NAME } from "./helpers/db";
import { jsonReq, jsonReqAs, ctx } from "./helpers/http";
import { makeActor, makeEvent, makeDoorRecord, contactRow } from "./helpers/factories";
import {
  contacts,
  gateChecks,
  gateSales,
  membershipAccounts,
  membershipMembers,
} from "@/server/db/schema";
import { POST as CREATE_SALE } from "@/app/api/door-records/[id]/sales/route";
import { PATCH as PATCH_SALE, DELETE as DELETE_SALE } from "@/app/api/gate-sales/[id]/route";
import { PATCH as PATCH_DOOR } from "@/app/api/door-records/[id]/route";

// Feature 082 (research R5, FR-026): a named sale is written ONE AT A TIME, as soon as it is recorded, and
// the gate's Save owns only the anonymous totals. That is what stops Mary's Save wiping a sale the door
// recorded while she had the page open (SC-005).

async function contact(name: string): Promise<string> {
  const [row] = await db.insert(contacts).values(contactRow(name)).returning();
  return row!.id;
}

async function evening(): Promise<string> {
  const event = await makeEvent();
  return makeDoorRecord(event.id);
}

function post(doorRecordId: string, body: unknown, token?: string) {
  const path = `/api/door-records/${doorRecordId}/sales`;
  const req = token ? jsonReqAs(token, "POST", path, body) : jsonReq("POST", path, body);
  return CREATE_SALE(req, ctx({ id: doorRecordId }));
}

function patch(saleId: string, body: unknown, token?: string) {
  const path = `/api/gate-sales/${saleId}`;
  const req = token ? jsonReqAs(token, "PATCH", path, body) : jsonReq("PATCH", path, body);
  return PATCH_SALE(req, ctx({ id: saleId }));
}

function remove(saleId: string, token?: string) {
  const path = `/api/gate-sales/${saleId}`;
  const req = token ? jsonReqAs(token, "DELETE", path) : jsonReq("DELETE", path);
  return DELETE_SALE(req, ctx({ id: saleId }));
}

// One DB connection for the file: `closeDb` in a describe's own afterAll would end it for the next.
beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

describe("one named sale at a time", () => {
  it("records a named sale and returns it with who recorded it", async () => {
    const doorRecordId = await evening();
    const dee = await contact("Dee Member");

    const res = await post(doorRecordId, {
      category: "future_event",
      paymentMethod: "cash",
      amount: 15,
      contactId: dee,
      note: "for Jo's ticket next month",
    });

    expect(res.status).toBe(201);
    const sale = await res.json();
    expect(sale).toMatchObject({
      category: "future_event",
      paymentMethod: "cash",
      amount: 15,
      contactId: dee,
      contactName: "Dee Member",
      note: "for Jo's ticket next month",
      checkId: null,
      quantity: null,
    });
    expect(sale.recordedBy.displayName).toBe(TEST_STAFF_DISPLAY_NAME);
  });

  it("creates or renews a membership, as a membership sale always has", async () => {
    const doorRecordId = await evening();
    const dee = await contact("Dee Member");

    const res = await post(doorRecordId, {
      category: "membership",
      paymentMethod: "cash",
      amount: 40,
      contactId: dee,
      membershipLevel: "family",
      note: "Dee and Bo",
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.enrolled).toHaveLength(1);
    expect(body.enrolled[0].contactId).toBe(dee);

    const accounts = await db
      .select()
      .from(membershipAccounts)
      .where(eq(membershipAccounts.payerContactId, dee));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.level).toBe("family");
  });

  it("adds the members named to the payer's membership (quickstart §3.3)", async () => {
    const doorRecordId = await evening();
    const will = await contact("Will Payer");
    const rachel = await contact("Rachel Payer");
    const res = await post(doorRecordId, {
      category: "membership",
      paymentMethod: "cash",
      amount: 60,
      contactId: will,
      membershipLevel: "family",
      memberContactIds: [rachel],
    });
    expect(res.status).toBe(201);
    const account = await db.query.membershipAccounts.findFirst({
      where: eq(membershipAccounts.payerContactId, will),
    });
    const members = await db
      .select({ contactId: membershipMembers.contactId })
      .from(membershipMembers)
      .where(eq(membershipMembers.accountId, account!.id));
    expect(members.map((m) => m.contactId).sort()).toEqual([will, rachel].sort());
  });

  it("refuses admission as a sale — it is derived, or a check's line (FR-020)", async () => {
    const doorRecordId = await evening();
    const res = await post(doorRecordId, {
      category: "admission",
      paymentMethod: "cash",
      amount: 30,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("ADMISSION_NEEDS_CHECK");
  });

  it("corrects and removes one sale without touching the others", async () => {
    const doorRecordId = await evening();
    const dee = await contact("Dee Member");
    const first = await (
      await post(doorRecordId, {
        category: "donation",
        paymentMethod: "cash",
        amount: 10,
        contactId: dee,
      })
    ).json();
    const second = await (
      await post(doorRecordId, {
        category: "donation",
        paymentMethod: "card",
        amount: 20,
        contactId: dee,
      })
    ).json();

    const patched = await patch(first.id, { amount: 12, note: "for the sound fund" });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ amount: 12, note: "for the sound fund" });

    const untouched = await db.query.gateSales.findFirst({ where: eq(gateSales.id, second.id) });
    expect(untouched!.amountCents).toBe(2000);

    const removed = await remove(first.id);
    expect(removed.status).toBe(204);
    const left = await db.select().from(gateSales).where(eq(gateSales.doorRecordId, doorRecordId));
    expect(left.map((s) => s.id)).toEqual([second.id]);
  });

  it("clears a note when it is set to null", async () => {
    const doorRecordId = await evening();
    const dee = await contact("Dee Member");
    const sale = await (
      await post(doorRecordId, {
        category: "donation",
        paymentMethod: "cash",
        amount: 10,
        contactId: dee,
        note: "typo",
      })
    ).json();
    const res = await patch(sale.id, { note: null });
    expect((await res.json()).note).toBeNull();
  });
});

describe("every sale is its own line; the Save carries none (research R16)", () => {
  it("records an anonymous sale on its own, with a quantity and no one named", async () => {
    const doorRecordId = await evening();
    const res = await post(doorRecordId, {
      category: "merchandise",
      paymentMethod: "cash",
      amount: 75,
      quantity: 3,
      note: "T-shirts, 2 M and 1 L",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      category: "merchandise",
      contactId: null,
      quantity: 3,
      amount: 75,
      note: "T-shirts, 2 M and 1 L",
    });
  });

  it("leaves every sale and check alone when the evening's money is saved", async () => {
    const doorRecordId = await evening();
    const dee = await contact("Dee Member");
    const chuck = await contact("Chuck Writer");
    await post(doorRecordId, {
      category: "donation",
      paymentMethod: "cash",
      amount: 10,
      contactId: dee,
    });
    await post(doorRecordId, { category: "merchandise", paymentMethod: "card", amount: 25 });
    const [check] = await db
      .insert(gateChecks)
      .values({ doorRecordId, writerContactId: chuck })
      .returning();
    await db.insert(gateSales).values({
      doorRecordId,
      category: "merchandise",
      paymentMethod: "check",
      amountCents: 2500,
      checkId: check!.id,
    });
    const before = await db
      .select()
      .from(gateSales)
      .where(eq(gateSales.doorRecordId, doorRecordId));

    const saved = await PATCH_DOOR(
      jsonReq("PATCH", `/api/door-records/${doorRecordId}`, {
        grossCash: 500,
        eveningNote: "busy",
      }),
      ctx({ id: doorRecordId }),
    );
    expect(saved.status).toBe(200);

    const after = await db.select().from(gateSales).where(eq(gateSales.doorRecordId, doorRecordId));
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
  });

  it("no longer offers the replace-all route", () => {
    expect(
      existsSync(join(process.cwd(), "src/app/api/door-records/[id]/gate-sales/route.ts")),
    ).toBe(false);
  });
});

describe("the sale that started it (FR-026, SC-005)", () => {
  it("keeps a sale the door records while Mary has the page open, through her Save", async () => {
    const doorRecordId = await evening();
    const dee = await contact("Dee Member");
    const meg = await makeActor({
      email: "meg.door@example.org",
      grants: [{ role: "door_attendant" }],
    });

    // Mary opens the gate page: she has the evening as it stood, with no named sales on it.
    const before = await db
      .select()
      .from(gateSales)
      .where(eq(gateSales.doorRecordId, doorRecordId));
    expect(before).toHaveLength(0);

    // Meanwhile the door records a membership.
    const recorded = await post(
      doorRecordId,
      {
        category: "membership",
        paymentMethod: "cash",
        amount: 25,
        contactId: dee,
        membershipLevel: "individual",
      },
      meg.token,
    );
    expect(recorded.status).toBe(201);
    const doorSale = await recorded.json();

    // Mary saves from her stale page — the money, as the page sends it.
    const money = await PATCH_DOOR(
      jsonReq("PATCH", `/api/door-records/${doorRecordId}`, { grossCash: 500 }),
      ctx({ id: doorRecordId }),
    );
    expect(money.status).toBe(200);

    const after = await db.select().from(gateSales).where(eq(gateSales.doorRecordId, doorRecordId));
    expect(after.some((r) => r.id === doorSale.id)).toBe(true);
  });
});

describe("the door records its own, and only its own (research R6, FR-027)", () => {
  async function doorAttendant(email: string) {
    return makeActor({
      email,
      firstName: "Meg",
      lastName: "Door",
      grants: [{ role: "door_attendant" }],
    });
  }

  it("lets the door record a sale and correct it", async () => {
    const doorRecordId = await evening();
    const dee = await contact("Dee Member");
    const meg = await doorAttendant("meg.door@example.org");

    const created = await post(
      doorRecordId,
      {
        category: "membership",
        paymentMethod: "cash",
        amount: 25,
        contactId: dee,
        membershipLevel: "individual",
      },
      meg.token,
    );
    expect(created.status).toBe(201);
    const sale = await created.json();
    expect(sale.recordedBy.contactId).toBe(meg.contactId);

    const corrected = await patch(sale.id, { note: "renewed at the door" }, meg.token);
    expect(corrected.status).toBe(200);
  });

  it("refuses the door someone else's sale", async () => {
    const doorRecordId = await evening();
    const dee = await contact("Dee Member");
    const meg = await doorAttendant("meg.door@example.org");

    // Recorded by the standing staff session — not Meg.
    const sale = await (
      await post(doorRecordId, {
        category: "donation",
        paymentMethod: "cash",
        amount: 10,
        contactId: dee,
      })
    ).json();

    const patched = await patch(sale.id, { amount: 1 }, meg.token);
    expect(patched.status).toBe(403);
    expect((await patched.json()).error.code).toBe("NOT_YOUR_ENTRY");

    const removed = await remove(sale.id, meg.token);
    expect(removed.status).toBe(403);
    expect((await removed.json()).error.code).toBe("NOT_YOUR_ENTRY");
  });

  it("lets whoever may record gate money correct anyone's, and takes the sale over", async () => {
    const doorRecordId = await evening();
    const dee = await contact("Dee Member");
    const meg = await doorAttendant("meg.door@example.org");
    const sale = await (
      await post(
        doorRecordId,
        { category: "donation", paymentMethod: "cash", amount: 10, contactId: dee },
        meg.token,
      )
    ).json();

    // The standing session holds gate.write (super_user).
    const res = await patch(sale.id, { note: "for the sound fund" });
    expect(res.status).toBe(200);
    expect((await res.json()).recordedBy.displayName).toBe(TEST_STAFF_DISPLAY_NAME);
  });

  it("refuses the door the gate's Save", async () => {
    const doorRecordId = await evening();
    const meg = await doorAttendant("meg.door@example.org");
    const res = await PATCH_DOOR(
      jsonReqAs(meg.token, "PATCH", `/api/door-records/${doorRecordId}`, { grossCash: 5 }),
      ctx({ id: doorRecordId }),
    );
    expect(res.status).toBe(403);
  });

  it("lets the door record an anonymous sale and correct it, but not someone else's", async () => {
    const doorRecordId = await evening();
    const meg = await doorAttendant("meg.door@example.org");
    const mine = await (
      await post(
        doorRecordId,
        { category: "merchandise", paymentMethod: "cash", amount: 25 },
        meg.token,
      )
    ).json();
    expect((await patch(mine.id, { quantity: 1, note: "T-shirt, L" }, meg.token)).status).toBe(200);

    const theirs = await (
      await post(doorRecordId, { category: "gift_card", paymentMethod: "card", amount: 50 })
    ).json();
    const refused = await patch(theirs.id, { amount: 40 }, meg.token);
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe("NOT_YOUR_ENTRY");
  });

  it("refuses someone with neither authority", async () => {
    const doorRecordId = await evening();
    const dee = await contact("Dee Member");
    const booker = await makeActor({ email: "bk@example.org", grants: [{ role: "booker" }] });
    const res = await post(
      doorRecordId,
      { category: "donation", paymentMethod: "cash", amount: 10, contactId: dee },
      booker.token,
    );
    expect(res.status).toBe(403);
  });
});
