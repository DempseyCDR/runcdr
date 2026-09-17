"use client";
import { useState } from "react";
import Dialog from "./Dialog";
import { money, send } from "./savePayment";
import type { Payment } from "./types";
import styles from "./payments.module.css";

/**
 * Feature 081 (FR-016, FR-017, FR-034, MARY-R12): delete a payment that was never made. For a check, the
 * question says so in as many words and offers Void instead; once the treasurer report exists, it warns.
 */
export default function DeleteDialog({
  payment,
  reportGenerated,
  onClose,
  onSaved,
  onVoidInstead,
}: {
  payment: Payment;
  /** The treasurer report was generated after the evening, so the payment may already be in the ledger. */
  reportGenerated: boolean;
  onClose: () => void;
  onSaved: () => void;
  onVoidInstead: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const isCheck = payment.method === "check";

  async function remove() {
    const sent = await send(`/api/performer-payments/${payment.id}`, "DELETE");
    if (!sent.ok) return setError(sent.message);
    onClose();
    onSaved();
  }

  return (
    <Dialog label="Delete payment" onClose={onClose}>
      <p>
        {isCheck
          ? `This erases check #${payment.checkNumber} as never written. If you wrote it, void it instead.`
          : `This erases the cash payment of ${money(payment.amount)} to ${payment.payee}.`}
      </p>
      {reportGenerated && (
        <p className={styles.error}>
          The treasurer report for this event has been generated. It may already be in the ledger.
        </p>
      )}
      <div className={styles.buttons}>
        <button type="button" className={styles.primaryButton} onClick={() => void remove()}>
          Delete
        </button>
        {isCheck && (
          <button type="button" className={styles.button} onClick={onVoidInstead}>
            Void
          </button>
        )}
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
