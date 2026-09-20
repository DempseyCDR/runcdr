"use client";
import type { GateMoney } from "@/server/domain/gate/deriveGateMoney";
import type { GateCheck, MoneyForm } from "./types";
import { money, toNumber } from "./save";
import styles from "./gate.module.css";

/**
 * Feature 082 (FR-022, research R4): what goes to the bank — the evening's main deposit, with what it is
 * made of, and one more for each check banked on its own. The main figure follows the typing, as the
 * money summary does.
 */
export default function DepositList({
  figures,
  form,
  performerCash,
  checks,
}: {
  figures: GateMoney;
  form: MoneyForm;
  performerCash: number;
  checks: GateCheck[];
}) {
  const withCash = checks.filter((c) => !c.depositSeparately).reduce((a, c) => a + c.amount, 0);
  const parts = [
    `counted cash ${money(toNumber(form.grossCash))}`,
    `less cash box seed ${money(toNumber(form.seedFloat))}`,
    ...(toNumber(form.cashPaidOut) ? [`less paid out ${money(toNumber(form.cashPaidOut))}`] : []),
    ...(performerCash ? [`less performers ${money(performerCash)}`] : []),
    ...(withCash ? [`plus checks ${money(withCash)}`] : []),
  ];
  return (
    <section aria-labelledby="gate-deposits" className={styles.section}>
      <h2 id="gate-deposits" className={styles.sectionHeading}>
        Deposits
      </h2>
      <ul className={styles.list}>
        <li className={styles.item} aria-label="Main deposit">
          <div className={styles.itemHead}>
            <span className={styles.name}>Main deposit</span>
            <span>{money(figures.mainDepositCents / 100)}</span>
          </div>
          <span className={styles.quiet}>{parts.join(", ")}</span>
        </li>
        {checks
          .filter((c) => c.depositSeparately)
          .map((c) => (
            <li key={c.id} className={styles.item} aria-label={`Check from ${c.writer}`}>
              <div className={styles.itemHead}>
                <span className={styles.name}>Check from {c.writer}</span>
                <span>{money(c.amount)}</span>
              </div>
              <span className={styles.quiet}>deposited on its own</span>
            </li>
          ))}
      </ul>
    </section>
  );
}
