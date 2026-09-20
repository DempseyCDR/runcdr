"use client";
import type { GateMoney } from "@/server/domain/gate/deriveGateMoney";
import { money } from "./save";
import styles from "./gate.module.css";

/**
 * Feature 082 (FR-003, FR-006): the evening's money so far, worked out as Mary types and kept above the
 * fold beside the performer-pay summary — admission by each source, the card fee, the checks and the
 * deposit she will take to the bank.
 */
export default function MoneyPreview({
  figures,
  showFee,
}: {
  figures: GateMoney;
  showFee: boolean;
}) {
  const d = (cents: number) => money(cents / 100);
  return (
    <section aria-labelledby="gate-money" className={styles.section}>
      <h2 id="gate-money" className={styles.sectionHeading}>
        Money so far
      </h2>
      <dl className={styles.figures}>
        <dt>Admission by cash</dt>
        <dd>{d(figures.admissionCashCents)}</dd>
        <dt>Admission by card</dt>
        <dd>{d(figures.admissionCardCents)}</dd>
        <dt>Admission by check</dt>
        <dd>{d(figures.admissionCheckCents)}</dd>
        <dt className={styles.total}>Admission</dt>
        <dd className={styles.total}>{d(figures.admissionCents)}</dd>
        {/* Feature 002 FR-007: the fee is the gate's to see, never the door volunteer's. */}
        {showFee && (
          <>
            <dt>Card fee</dt>
            <dd>{d(figures.cardFeeCents)}</dd>
          </>
        )}
        <dt>Checks</dt>
        <dd>{d(figures.checksCents)}</dd>
        <dt className={styles.total}>Deposit</dt>
        <dd className={styles.total}>{d(figures.mainDepositCents)}</dd>
      </dl>
    </section>
  );
}
