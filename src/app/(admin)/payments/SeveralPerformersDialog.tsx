"use client";
import { useState } from "react";
import Dialog from "@/app/_components/Dialog";
import { money, ROLE_LABEL, send } from "./savePayment";
import type { Booking, PaymentBody, RefusalHandler } from "./types";
import styles from "./payments.module.css";

/**
 * Feature 081 (FR-032, MARY-R9): one check paying several bookings — a band leader paid for the band, say.
 * Always a numbered check: cash settles one booking. Each ticked booking takes its booked amount unless
 * changed; a note is offered once any amount differs.
 */
export default function SeveralPerformersDialog({
  eventId,
  bookings,
  onClose,
  onSaved,
  onRefused,
}: {
  eventId: string;
  /** The event's bookings not yet paid. */
  bookings: Booking[];
  onClose: () => void;
  onSaved: () => void;
  onRefused: RefusalHandler;
}) {
  const payees = [...new Map(bookings.map((b) => [b.performerId, b.performerName])).entries()];
  const [payee, setPayee] = useState("");
  const [number, setNumber] = useState("");
  const [note, setNote] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const ticked = bookings.filter((b) => b.id in amounts);
  const overridden = ticked.some((b) => Number(amounts[b.id]) !== b.payCents / 100);

  function toggle(b: Booking) {
    setAmounts((m) => {
      if (!(b.id in m)) return { ...m, [b.id]: (b.payCents / 100).toFixed(2) };
      const next = { ...m };
      delete next[b.id];
      return next;
    });
  }

  async function record() {
    setError(null);
    if (!payee) return setError("Choose who the check is made out to.");
    if (ticked.length === 0) return setError("Tick the bookings this check pays.");
    if (!number.trim()) return setError("Enter the check number.");
    if (ticked.some((b) => !(Number(amounts[b.id]) >= 0))) return setError("Enter each amount.");
    const body: PaymentBody = {
      eventId,
      payeePerformerId: payee,
      method: "check",
      checkNumber: number.trim(),
      ...(overridden && note.trim() ? { overrideReason: note.trim() } : {}),
      lines: ticked.map((b) => ({ bookingId: b.id, amount: Number(amounts[b.id]) })),
    };
    const done = () => {
      onClose();
      onSaved();
    };
    const sent = await send("/api/performer-payments", "POST", body);
    if (sent.ok) return done();
    if (onRefused(sent, body, { done })) return;
    setError(sent.message);
  }

  return (
    <Dialog label="One check, several performers" onClose={onClose}>
      <div className={styles.entry}>
        <label className={styles.wide}>
          Payee
          <select className={styles.input} value={payee} onChange={(e) => setPayee(e.target.value)}>
            <option value="">Made out to…</option>
            {payees.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.wide}>
          Check number
          <input
            className={styles.input}
            inputMode="numeric"
            autoComplete="off"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </label>
        <fieldset className={`${styles.wide} ${styles.stack}`}>
          <legend>Bookings this check pays</legend>
          {bookings.map((b) => (
            <div key={b.id}>
              <label>
                <input type="checkbox" checked={b.id in amounts} onChange={() => toggle(b)} />
                {`${b.performerName} (${ROLE_LABEL[b.performerType] ?? b.performerType}) — booked ${money(b.payCents / 100)}`}
              </label>
              {b.id in amounts && (
                <label>
                  {`Amount for ${b.performerName}`}
                  <input
                    className={styles.input}
                    inputMode="decimal"
                    value={amounts[b.id]}
                    onChange={(e) => setAmounts((m) => ({ ...m, [b.id]: e.target.value }))}
                  />
                </label>
              )}
            </div>
          ))}
        </fieldset>
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
      </div>
      <div className={styles.buttons}>
        <button type="button" className={styles.primaryButton} onClick={() => void record()}>
          Record check
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
