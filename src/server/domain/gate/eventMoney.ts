import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/client";
import { doorRecords, gateSales } from "@/server/db/schema";
import type { GateCategory } from "@/server/db/schema";

/**
 * Shared per-event gate money breakdown (single source of truth for both the
 * treasurer report, feature 004, and the organizer report, feature 005).
 *
 * Admission is DERIVED (never a stored gate line):
 *   cash admission = gross cash − seed float − Σ non-admission cash lines
 *   card admission = card gross − Σ non-admission card lines
 * All values integer cents. If the event has no door record, everything is 0.
 */
export type EventGate = {
  hasDoorRecord: boolean;
  admissionCashCents: number;
  admissionCardCents: number;
  // Feature 082 (research R3, FR-020): admission a check paid for. Unlike the other two this is STATED,
  // not derived, because only a check says who paid it — so admission is now three sources added.
  admissionCheckCents: number;
  admissionCents: number;
  /** Feature 082 (FR-019): every check received, whatever its lines pay for. */
  checksCents: number;
  // per-category totals (cash + card), non-admission categories only
  merchandiseCents: number;
  giftCardCents: number;
  miscSalesCents: number;
  donationCents: number;
  futureEventCents: number;
  membershipCents: number;
  cardGrossCents: number;
  cardFeeCents: number; // door card fee (pos_fee_cents)
  depositCents: number;
  compCount: number; // feature 014: people admitted free; subtracted from paying dancers
  openBandCount: number; // feature 017 (B36): open-band musicians comped; also subtracted from paying
};

function zero(): EventGate {
  return {
    hasDoorRecord: false,
    admissionCashCents: 0,
    admissionCardCents: 0,
    admissionCheckCents: 0,
    admissionCents: 0,
    checksCents: 0,
    merchandiseCents: 0,
    giftCardCents: 0,
    miscSalesCents: 0,
    donationCents: 0,
    futureEventCents: 0,
    membershipCents: 0,
    cardGrossCents: 0,
    cardFeeCents: 0,
    depositCents: 0,
    compCount: 0,
    openBandCount: 0,
  };
}

export async function computeEventGate(db: DbOrTx, eventId: string): Promise<EventGate> {
  const door = await db.query.doorRecords.findFirst({ where: eq(doorRecords.eventId, eventId) });
  if (!door) return zero();

  const sales = await db.select().from(gateSales).where(eq(gateSales.doorRecordId, door.id));
  const catTotal = (cat: GateCategory) =>
    sales.filter((s) => s.category === cat).reduce((a, s) => a + s.amountCents, 0);

  // Feature 082 (R3): a check's lines are gate sales too, so the two DERIVED figures must exclude them —
  // a T-shirt paid for by check was never part of the cash counted or the card gross, and subtracting it
  // from either would invent admission that nobody paid.
  let nonAdmCash = 0;
  let nonAdmCard = 0;
  let admissionCheckCents = 0;
  let checksCents = 0;
  for (const s of sales) {
    if (s.paymentMethod === "check") {
      checksCents += s.amountCents;
      if (s.category === "admission") admissionCheckCents += s.amountCents;
      continue;
    }
    if (s.paymentMethod === "cash") nonAdmCash += s.amountCents;
    else nonAdmCard += s.amountCents;
  }
  const admissionCashCents = door.grossCashCents - door.seedFloatCents - nonAdmCash;
  const admissionCardCents = door.pcGrossCents - nonAdmCard;

  return {
    hasDoorRecord: true,
    admissionCashCents,
    admissionCardCents,
    admissionCheckCents,
    admissionCents: admissionCashCents + admissionCardCents + admissionCheckCents,
    checksCents,
    merchandiseCents: catTotal("merchandise"),
    giftCardCents: catTotal("gift_card"),
    miscSalesCents: catTotal("misc_sales"),
    donationCents: catTotal("donation"),
    futureEventCents: catTotal("future_event"),
    membershipCents: catTotal("membership"),
    cardGrossCents: door.pcGrossCents,
    cardFeeCents: door.posFeeCents,
    depositCents: door.depositCents,
    compCount: door.compCount,
    openBandCount: door.openBandCount,
  };
}
