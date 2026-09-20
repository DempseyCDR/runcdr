import { deriveGateMoney, type GateMoney } from "@/server/domain/gate/deriveGateMoney";
import type { DoorRecord, GateCheck, GateSale, MoneyForm } from "./types";
import { toNumber } from "./save";

const cents = (dollars: number) => Math.round(dollars * 100);

/**
 * Feature 082 (FR-006, research R10): the evening's money as Mary types it — the same `deriveGateMoney` the
 * server runs when she saves, so the figures she watches are the figures that are kept.
 *
 * The typed figures come from the form; what was recorded one at a time (sales, checks, performers' cash)
 * comes from the door record as loaded.
 */
export function previewMoney(
  form: MoneyForm,
  record: DoorRecord,
  sales: GateSale[],
  checks: GateCheck[],
): GateMoney {
  const salesBy = (method: "cash" | "card") =>
    sales.filter((s) => s.paymentMethod === method).reduce((a, s) => a + cents(s.amount), 0);
  const lines = checks.flatMap((c) => c.lines);

  return deriveGateMoney({
    grossCashCents: cents(toNumber(form.grossCash)),
    seedFloatCents: cents(toNumber(form.seedFloat)),
    cashPaidOutCents: cents(toNumber(form.cashPaidOut)),
    performerCashCents: record.performerCash.reduce((a, p) => a + cents(p.amount), 0),
    cardGrossCents: cents(toNumber(form.pcGross)),
    posTransactionCount: toNumber(form.posTransactionCount),
    nonAdmissionCashCents: salesBy("cash"),
    nonAdmissionCardCents: salesBy("card"),
    checkAdmissionCents: lines
      .filter((l) => l.category === "admission")
      .reduce((a, l) => a + cents(l.amount), 0),
    checksCents: checks.reduce((a, c) => a + cents(c.amount), 0),
    checksDepositedSeparatelyCents: checks
      .filter((c) => c.depositSeparately)
      .reduce((a, c) => a + cents(c.amount), 0),
  });
}

/** The form as loaded: a stored figure shown, a zero left blank so the box is ready to type into. */
export function formFrom(record: DoorRecord): MoneyForm {
  const shown = (v: number) => (v ? String(v) : "");
  return {
    grossCash: shown(record.grossCash),
    seedFloat: String(record.seedFloat),
    cashPaidOut: shown(record.cashPaidOut),
    cashPaidOutReason: record.cashPaidOutReason ?? "",
    pcGross: shown(record.pcGross),
    posTransactionCount: shown(record.posTransactionCount),
    compCount: String(record.compCount),
    giftCardRedemptionCount: String(record.giftCardRedemptionCount),
    eveningNote: record.eveningNote ?? "",
  };
}
