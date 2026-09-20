"use client";
import { useState } from "react";
import Dialog from "@/app/_components/Dialog";
import { money, send } from "./savePayment";
import type { Payment } from "./types";
import styles from "./payments.module.css";

/**
 * Feature 081 (FR-019, MARY-R11): void a check that was written and then cancelled. It names the check, lists
 * every booking it paid, and needs a short reason; the check stays on record.
 */
export default function VoidDialog({
  payment,
  onClose,
  onSaved,
}: {
  payment: Payment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function voidCheck() {
    const sent = await send(`/api/performer-payments/${payment.id}/void`, "POST", {
      reason: reason.trim(),
    });
    if (!sent.ok) return setError(sent.message);
    onClose();
    onSaved();
  }

  return (
    <Dialog label="Void check" onClose={onClose}>
      <p>{`Void check #${payment.checkNumber} to ${payment.payee}?`}</p>
      <ul className={styles.picks}>
        {payment.lines.map((l) => (
          <li key={l.bookingId} className={styles.quiet}>
            {`${l.performer} — ${money(l.amount)}`}
          </li>
        ))}
      </ul>
      <label className={styles.entry}>
        <span className={styles.wide}>Reason</span>
        <input
          className={`${styles.input} ${styles.wide}`}
          placeholder="wrong amount, lost, substitution…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className={styles.buttons}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!reason.trim()}
          onClick={() => void voidCheck()}
        >
          Void check
        </button>
        <button type="button" className={styles.button} onClick={onClose}>
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </Dialog>
  );
}
