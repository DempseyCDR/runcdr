"use client";
import { useRef, useState, type ReactNode } from "react";
import { send } from "./savePayment";
import type { PaymentBody, RefusalHandler } from "./types";
import styles from "./payments.module.css";

/**
 * Feature 081 (FR-006–FR-008, FR-031): paying one booking — a check number or cash, an amount that defaults to
 * what was booked, and a notes box once the amount differs. Used on a performer's row and in "Pay an earlier
 * booking". A refusal the page can turn into a question goes to `onRefused`; any other is shown here.
 */
export default function PaymentEntry({
  eventId,
  bookingId,
  payeePerformerId,
  booked,
  onSaved,
  onRefused,
  children,
}: {
  /** The event being paid from — the evening the money comes out of. */
  eventId: string;
  bookingId: string;
  payeePerformerId: string;
  /** What the booking says, in dollars. */
  booked: number;
  onSaved: () => void;
  onRefused?: RefusalHandler;
  /** More buttons beside Record (Donated, Cancel). */
  children?: ReactNode;
}) {
  const [method, setMethod] = useState<"check" | "cash">("check");
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const numberField = useRef<HTMLInputElement>(null);

  const overridden = amount.trim() !== "" && Number(amount) !== booked;

  function reset() {
    setMethod("check");
    setNumber("");
    setAmount("");
    setNote("");
    setError(null);
  }

  async function record() {
    setError(null);
    const paid = amount.trim() === "" ? booked : Number(amount);
    if (!Number.isFinite(paid) || paid < 0) return setError("Enter the amount paid.");
    if (method === "check" && !number.trim()) return setError("Enter the check number.");
    const body: PaymentBody = {
      eventId,
      payeePerformerId,
      method,
      ...(method === "check" ? { checkNumber: number.trim() } : {}),
      ...(overridden && note.trim() ? { overrideReason: note.trim() } : {}),
      lines: [{ bookingId, amount: paid }],
    };
    const done = () => {
      reset();
      onSaved();
    };
    setSaving(true);
    const sent = await send("/api/performer-payments", "POST", body);
    setSaving(false);
    if (sent.ok) return done();
    if (onRefused?.(sent, body, { done, focusNumber: () => numberField.current?.focus() })) return;
    setError(sent.message);
  }

  return (
    <div className={styles.entry}>
      <fieldset className={styles.methods}>
        <legend className={styles.visuallyHidden}>How paid</legend>
        <label>
          <input
            type="radio"
            name={`method-${bookingId}`}
            checked={method === "check"}
            onChange={() => setMethod("check")}
          />
          Check
        </label>
        <label>
          <input
            type="radio"
            name={`method-${bookingId}`}
            checked={method === "cash"}
            onChange={() => setMethod("cash")}
          />
          Cash
        </label>
      </fieldset>
      {method === "check" && (
        <label>
          Check number
          <input
            ref={numberField}
            className={styles.input}
            inputMode="numeric"
            autoComplete="off"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </label>
      )}
      <label className={method === "cash" ? styles.wide : undefined}>
        Amount
        <input
          className={styles.input}
          inputMode="decimal"
          placeholder={booked.toFixed(2)}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      {overridden && (
        <label className={styles.wide}>
          Note
          <textarea
            className={styles.input}
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      )}
      <div className={`${styles.buttons} ${styles.wide}`}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={saving}
          onClick={() => void record()}
        >
          Record
        </button>
        {children}
      </div>
      {error && (
        <p role="alert" className={`${styles.error} ${styles.wide}`}>
          {error}
        </p>
      )}
    </div>
  );
}
