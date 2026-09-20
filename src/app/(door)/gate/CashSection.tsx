"use client";
import type { ReactNode } from "react";
import type { DoorRecord, MoneyForm } from "./types";
import { money } from "./save";
import styles from "./gate.module.css";

/**
 * Feature 082 (FR-019): the cash counted — bills and coins, never checks — with the cash box seed and what
 * else was
 * paid out. The cash paid to performers is recorded on /payments (081) and shown here, not re-entered.
 */
export default function CashSection({
  form,
  record,
  disabled,
  onChange,
  countButton,
}: {
  form: MoneyForm;
  record: DoorRecord;
  disabled: boolean;
  onChange: (patch: Partial<MoneyForm>) => void;
  countButton?: ReactNode;
}) {
  return (
    <section aria-labelledby="gate-cash" className={styles.section}>
      <h2 id="gate-cash" className={styles.sectionHeading}>
        Cash
      </h2>
      <div className={styles.fields}>
        <label>
          Gross cash
          <input
            className={styles.input}
            inputMode="decimal"
            value={form.grossCash}
            disabled={disabled}
            onChange={(e) => onChange({ grossCash: e.target.value })}
          />
        </label>
        <label>
          Cash box seed
          <input
            className={styles.input}
            inputMode="decimal"
            value={form.seedFloat}
            disabled={disabled}
            onChange={(e) => onChange({ seedFloat: e.target.value })}
          />
        </label>
        {countButton && <div className={styles.wide}>{countButton}</div>}
        {record.performerCash.length > 0 && (
          <p className={`${styles.quiet} ${styles.wide}`}>
            {`Paid to performers in cash: ${record.performerCash
              .map((c) => `${c.payee} ${money(c.amount)}`)
              .join(", ")}`}
          </p>
        )}
        <label>
          Other cash paid out
          <input
            className={styles.input}
            inputMode="decimal"
            value={form.cashPaidOut}
            disabled={disabled}
            onChange={(e) => onChange({ cashPaidOut: e.target.value })}
          />
        </label>
        <label>
          Reason
          <input
            className={styles.input}
            value={form.cashPaidOutReason}
            disabled={disabled}
            onChange={(e) => onChange({ cashPaidOutReason: e.target.value })}
          />
        </label>
      </div>
    </section>
  );
}
