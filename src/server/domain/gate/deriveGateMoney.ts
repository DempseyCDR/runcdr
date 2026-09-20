import { posFeeCents } from "@/server/domain/door/calc";

/**
 * Feature 082 (research R10): the evening's money, worked out from the figures on the gate page.
 *
 * PURE and dependency-free on purpose — no database imports — because BOTH the page (as Mary types,
 * before any save) and the server (when it saves) call it. One function means the live preview and the
 * saved record cannot drift apart, which is what FR-006 asks for.
 *
 * All values are integer cents. Nothing is clamped: negative admission is a real signal that the
 * evening does not add up, and the Save says so rather than hiding it (FR-007).
 */
export type GateMoneyInput = {
  /** The cash counted — bills and coins. Checks are NOT part of it (FR-019). */
  grossCashCents: number;
  seedFloatCents: number;
  /** The gate's other payouts (ice, supplies), with its reason. */
  cashPaidOutCents: number;
  /** Cash handed to performers from the takings (feature 081). */
  performerCashCents: number;
  cardGrossCents: number;
  posTransactionCount: number;
  /** Sales that are not admission, by how they were paid. */
  nonAdmissionCashCents: number;
  nonAdmissionCardCents: number;
  /** The checks received: their admission lines, their whole value, and the part banked on its own. */
  checkAdmissionCents: number;
  checksCents: number;
  checksDepositedSeparatelyCents: number;
};

export type GateMoney = {
  admissionCashCents: number;
  admissionCardCents: number;
  admissionCheckCents: number;
  admissionCents: number;
  cardFeeCents: number;
  checksCents: number;
  /** The evening's own deposit — the cash, plus the checks not banked separately (FR-022). */
  mainDepositCents: number;
};

export function deriveGateMoney(input: GateMoneyInput): GateMoney {
  // Admission has never been entered: it is what is left once the other sales are taken off the
  // takings. Feature 082 adds a third source — admission a check paid for — which IS stated, because
  // only a check says who paid it (FR-020).
  const admissionCashCents =
    input.grossCashCents - input.seedFloatCents - input.nonAdmissionCashCents;
  const admissionCardCents = input.cardGrossCents - input.nonAdmissionCardCents;
  const admissionCheckCents = input.checkAdmissionCents;

  const mainDepositCents =
    input.grossCashCents -
    input.seedFloatCents -
    input.cashPaidOutCents -
    input.performerCashCents +
    (input.checksCents - input.checksDepositedSeparatelyCents);

  return {
    admissionCashCents,
    admissionCardCents,
    admissionCheckCents,
    admissionCents: admissionCashCents + admissionCardCents + admissionCheckCents,
    cardFeeCents: posFeeCents(input.posTransactionCount, input.cardGrossCents),
    checksCents: input.checksCents,
    mainDepositCents,
  };
}
