"use client";
import type { ReactNode } from "react";
import { CATEGORY_LABEL, type GateCheck } from "./types";
import { money } from "./save";
import styles from "./gate.module.css";

/**
 * Feature 082 (FR-014–FR-017, FR-029): each check received — its writer, amount, what it pays for line by
 * line, its note, whether it is banked on its own, and who recorded it.
 */
export default function CheckList({
  checks,
  actions,
}: {
  checks: GateCheck[];
  actions?: (check: GateCheck) => ReactNode;
}) {
  if (checks.length === 0) return <p className={styles.quiet}>No checks received.</p>;
  return (
    <ul className={styles.list} aria-label="Checks received">
      {checks.map((c) => (
        <li key={c.id} className={styles.item} aria-label={`Check from ${c.writer}`}>
          <div className={styles.itemHead}>
            <span className={styles.name}>{c.writer}</span>
            <span>{money(c.amount)}</span>
          </div>
          <ul className={styles.list}>
            {c.lines.map((l) => (
              <li key={l.id} className={styles.quiet}>
                {CATEGORY_LABEL[l.category] ?? l.category} {money(l.amount)}
                {l.quantity && l.category === "admission"
                  ? ` · ${l.quantity} ${l.quantity === 1 ? "person" : "people"}`
                  : l.quantity
                    ? ` · qty ${l.quantity}`
                    : ""}
                {l.membershipLevel ? ` · ${l.membershipLevel}` : ""}
                {l.contactName && l.contactId !== c.writerContactId ? ` · ${l.contactName}` : ""}
                {l.note ? ` — ${l.note}` : ""}
              </li>
            ))}
          </ul>
          {c.note && <p className={styles.note}>{c.note}</p>}
          <span className={styles.quiet}>
            {c.depositSeparately ? "Deposited separately" : "With the cash"}
            {c.recordedBy ? ` · recorded by ${c.recordedBy.displayName}` : ""}
          </span>
          {actions?.(c)}
        </li>
      ))}
    </ul>
  );
}
