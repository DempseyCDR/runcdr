/**
 * Pure door-money calculators, all in integer cents (exact). Used by the door
 * record service; unit-tested independently.
 */

/** Door POS fee = $0.09 per transaction + 2.29% of gross. */
export function posFeeCents(transactionCount: number, posGrossCents: number): number {
  const perTxn = Math.round(transactionCount * 9); // 9 cents each
  const pct = Math.round(posGrossCents * 0.0229);
  return perTxn + pct;
}

/**
 * Deposit = gross cash − seed float − cash paid out. Feature 081 (FR-033): "cash paid out" is the gate's
 * other payouts, and the cash paid to performers from the takings comes off as well.
 */
export function depositCents(
  grossCashCents: number,
  seedFloatCents: number,
  cashPaidOutCents: number,
  performerCashCents = 0,
): number {
  return grossCashCents - seedFloatCents - cashPaidOutCents - performerCashCents;
}

/** The money/count fields of a door record that testify to real activity (seed float deliberately absent). */
export type DoorRecordMoney = {
  posTransactionCount: number;
  pcGrossCents: number;
  posFeeCents: number;
  grossCashCents: number;
  seedFloatCents: number;
  cashPaidOutCents: number;
  depositCents: number;
  giftCardRedemptionCount: number;
  compCount: number;
  openBandCount: number;
};

/**
 * Feature 019 US4 (FR-017): a door record is EMPTY — no real event history — when it has no gate sales and
 * every money field and count is zero. `seedFloatCents` is EXCLUDED on purpose: it is a pre-filled default
 * (and, after US5, a configured value), not takings, so a non-$15 float proves nothing about whether the
 * night happened. This is what lets a never-held event whose gate page was merely opened stay deletable.
 */
export function isEmptyDoorRecord(m: DoorRecordMoney, gateSaleCount: number): boolean {
  return (
    gateSaleCount === 0 &&
    m.posTransactionCount === 0 &&
    m.pcGrossCents === 0 &&
    m.posFeeCents === 0 &&
    m.grossCashCents === 0 &&
    m.cashPaidOutCents === 0 &&
    m.depositCents === 0 &&
    m.giftCardRedemptionCount === 0 &&
    m.compCount === 0 &&
    m.openBandCount === 0
  );
}
