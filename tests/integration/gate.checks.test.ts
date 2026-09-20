import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql as dsql } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db, TEST_STAFF_DISPLAY_NAME } from "./helpers/db";
import { jsonReq, jsonReqAs, ctx } from "./helpers/http";
import { makeActor, makeEvent, makeDoorRecord, contactRow } from "./helpers/factories";
import {
  auditEvents,
  contacts,
  doorRecords,
  gateChecks,
  gateSales,
  membershipAccounts,
  membershipMembers,
} from "@/server/db/schema";
import { POST as CREATE_CHECK } from "@/app/api/door-records/[id]/checks/route";
import { PATCH as PATCH_CHECK, DELETE as DELETE_CHECK } from "@/app/api/gate-checks/[id]/route";
import { DELETE as DELETE_SALE } from "@/app/api/gate-sales/[id]/route";
import { explainCheckViolation } from "@/server/domain/door/gateCheckService";
import { ApiError } from "@/server/lib/apiError";

// Feature 082 US3 (FR-014–FR-023, research R1): each check received, recorded against its writer with a
// line for each thing it pays for. Its lines ARE gate sales, paid by check; its amount is their sum.

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

async function contact(name: string): Promise<string> {
  const [row] = await db.insert(contacts).values(contactRow(name)).returning();
  return row!.id;
}

async function evening(): Promise<{ eventId: string; doorRecordId: string }> {
  const event = await makeEvent();
  return { eventId: event.id, doorRecordId: await makeDoorRecord(event.id) };
}

function post(doorRecordId: string, body: unknown, token?: string) {
  const path = `/api/door-records/${doorRecordId}/checks`;
  const req = token ? jsonReqAs(token, "POST", path, body) : jsonReq("POST", path, body);
  return CREATE_CHECK(req, ctx({ id: doorRecordId }));
}
function patch(checkId: string, body: unknown, token?: string) {
  const path = `/api/gate-checks/${checkId}`;
  const req = token ? jsonReqAs(token, "PATCH", path, body) : jsonReq("PATCH", path, body);
  return PATCH_CHECK(req, ctx({ id: checkId }));
}
function remove(checkId: string, token?: string) {
  const path = `/api/gate-checks/${checkId}`;
  const req = token ? jsonReqAs(token, "DELETE", path) : jsonReq("DELETE", path);
  return DELETE_CHECK(req, ctx({ id: checkId }));
}

/** The check a dancer hands over: admission for two, a T-shirt, and a donation for Dee (spec US3). */
const chucksCheck = (writerContactId: string, dee: string) => ({
  writerContactId,
  note: "covers Jo too",
  lines: [
    { category: "admission", amount: 30, quantity: 2 },
    { category: "merchandise", amount: 25, note: "T-shirt, L" },
    { category: "donation", amount: 40, contactId: dee, note: "for the sound fund" },
  ],
});

