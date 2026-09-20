import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makeDoorRecord } from "./helpers/factories";
import { doorRecords } from "@/server/db/schema";
import { PATCH as PATCH_DR } from "@/app/api/door-records/[id]/route";

// Feature 082 (FR-007, MARY-R15 Q11): entries that look wrong are pointed out WHEN MARY SAVES — never
// while she types — and never block the save. She corrects them and saves again.
//
// Cash paid out with no reason used to be REFUSED (CASH_PAYOUT_REASON_REQUIRED). It is now a warning:
// refusing the whole evening's money for a missing word lost more than it protected.

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

async function save(body: Record<string, unknown>, merchandiseCash = 0) {
  const event = await makeEvent();
  const id = await makeDoorRecord(
    event.id,
    merchandiseCash
      ? [{ category: "merchandise", paymentMethod: "cash", amount: merchandiseCash }]
      : [],
  );
  const res = await PATCH_DR(jsonReq("PATCH", `/api/door-records/${id}`, body), ctx({ id }));
  return { id, res, body: await res.json() };
}

const codes = (b: { warnings: { code: string }[] }) => b.warnings.map((w) => w.code);

describe("warnings on saving the evening's money", () => {
  it("says nothing when the evening adds up", async () => {
    const { res, body } = await save({
      grossCash: 500,
      seedFloat: 15,
      cashPaidOut: 20,
      cashPaidOutReason: "ice",
      pcGross: 180,
      posTransactionCount: 9,
    });
    expect(res.status).toBe(200);
    expect(body.warnings).toEqual([]);
  });

  it("warns when admission comes out negative, and saves anyway", async () => {
    // $30 counted, a $15 float, and $25 of T-shirts sold for cash: admission would be −$10.
    const { id, res, body } = await save({ grossCash: 30, seedFloat: 15 }, 25);
    expect(res.status).toBe(200);
    expect(codes(body)).toContain("NEGATIVE_ADMISSION");
    expect(
      body.warnings.find((w: { code: string }) => w.code === "NEGATIVE_ADMISSION").message,
    ).toMatch(/negative/i);
    const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, id) });
    expect(row!.grossCashCents).toBe(3000);
  });

  it("warns when cash is paid out with no reason, and saves anyway", async () => {
    const { id, res, body } = await save({ grossCash: 500, cashPaidOut: 20 });
    expect(res.status).toBe(200);
    expect(codes(body)).toEqual(["PAYOUT_WITHOUT_REASON"]);
    const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, id) });
    expect(row!.cashPaidOutCents).toBe(2000);
    expect(row!.cashPaidOutReason).toBeNull();
  });

  it("warns when card gross has no transaction count, and saves anyway", async () => {
    const { res, body } = await save({ grossCash: 500, pcGross: 180, posTransactionCount: 0 });
    expect(res.status).toBe(200);
    expect(codes(body)).toEqual(["CARD_GROSS_WITHOUT_COUNT"]);
  });

  it("reports every problem at once", async () => {
    const { body } = await save(
      { grossCash: 10, seedFloat: 15, cashPaidOut: 5, pcGross: 50, posTransactionCount: 0 },
      0,
    );
    expect(codes(body).sort()).toEqual(
      ["CARD_GROSS_WITHOUT_COUNT", "NEGATIVE_ADMISSION", "PAYOUT_WITHOUT_REASON"].sort(),
    );
  });

  it("returns the evening's money worked out with the warnings (contracts/gate.md)", async () => {
    const { body } = await save({
      grossCash: 500,
      seedFloat: 15,
      pcGross: 180,
      posTransactionCount: 9,
    });
    expect(body.admission).toEqual({ cash: 485, card: 180, check: 0, total: 665 });
    expect(body.deposits[0].kind).toBe("main");
    expect(body.moneyRecordedBy).not.toBeNull();
    expect(typeof body.cardFee).toBe("number");
  });
});

describe("the evening's note (FR-030)", () => {
  it("is saved and returned", async () => {
    const { id, body } = await save({ eveningNote: "the ice ran out at 9" });
    expect(body.eveningNote).toBe("the ice ran out at 9");
    const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, id) });
    expect(row!.eveningNote).toBe("the ice ran out at 9");
  });

  it("is cleared by an empty string or null", async () => {
    const { id } = await save({ eveningNote: "typo" });
    for (const cleared of ["", "   ", null]) {
      await PATCH_DR(
        jsonReq("PATCH", `/api/door-records/${id}`, { eveningNote: "again" }),
        ctx({ id }),
      );
      const res = await PATCH_DR(
        jsonReq("PATCH", `/api/door-records/${id}`, { eveningNote: cleared }),
        ctx({ id }),
      );
      expect((await res.json()).eveningNote).toBeNull();
    }
  });

  it("is left alone by a save that does not mention it", async () => {
    const { id } = await save({ eveningNote: "keep me" });
    const res = await PATCH_DR(
      jsonReq("PATCH", `/api/door-records/${id}`, { grossCash: 510 }),
      ctx({ id }),
    );
    expect((await res.json()).eveningNote).toBe("keep me");
  });
});
