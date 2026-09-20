import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { gateSales, membershipAccounts, membershipMembers } from "@/server/db/schema";
import { makeContactWithEmail, makeEvent } from "./helpers/factories";
import { createDoorRecord } from "@/server/domain/door/doorRecordService";
import { createGateSale } from "@/server/domain/door/gateSaleService";
import { gateSaleCreateSchema } from "@/server/validation/door";
import { grantedMembershipExpiry } from "@/server/domain/membership/membershipTerm";

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

/**
 * Feature 068 (FR-003, FR-005): the FS records WHAT WAS BOUGHT on a gate dues line.
 *
 * The level is chosen, never inferred from the amount — dues tiers change and members routinely round up
 * or add a donation to the same payment, so the money and the level are independent facts.
 *
 * Feature 082: a named sale is recorded on its own (`gateSaleService`), no longer through the gate's Save.
 */
describe("gate dues lines carry a level (feature 068)", () => {
  async function setup(name: string, email: string) {
    const { contactId } = await makeContactWithEmail({ displayName: name, email });
    const event = await makeEvent(); // 2026-06-18 → boundary 2026-08-31
    const dr = await createDoorRecord(db, event.id, "test");
    return { contactId, doorRecordId: dr.id, eventDate: "2026-06-18" };
  }

  it("a named membership sale opens an account at the chosen level (FR-005)", async () => {
    const { contactId, doorRecordId, eventDate } = await setup("Nina Named", "nina@ex.com");
    await createGateSale(db, doorRecordId, {
      category: "membership",
      paymentMethod: "cash",
      amount: 25,
      contactId,
      membershipLevel: "family",
    });

    const acct = await db.query.membershipAccounts.findFirst({
      where: eq(membershipAccounts.payerContactId, contactId),
    });
    expect(acct).toBeTruthy();
    expect(acct!.level).toBe("family");
    expect(acct!.expiryDate).toBe(grantedMembershipExpiry(eventDate, "08-31"));

    const members = await db
      .select()
      .from(membershipMembers)
      .where(eq(membershipMembers.accountId, acct!.id));
    expect(members).toHaveLength(1); // the payer, attached automatically (FR-007)
  });

  it("the amount is independent of the level, and the money is still recorded (FR-003)", async () => {
    const { contactId, doorRecordId } = await setup("Round Up", "roundup@ex.com");
    // Pays $60 for an individual membership — the extra is a donation folded into the same cash.
    await createGateSale(db, doorRecordId, {
      category: "membership",
      paymentMethod: "cash",
      amount: 60,
      contactId,
      membershipLevel: "individual",
    });

    const acct = await db.query.membershipAccounts.findFirst({
      where: eq(membershipAccounts.payerContactId, contactId),
    });
    expect(acct!.level).toBe("individual"); // NOT inferred from $60

    const sale = await db.query.gateSales.findFirst({ where: eq(gateSales.contactId, contactId) });
    expect(sale!.amountCents).toBe(6000); // money reconciliation untouched
    expect(sale!.membershipLevel).toBe("individual");
  });

  it("requires a level on a membership line, as it already requires a contact", () => {
    const missing = gateSaleCreateSchema.safeParse({
      category: "membership",
      paymentMethod: "cash",
      amount: 25,
      contactId: "11111111-1111-1111-1111-111111111111",
    });
    expect(missing.success).toBe(false);
  });

  it("does not require a level on other categories", () => {
    const ok = gateSaleCreateSchema.safeParse({
      category: "merchandise",
      paymentMethod: "cash",
      amount: 10,
    });
    expect(ok.success).toBe(true);
  });
});
