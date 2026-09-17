import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeContactWithEmail } from "./helpers/factories";
import { jsonReq, ctx } from "./helpers/http";
import { GET as PARKED } from "@/app/api/membership-captures/parked/route";
import {
  createCapture,
  processNotification,
  linkParkedNotification,
  listParkedNotifications,
} from "@/server/domain/paypal/captureService";
import { extractNotification, type PaypalWebhook } from "@/server/validation/paypal";
import {
  contacts,
  membershipAccounts,
  membershipCaptures,
  paypalNotifications,
} from "@/server/db/schema";

// A fixture PAYMENT.CAPTURE.COMPLETED payload (Constitution v1.2.0 third-party boundary — no PayPal call).
function payload(eventId: string, email: string, value = "25.00"): PaypalWebhook {
  return {
    id: eventId,
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { amount: { value }, payer: { email_address: email } },
  } as PaypalWebhook;
}
function process(p: PaypalWebhook, verified: boolean) {
  return processNotification(db, extractNotification(p), p, verified);
}

// Feature 019 US3 (FR-011..FR-013): capture → verified+matched notification → membership, via the shared
// path; idempotent; unverified rejected; unmatched parked; latest capture wins.
describe("online membership (capture + webhook)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a verified, matched notification creates a membership for the captured member", async () => {
    const { contactId } = await makeContactWithEmail({
      displayName: "Renew Rita",
      email: "rita@ex.com",
    });
    await createCapture(db, { name: "Renew Rita", email: "rita@ex.com" });

    const outcome = await process(payload("evt-1", "rita@ex.com"), true);
    expect(outcome).toBe("matched");
    const mem = await db.query.membershipAccounts.findFirst({
      where: eq(membershipAccounts.payerContactId, contactId),
    });
    expect(mem).toBeDefined();
    const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
    expect(contact?.membershipStatus).toBe("current");
    // A payer was created for the member (payer_id NOT NULL — analyze G1).
    expect(
      (
        await db
          .select()
          .from(membershipAccounts)
          .where(eq(membershipAccounts.payerContactId, contactId))
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("matches case-insensitively on payer email", async () => {
    const { contactId } = await makeContactWithEmail({
      displayName: "Case Cara",
      email: "cara@ex.com",
    });
    await createCapture(db, { name: "Case Cara", email: "cara@ex.com" });
    expect(await process(payload("evt-2", "CARA@EX.COM"), true)).toBe("matched");
    expect(
      await db.query.membershipAccounts.findFirst({
        where: eq(membershipAccounts.payerContactId, contactId),
      }),
    ).toBeDefined();
  });

  it("is idempotent — a replayed provider_event_id creates exactly one membership (FR-013)", async () => {
    const { contactId } = await makeContactWithEmail({
      displayName: "Dupe Dan",
      email: "dan@ex.com",
    });
    await createCapture(db, { name: "Dupe Dan", email: "dan@ex.com" });
    expect(await process(payload("evt-dupe", "dan@ex.com"), true)).toBe("matched");
    expect(await process(payload("evt-dupe", "dan@ex.com"), true)).toBe("duplicate");
    const mems = await db
      .select()
      .from(membershipAccounts)
      .where(eq(membershipAccounts.payerContactId, contactId));
    expect(mems).toHaveLength(1);
  });

  it("rejects an unverifiable notification and stores nothing (FR-011.3)", async () => {
    await makeContactWithEmail({ displayName: "No Trust", email: "no@ex.com" });
    await createCapture(db, { name: "No Trust", email: "no@ex.com" });
    expect(await process(payload("evt-bad", "no@ex.com"), false)).toBe("rejected");
    expect(await db.select().from(paypalNotifications)).toHaveLength(0);
    expect(await db.select().from(membershipAccounts)).toHaveLength(0);
  });

  it("parks a verified-but-unmatched notification, never dropping it", async () => {
    const outcome = await process(payload("evt-park", "stranger@ex.com"), true);
    expect(outcome).toBe("parked");
    const parked = await listParkedNotifications(db);
    expect(parked).toHaveLength(1);
    expect(await db.select().from(membershipAccounts)).toHaveLength(0);

    // Feature 081 (FR-029): gone from /payments, the worklist is still served for its future home (B52).
    const res = await PARKED(jsonReq("GET", "/api/membership-captures/parked"), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).parked).toHaveLength(1);
  });

  it("an admin can link a parked notification to a contact → membership identical to auto-matched", async () => {
    const { contactId } = await makeContactWithEmail({
      displayName: "Late Linda",
      email: "linda@ex.com",
    });
    // Linda paid directly (no capture, or capture without contact) → parked.
    await process(payload("evt-late", "linda-paypal@ex.com"), true);
    const [parked] = await listParkedNotifications(db);
    await linkParkedNotification(db, parked!.id, contactId, "admin");
    const mem = await db.query.membershipAccounts.findFirst({
      where: eq(membershipAccounts.payerContactId, contactId),
    });
    // Feature 068: a DURABLE account cannot carry a key per payment, so the per-membership provenance
    // column is gone. Replay protection is unchanged and lives where it always really did —
    // `paypal_notifications.provider_event_id` is UNIQUE and checked before anything is created.
    expect(mem).toBeDefined();
    const notif = await db.query.paypalNotifications.findFirst({
      where: eq(paypalNotifications.id, parked!.id),
    });
    expect(notif?.status).toBe("resolved");
  });

  it("when two awaiting captures share an email, the latest wins and the older expires", async () => {
    await makeContactWithEmail({ displayName: "Twice Tim", email: "tim@ex.com" });
    const first = await createCapture(db, { name: "Tim Old", email: "tim@ex.com" });
    const second = await createCapture(db, { name: "Tim New", email: "tim@ex.com" });
    const older = await db.query.membershipCaptures.findFirst({
      where: eq(membershipCaptures.id, first.id),
    });
    expect(older?.status).toBe("expired");
    expect(await process(payload("evt-tim", "tim@ex.com"), true)).toBe("matched");
    const matched = await db.query.membershipCaptures.findFirst({
      where: eq(membershipCaptures.id, second.id),
    });
    expect(matched?.status).toBe("matched");
  });

  it("a capture with no matching payment stays awaiting_payment", async () => {
    await makeContactWithEmail({ displayName: "Wait Will", email: "will@ex.com" });
    const c = await createCapture(db, { name: "Wait Will", email: "will@ex.com" });
    const row = await db.query.membershipCaptures.findFirst({
      where: eq(membershipCaptures.id, c.id),
    });
    expect(row?.status).toBe("awaiting_payment");
  });
});