describe("recording a check received", () => {
  it("records the check with its lines, its amount their sum, and who recorded it (FR-014, FR-017)", async () => {
    const { doorRecordId } = await evening();
    const chuck = await contact("Chuck Writer");
    const dee = await contact("Dee Member");

    const res = await post(doorRecordId, chucksCheck(chuck, dee));
    expect(res.status).toBe(201);
    const check = await res.json();
    expect(check).toMatchObject({
      writerContactId: chuck,
      writer: "Chuck Writer",
      amount: 95,
      note: "covers Jo too",
      depositSeparately: false,
    });
    expect(check.recordedBy.displayName).toBe(TEST_STAFF_DISPLAY_NAME);
    expect(check.lines).toHaveLength(3);
    expect(check.lines.every((l: { checkId: string }) => l.checkId === check.id)).toBe(true);
    expect(check.lines.find((l: { category: string }) => l.category === "admission")).toMatchObject(
      {
        amount: 30,
        quantity: 2,
      },
    );

    const rows = await db.select().from(gateSales).where(eq(gateSales.checkId, check.id));
    expect(rows.every((r) => r.paymentMethod === "check")).toBe(true);
  });

  it("creates or renews a membership from a membership line (FR-018)", async () => {
    const { doorRecordId } = await evening();
    const newt = await contact("Newt Payer");
    const res = await post(doorRecordId, {
      writerContactId: newt,
      lines: [{ category: "membership", amount: 40, contactId: newt, membershipLevel: "family" }],
    });
    expect(res.status).toBe(201);
    expect((await res.json()).enrolled).toHaveLength(1);
    const account = await db.query.membershipAccounts.findFirst({
      where: eq(membershipAccounts.payerContactId, newt),
    });
    expect(account!.level).toBe("family");
  });

  // The quickstart walk (§3.3): the payer is always in the membership they pay for, and naming others
  // adds them to it — Will pays, and Rachel and Finn are members with him.
  it("makes the payer the membership's owner and a member, and adds each member named", async () => {
    const { doorRecordId } = await evening();
    const will = await contact("Will Payer");
    const rachel = await contact("Rachel Payer");
    const finn = await contact("Finn Payer");
    const res = await post(doorRecordId, {
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
    });
    expect(res.status).toBe(201);
    const account = await db.query.membershipAccounts.findFirst({
      where: eq(membershipAccounts.payerContactId, will),
    });
    expect(account!.level).toBe("family");
    const members = await db
      .select({ contactId: membershipMembers.contactId })
      .from(membershipMembers)
      .where(eq(membershipMembers.accountId, account!.id));
    expect(members.map((m) => m.contactId).sort()).toEqual([will, rachel, finn].sort());
  });

  it("gives the membership to the check's payer even when a line names someone else", async () => {
    const { doorRecordId } = await evening();
    const newt = await contact("Newt Payer");
    const dee = await contact("Dee Member");
    const res = await post(doorRecordId, {
      writerContactId: newt,
      lines: [{ category: "membership", amount: 40, contactId: dee, membershipLevel: "family" }],
    });
    expect(res.status).toBe(201);
    expect(
      await db.query.membershipAccounts.findFirst({
        where: eq(membershipAccounts.payerContactId, dee),
      }),
    ).toBeUndefined();
    expect(
      await db.query.membershipAccounts.findFirst({
        where: eq(membershipAccounts.payerContactId, newt),
      }),
    ).toBeDefined();
  });

  it("refuses members on an individual membership, and records nothing", async () => {
    const { doorRecordId } = await evening();
    const will = await contact("Will Payer");
    const rachel = await contact("Rachel Payer");
    const res = await post(doorRecordId, {
      writerContactId: will,
      lines: [
        {
          category: "membership",
          amount: 30,
          contactId: will,
          membershipLevel: "individual",
          memberContactIds: [rachel],
        },
      ],
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("LEVEL_ADMITS_NO_MEMBERS");
    expect(await db.select().from(gateChecks)).toHaveLength(0);
    expect(await db.select().from(membershipAccounts)).toHaveLength(0);
  });

  it("refuses a check with no lines (FR-017)", async () => {
    const { doorRecordId } = await evening();
    const chuck = await contact("Chuck Writer");
    const res = await post(doorRecordId, { writerContactId: chuck, lines: [] });
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("CHECK_NEEDS_LINES");
  });

  // Research R17: "How many?" is optional on admission — the count only reads the writer's intent.
  it("takes an admission line with no count, and refuses a count of zero", async () => {
    const { doorRecordId } = await evening();
    const chuck = await contact("Chuck Writer");
    const ok = await post(doorRecordId, {
      writerContactId: chuck,
      lines: [{ category: "admission", amount: 30 }],
    });
    expect(ok.status).toBe(201);
    const zero = await post(doorRecordId, {
      writerContactId: chuck,
      lines: [{ category: "admission", amount: 30, quantity: 0 }],
    });
    expect(zero.status).toBe(422);
  });

  it("refuses a writer who is not a contact (FR-015)", async () => {
    const { doorRecordId } = await evening();
    const res = await post(doorRecordId, {
      writerContactId: "00000000-0000-4000-8000-0000000000ff",
      lines: [{ category: "merchandise", amount: 25 }],
    });
    expect(res.status).toBe(404);
  });

  it("puts the check in the deposit, and a marked one in its own (FR-021, FR-022)", async () => {
    const { eventId, doorRecordId } = await evening();
    const chuck = await contact("Chuck Writer");
    const big = await contact("Big Donor");
    await post(doorRecordId, {
      writerContactId: chuck,
      lines: [{ category: "merchandise", amount: 25 }],
    });
    await post(doorRecordId, {
      writerContactId: big,
      depositSeparately: true,
      lines: [{ category: "donation", amount: 500, contactId: big }],
    });
    const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.eventId, eventId) });
    // The float is 15 on a fresh door record; the unmarked check joins the cash, the marked one does not.
    expect(row!.depositCents).toBe(0 - row!.seedFloatCents + 2500);
  });
});

