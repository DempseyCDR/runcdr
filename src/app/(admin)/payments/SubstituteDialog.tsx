"use client";
import { useState } from "react";
import Dialog from "./Dialog";
import PerformerPicker, { type PickedPerformer } from "./PerformerPicker";
import { money, ROLE_LABEL, send } from "./savePayment";
import type { Booking } from "./types";
import styles from "./payments.module.css";

/**
 * Feature 081 (FR-025, MARY-R6): someone else played a booked slot. Mary picks the slot and finds (or creates)
 * the substitute, who takes the slot at its booked amount — there is no amount to change here; a different
 * payment is an override on the row, so the Treasurer sees the difference.
 */
export default function SubstituteDialog({
  eventId,
  bookings,
  onClose,
  onSaved,
}: {
  eventId: string;
  /** The event's bookings, in paying order. */
  bookings: Booking[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [slotId, setSlotId] = useState("");
  const [picked, setPicked] = useState<PickedPerformer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slot = bookings.find((b) => b.id === slotId);

  async function substitute() {
    if (!slot || !picked) return;
    setError(null);
    const sent = await send(`/api/bookings/${slot.id}/substitute`, "POST", {
      newPerformerId: picked.id,
    });
    if (!sent.ok) return setError(sent.message);
    onClose();
    onSaved();
  }

  return (
    <Dialog label="Substitute a performer" onClose={onClose}>
      <label className={styles.entry}>
        <span className={styles.wide}>Booking to replace</span>
        <select
          className={`${styles.input} ${styles.wide}`}
          value={slotId}
          onChange={(e) => setSlotId(e.target.value)}
        >
          <option value="">Choose…</option>
          {bookings.map((b) => (
            <option key={b.id} value={b.id}>
              {`${b.performerName} (${ROLE_LABEL[b.performerType] ?? b.performerType}) — ${money(b.payCents / 100)}`}
            </option>
          ))}
        </select>
      </label>
      {slot && (
        <p className={styles.explain}>
          {`The substitute takes the same booked amount: ${money(slot.payCents / 100)}.`}
        </p>
      )}
      {picked ? (
        <div className={styles.rowHead}>
          <p className={styles.name}>{picked.displayName}</p>
          <button type="button" className={styles.button} onClick={() => setPicked(null)}>
            Change
          </button>
        </div>
      ) : (
        <PerformerPicker eventId={eventId} onPicked={setPicked} />
      )}
      <div className={styles.buttons}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!slot || !picked}
          onClick={() => void substitute()}
        >
          Substitute
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
