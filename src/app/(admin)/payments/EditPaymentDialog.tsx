"use client";
import { useRef, useState } from "react";
import Dialog from "./Dialog";
import { money, ROLE_LABEL, send } from "./savePayment";
import type { Booking, Payment, RefusalHandler, SentBody } from "./types";
import styles from "./payments.module.css";

type Line = { bookingId: string; performer: string; booked: number; amount: string };

/**
 * Feature 081 (FR-015, MARY-R12): correct a payment entered before it was made — its number, who it is made
 * out to, and which bookings it pays with each amount, whether it pays one booking or several. Cash has no
 * number and pays one booking. The server's rules apply as for a new payment.
 */
export default function EditPaymentDialog({
  payment,
  bookings,
  unpaid,
  onClose,
  onSaved,
  onRefused,
}: {
  payment: Payment;
  /** The event's bookings, for choosing who the payment is made out to. */
  bookings: Booking[];
  /** The event's bookings nobody has paid yet, which the payment could also pay. */
  unpaid: Booking[];
  onClose: () => void;
  onSaved: () => void;
  onRefused: RefusalHandler;
}) {
  const isCheck = payment.method === "check";
  const [number, setNumber] = useState(payment.checkNumber ?? "");
  const [payee, setPayee] = useState(payment.payeePerformerId);
  const [note, setNote] = useState(payment.overrideReason ?? "");
  const [lines, setLines] = useState<Line[]>(
    payment.lines.map((l) => ({
      bookingId: l.bookingId,
      performer: l.performer,
      booked: l.booked,
      amount: l.amount.toFixed(2),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const numberField = useRef<HTMLInputElement>(null);

  const payees = new Map<string, string>([[payment.payeePerformerId, payment.payee]]);
  for (const b of bookings) payees.set(b.performerId, b.performerName);
  const addable = unpaid.filter((b) => !lines.some((l) => l.bookingId === b.id));
  const differs = lines.some((l) => Number(l.amount) !== l.booked);

  function add(bookingId: string) {
    const b = unpaid.find((u) => u.id === bookingId);
    if (!b) return;
    setLines((ls) => [
      ...ls,
      {
        bookingId: b.id,
        performer: b.performerName,
        booked: b.payCents / 100,
        amount: (b.payCents / 100).toFixed(2),
      },
    ]);
  }

  async function save() {
    setError(null);
    if (lines.length === 0)
      return setError("A payment pays at least one booking — delete it instead.");
    if (isCheck && !number.trim()) return setError("Enter the check number.");
    if (lines.some((l) => !(Number(l.amount) >= 0))) return setError("Enter each amount.");
    const body: SentBody = {
      ...(isCheck ? { checkNumber: number.trim() } : {}),
      payeePerformerId: payee,
      ...(note.trim() !== (payment.overrideReason ?? "")
        ? { overrideReason: note.trim() || null }
        : {}),
      lines: lines.map((l) => ({ bookingId: l.bookingId, amount: Number(l.amount) })),
    };
    const url = `/api/performer-payments/${payment.id}`;
    const patch = (b: SentBody) => send(url, "PATCH", b);
    const done = () => {
      onClose();
      onSaved();
    };
    const sent = await patch(body);
    if (sent.ok) return done();
    const handled = onRefused(sent, body, {
      done,
      resend: patch,
      noAdd: true,
      focusNumber: () => numberField.current?.focus(),
    });
    if (!handled) setError(sent.message);
  }

  return (
    <Dialog label="Edit payment" onClose={onClose}>
      <div className={styles.entry}>
        {isCheck && (
          <label className={styles.wide}>
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
        <label className={styles.wide}>
          Payee
          <select className={styles.input} value={payee} onChange={(e) => setPayee(e.target.value)}>
            {[...payees.entries()].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className={`${styles.wide} ${styles.stack}`}>
          <legend>{isCheck ? "Bookings this check pays" : "Booking paid"}</legend>
          {lines.map((l) => (
            <div key={l.bookingId} className={styles.buttons}>
              <label>
                {`Amount for ${l.performer}`}
                <input
                  className={styles.input}
                  inputMode="decimal"
                  value={l.amount}
                  onChange={(e) =>
                    setLines((ls) =>
                      ls.map((x) =>
                        x.bookingId === l.bookingId ? { ...x, amount: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <span className={styles.quiet}>{`booked ${money(l.booked)}`}</span>
              {isCheck && (
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => setLines((ls) => ls.filter((x) => x.bookingId !== l.bookingId))}
                >
                  {`Remove ${l.performer}`}
                </button>
              )}
            </div>
          ))}
          {isCheck && addable.length > 0 && (
            <label>
              Add a booking
              <select className={styles.input} value="" onChange={(e) => add(e.target.value)}>
                <option value="">Choose…</option>
                {addable.map((b) => (
                  <option key={b.id} value={b.id}>
                    {`${b.performerName} (${ROLE_LABEL[b.performerType] ?? b.performerType})`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
        {(differs || payment.overrideReason) && (
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
        <button type="button" className={styles.primaryButton} onClick={() => void save()}>
          Save
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
