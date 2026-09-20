"use client";
import type { ReactNode } from "react";
import { CATEGORY_LABEL, type GateSale } from "./types";
import { money } from "./save";
import styles from "./gate.module.css";

/**
 * Feature 082 (FR-028, FR-029, research R16): every sale that is not a check's line — named or not — with
 * its person (or, with no one named, what was sold), amount, how it was paid, quantity, note and who
 * recorded it. Each is written on its own, never by the gate's Save (FR-026). A sale with no note shows no
 * empty label.
 */
export default function SaleList({
  sales,
  actions,
}: {
  sales: GateSale[];
  actions?: (sale: GateSale) => ReactNode;
}) {
  if (sales.length === 0) return <p className={styles.quiet}>None yet.</p>;
  return (
    <ul className={styles.list} aria-label="Sales">
      {sales.map((s) => {
        const what = CATEGORY_LABEL[s.category] ?? s.category;
        const name = s.contactName ?? what;
        return (
          <li key={s.id} className={styles.item} aria-label={name}>
            <div className={styles.itemHead}>
              <span className={styles.name}>{name}</span>
              <span>
                {money(s.amount)} {s.paymentMethod}
              </span>
            </div>
            <span className={styles.quiet}>
              {[
                s.contactName ? what : null,
                s.membershipLevel,
                s.quantity ? `qty ${s.quantity}` : null,
                s.recordedBy ? `recorded by ${s.recordedBy.displayName}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {s.note && <p className={styles.note}>{s.note}</p>}
            {actions?.(s)}
          </li>
        );
      })}
    </ul>
  );
}
