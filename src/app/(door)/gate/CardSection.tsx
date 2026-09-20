"use client";
import type { MoneyForm } from "./types";
import { money } from "./save";
import styles from "./gate.module.css";

/** Feature 082: the card takings and how many transactions — the fee is worked out from both. */
export default function CardSection({
  form,
  feeCents,
  disabled,
  onChange,
}: {
  form: MoneyForm;
  /** Shown only to someone who may record gate money (feature 002 FR-007). */
  feeCents: number | null;
  disabled: boolean;
  onChange: (patch: Partial<MoneyForm>) => void;
}) {
  return (
    <section aria-labelledby="gate-card" className={styles.section}>
      <h2 id="gate-card" className={styles.sectionHeading}>
        Card
      </h2>
      <div className={styles.fields}>
        <label>
          Card gross
          <input
            className={styles.input}
            inputMode="decimal"
            value={form.pcGross}
            disabled={disabled}
            onChange={(e) => onChange({ pcGross: e.target.value })}
          />
        </label>
        <label>
          Card transactions
          <input
            className={styles.input}
            inputMode="numeric"
            value={form.posTransactionCount}
            disabled={disabled}
            onChange={(e) => onChange({ posTransactionCount: e.target.value })}
          />
        </label>
      </div>
      {feeCents !== null && <p className={styles.quiet}>Card fee {money(feeCents / 100)}</p>}
    </section>
  );
}
