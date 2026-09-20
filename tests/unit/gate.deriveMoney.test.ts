import { describe, expect, it } from "vitest";
import { deriveGateMoney, type GateMoneyInput } from "@/server/domain/gate/deriveGateMoney";

// Feature 082 (research R10): one pure function behind BOTH the gate page's live figures and the
// server's saved record, so the preview and the saved evening cannot disagree.

const base: GateMoneyInput = {
  grossCashCents: 50000, // the cash counted — bills and coins, never checks (FR-019)
  seedFloatCents: 1500,
  cashPaidOutCents: 0,
  performerCashCents: 0,
  cardGrossCents: 0,
  posTransactionCount: 0,
  // Non-admission sales, by how they were paid.
  nonAdmissionCashCents: 0,
  nonAdmissionCardCents: 0,
  // The checks received: their admission lines, their whole value, and the part kept out of the main
  // deposit because it is banked on its own (FR-022).
  checkAdmissionCents: 0,
  checksCents: 0,
  checksDepositedSeparatelyCents: 0,
};

describe("deriveGateMoney — admission", () => {
  it("derives cash admission as the counted cash less the float and the other cash sales", () => {
    const m = deriveGateMoney({ ...base, nonAdmissionCashCents: 2500 });
    expect(m.admissionCashCents).toBe(50000 - 1500 - 2500);
  });

  it("derives card admission as the card gross less the other card sales", () => {
    const m = deriveGateMoney({ ...base, cardGrossCents: 18000, nonAdmissionCardCents: 4000 });
    expect(m.admissionCardCents).toBe(14000);
  });

  it("takes admission by check from the checks' admission lines", () => {
    const m = deriveGateMoney({ ...base, checkAdmissionCents: 3000, checksCents: 9500 });
    expect(m.admissionCheckCents).toBe(3000);
  });

  it("adds the three sources (FR-020)", () => {
    const m = deriveGateMoney({
      ...base,
      nonAdmissionCashCents: 2500,
      cardGrossCents: 18000,
      nonAdmissionCardCents: 4000,
      checkAdmissionCents: 3000,
      checksCents: 9500,
    });
    expect(m.admissionCashCents).toBe(46000);
    expect(m.admissionCardCents).toBe(14000);
    expect(m.admissionCheckCents).toBe(3000);
    expect(m.admissionCents).toBe(46000 + 14000 + 3000);
  });

  it("can go negative, and says so rather than clamping (FR-007)", () => {
    const m = deriveGateMoney({ ...base, grossCashCents: 1000, nonAdmissionCashCents: 2500 });
    expect(m.admissionCashCents).toBe(1000 - 1500 - 2500);
    expect(m.admissionCents).toBeLessThan(0);
  });
});

describe("deriveGateMoney — the card fee and the checks total", () => {
  it("charges the same fee the door record charges", () => {
    const m = deriveGateMoney({ ...base, cardGrossCents: 18000, posTransactionCount: 9 });
    expect(m.cardFeeCents).toBe(Math.round(9 * 9) + Math.round(18000 * 0.0229));
  });

  it("totals the checks received", () => {
    const m = deriveGateMoney({ ...base, checksCents: 9500 });
    expect(m.checksCents).toBe(9500);
  });
});

describe("deriveGateMoney — the main deposit", () => {
  it("is the counted cash less the float, the payouts and the performers' cash, plus the checks", () => {
    const m = deriveGateMoney({
      ...base,
      cashPaidOutCents: 2000,
      performerCashCents: 6000,
      checksCents: 9500,
    });
    expect(m.mainDepositCents).toBe(50000 - 1500 - 2000 - 6000 + 9500);
  });

  it("leaves out a check banked on its own (FR-022)", () => {
    const m = deriveGateMoney({
      ...base,
      checksCents: 59500,
      checksDepositedSeparatelyCents: 50000,
    });
    expect(m.mainDepositCents).toBe(50000 - 1500 + 9500);
  });

  it("is cash alone when every check is banked separately", () => {
    const m = deriveGateMoney({
      ...base,
      checksCents: 50000,
      checksDepositedSeparatelyCents: 50000,
    });
    expect(m.mainDepositCents).toBe(48500);
  });

  it("does not count checks as cash (FR-019)", () => {
    const withChecks = deriveGateMoney({ ...base, checksCents: 9500, checkAdmissionCents: 3000 });
    const without = deriveGateMoney(base);
    // Recording a check moves the deposit and admission, and leaves the counted cash alone.
    expect(withChecks.admissionCashCents).toBe(without.admissionCashCents);
    expect(withChecks.mainDepositCents - without.mainDepositCents).toBe(9500);
  });
});
