import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makeDoorRecord } from "./helpers/factories";
import { doorRecords } from "@/server/db/schema";
import { PATCH as PATCH_DR } from "@/app/api/door-records/[id]/route";

// FR-006, FR-007, FR-008 — gross cash / PC gross are derived from gate lines.
describe("PATCH /api/door-records/:id", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  // Feature 082 (MARY-R15 Q10): the card fee is now shown to whoever may record gate money, as they type.
  // It is still never given to the door volunteer (feature 002 FR-007) — see door.payload.test.ts.
  it("computes deposit from derived gross cash, persists gift-card count, and returns the card fee", async () => {
    const evt = await makeEvent();
    const id = await makeDoorRecord(evt.id);
    const res = await PATCH_DR(
      jsonReq("PATCH", `/api/door-records/${id}`, {
        posTransactionCount: 10,
        grossCash: 200,
        pcGross: 100,
        seedFloat: 15,
        cashPaidOut: 25,
        cashPaidOutReason: "performer cash",
        giftCardRedemptionCount: 3,
      }),
      ctx({ id }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deposit).toBe(160); // 200 − 15 − 25
    expect(body.giftCardRedemptionCount).toBe(3);
    expect(body.cardFee).toBe(3.19);

    // fee stored server-side: 10 txns (90c) + 2.29% of PC gross $100 (229c) = 319c
    const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, id) });
    expect(row?.posFeeCents).toBe(319);
  });
  // Feature 082 (FR-007): cash paid out with no reason is now a WARNING that never blocks the save, not a
  // 422 — see door.warnings.test.ts.
});
