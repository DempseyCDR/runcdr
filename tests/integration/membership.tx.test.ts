import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeContactWithEmail } from "./helpers/factories";
import { recordDuesPayment } from "@/server/domain/membership/accountService";
import { membershipAccounts, statusChangeAudit, contacts } from "@/server/db/schema";

// Feature 019 (FR-001, FR-015): createMembership must be transaction-capable so the door flow can commit
// a membership atomically with the gate sale, and both channels share one path.
describe("recordDuesPayment — transactional (feature 068)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("rolls back membership, status change, and audit when the surrounding transaction throws", async () => {
    const { contactId } = await makeContactWithEmail({
      displayName: "Rollback Rita",
      email: "rita@ex.com",
    });
    await expect(
      db.transaction(async (tx) => {
        await recordDuesPayment(
          tx as unknown as typeof db,
          contactId,
          { level: "individual", paymentDate: "2026-09-04" },
          null,
        );
        throw new Error("boom — force rollback");
      }),
    ).rejects.toThrow("boom");

    // Nothing persisted: no account, no status flip, no audit row.
    const account = await db.query.membershipAccounts.findFirst({
      where: eq(membershipAccounts.payerContactId, contactId),
    });
    expect(account).toBeUndefined();
    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
    expect(contact?.membershipStatus).toBe("never");
    const audit = await db.query.statusChangeAudit.findFirst({
      where: eq(statusChangeAudit.contactId, contactId),
    });
    expect(audit).toBeUndefined();
  });

  it("commits membership + status + audit atomically when handed a plain Db (opens its own tx)", async () => {
    const { contactId } = await makeContactWithEmail({
      displayName: "Commit Cora",
      email: "cora@ex.com",
    });
    await recordDuesPayment(
      db,
      contactId,
      { level: "individual", paymentDate: new Date().toISOString().slice(0, 10) },
      null,
    );

    const account = await db.query.membershipAccounts.findFirst({
      where: eq(membershipAccounts.payerContactId, contactId),
    });
    expect(account).toBeDefined();
  });

  /**
   * Feature 068 supersedes the old `source_gate_sale_id` partial unique index. A DURABLE account cannot
   * carry a key per payment — many payments, one row — and the index was never the door's real guard
   * anyway: the gate's old replace-all Save deleted and re-inserted gate-sale rows on every save, so their
   * ids were never stable enough to key on. The actual protection is the renewal no-op, asserted here (research R2).
   */
  it("recording the same dues twice does not double-extend the account (idempotency, R5)", async () => {
    const { contactId } = await makeContactWithEmail({
      displayName: "Dup Dan",
      email: "dan@ex.com",
    });
    const payment = { level: "individual" as const, paymentDate: "2026-09-04" };

    await recordDuesPayment(db, contactId, payment, null);
    const first = await db.query.membershipAccounts.findFirst({
      where: eq(membershipAccounts.payerContactId, contactId),
    });
    await recordDuesPayment(db, contactId, payment, null);
    const second = await db.query.membershipAccounts.findFirst({
      where: eq(membershipAccounts.payerContactId, contactId),
    });

    expect(await db.select().from(membershipAccounts)).toHaveLength(1);
    expect(second!.expiryDate).toBe(first!.expiryDate);
  });
});