describe("correcting and removing a check (FR-023)", () => {
  it("replaces the lines and changes the writer and note, on its own", async () => {
    const { doorRecordId } = await evening();
    const chuck = await contact("Chuck Writer");
    const dee = await contact("Dee Member");
    const check = await (await post(doorRecordId, chucksCheck(chuck, dee))).json();

    const res = await patch(check.id, {
      writerContactId: dee,
      note: null,
      lines: [{ category: "admission", amount: 45, quantity: 3 }],
    });
    expect(res.status).toBe(200);
    const after = await res.json();
    expect(after).toMatchObject({ writer: "Dee Member", amount: 45, note: null });
    expect(after.lines).toHaveLength(1);
    const lines = await db.select().from(gateSales).where(eq(gateSales.checkId, check.id));
    expect(lines).toHaveLength(1);
  });

  it("removes the check when its last line is removed", async () => {
    const { doorRecordId } = await evening();
    const chuck = await contact("Chuck Writer");
    const check = await (
      await post(doorRecordId, {
        writerContactId: chuck,
        lines: [{ category: "merchandise", amount: 25 }],
      })
    ).json();
    const lineId = check.lines[0].id as string;
    const res = await DELETE_SALE(
      jsonReq("DELETE", `/api/gate-sales/${lineId}`),
      ctx({ id: lineId }),
    );
    expect(res.status).toBe(204);
    expect(await db.select().from(gateChecks).where(eq(gateChecks.id, check.id))).toHaveLength(0);
  });

  it("removes the check and its lines", async () => {
    const { doorRecordId } = await evening();
    const chuck = await contact("Chuck Writer");
    const dee = await contact("Dee Member");
    const check = await (await post(doorRecordId, chucksCheck(chuck, dee))).json();
    const res = await remove(check.id);
    expect(res.status).toBe(204);
    expect(await db.select().from(gateSales).where(eq(gateSales.checkId, check.id))).toHaveLength(
      0,
    );
  });
});

describe("the door and the mark (FR-021, FR-027)", () => {
  const doorAttendant = () =>
    makeActor({
      email: "meg.door@example.org",
      firstName: "Meg",
      lastName: "Door",
      grants: [{ role: "door_attendant" }],
    });

  it("lets the door record a check and correct its own", async () => {
    const { doorRecordId } = await evening();
    const chuck = await contact("Chuck Writer");
    const meg = await doorAttendant();
    const created = await post(
      doorRecordId,
      { writerContactId: chuck, lines: [{ category: "merchandise", amount: 25 }] },
      meg.token,
    );
    expect(created.status).toBe(201);
    const check = await created.json();
    expect(check.recordedBy.contactId).toBe(meg.contactId);
    // FR-034: a durable audit row naming the volunteer, not a placeholder.
    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.kind, "gate_check.created"));
    expect(audit!.actorContactId).toBe(meg.contactId);
    expect((await patch(check.id, { note: "T-shirt" }, meg.token)).status).toBe(200);
  });

  it("refuses the door someone else's check", async () => {
    const { doorRecordId } = await evening();
    const chuck = await contact("Chuck Writer");
    const meg = await doorAttendant();
    const check = await (
      await post(doorRecordId, {
        writerContactId: chuck,
        lines: [{ category: "merchandise", amount: 25 }],
      })
    ).json();
    const patched = await patch(check.id, { note: "x" }, meg.token);
    expect(patched.status).toBe(403);
    expect((await patched.json()).error.code).toBe("NOT_YOUR_ENTRY");
    expect((await remove(check.id, meg.token)).status).toBe(403);
  });

  it("refuses the door the deposit-separately mark — never silently ignores it", async () => {
    const { doorRecordId } = await evening();
    const chuck = await contact("Chuck Writer");
    const meg = await doorAttendant();
    const created = await post(
      doorRecordId,
      {
        writerContactId: chuck,
        depositSeparately: true,
        lines: [{ category: "merchandise", amount: 25 }],
      },
      meg.token,
    );
    expect(created.status).toBe(403);
    expect(await db.select().from(gateChecks)).toHaveLength(0);

    const own = await (
      await post(
        doorRecordId,
        { writerContactId: chuck, lines: [{ category: "merchandise", amount: 25 }] },
        meg.token,
      )
    ).json();
    expect((await patch(own.id, { depositSeparately: true }, meg.token)).status).toBe(403);
  });

  it("lets whoever may record gate money mark a check", async () => {
    const { doorRecordId } = await evening();
    const chuck = await contact("Chuck Writer");
    const check = await (
      await post(doorRecordId, {
        writerContactId: chuck,
        lines: [{ category: "merchandise", amount: 25 }],
      })
    ).json();
    const res = await patch(check.id, { depositSeparately: true });
    expect((await res.json()).depositSeparately).toBe(true);
  });
});

/**
 * Analysis D2 (tasks.md T045): the race path. The service checks a line before writing it, but two writes
 * can still meet at the database, whose constraints then refuse. Each refusal must reach the caller as the
 * same code the pre-check would have given — not as a 500.
 */
describe("a constraint the database enforces reaches the caller in words", () => {
  async function violation(statement: ReturnType<typeof dsql>): Promise<unknown> {
    try {
      await db.execute(statement);
    } catch (e) {
      return e;
    }
    throw new Error("expected the database to refuse");
  }

  it("maps each check constraint to its code", async () => {
    const { doorRecordId } = await evening();
    const chuck = await contact("Chuck Writer");
    const [check] = await db
      .insert(gateChecks)
      .values({ doorRecordId, writerContactId: chuck })
      .returning();

    const needsCheck = await violation(dsql`
      INSERT INTO gate_sales (door_record_id, category, payment_method, amount_cents, quantity)
      VALUES (${doorRecordId}, 'admission', 'cash', 3000, 2)`);
    const wrongMethod = await violation(dsql`
      INSERT INTO gate_sales (door_record_id, category, payment_method, amount_cents, check_id)
      VALUES (${doorRecordId}, 'merchandise', 'cash', 2500, ${check!.id})`);

    const as = (e: unknown) => {
      const mapped = explainCheckViolation(e);
      expect(mapped).toBeInstanceOf(ApiError);
      return (mapped as ApiError).code;
    };
    expect(as(needsCheck)).toBe("ADMISSION_NEEDS_CHECK");
    expect(as(wrongMethod)).toBe("VALIDATION_ERROR");
  });

  it("passes any other error through untouched", () => {
    const other = new Error("something else");
    expect(explainCheckViolation(other)).toBe(other);
  });
});
