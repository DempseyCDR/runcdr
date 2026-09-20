"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import Dialog from "@/app/_components/Dialog";
import PaymentEntry from "./PaymentEntry";
import PerformerPicker, { type PickedPerformer } from "./PerformerPicker";
import { money, ROLE_LABEL } from "./savePayment";
import type { RefusalHandler } from "./types";
import styles from "./payments.module.css";

type Unpaid = {
  bookingId: string;
  eventId: string;
  eventDate: string;
  performerType: string;
  booked: number;
};

/**
 * Feature 081 (FR-035, FR-036, MARY-R19): a performer not paid on the night is paid from a later evening —
 * the evening the money comes from. Mary finds the performer, picks one of their unpaid bookings from the 90
 * days before, and pays it by check or cash; the payment belongs to this evening.
 */
export default function EarlierBookingDialog({
  eventId,
  onClose,
  onSaved,
  onRefused,
}: {
  eventId: string;
  onClose: () => void;
  onSaved: () => void;
  onRefused: RefusalHandler;
}) {
  const [performer, setPerformer] = useState<PickedPerformer | null>(null);
  const [unpaid, setUnpaid] = useState<Unpaid[] | null>(null);
  const [chosen, setChosen] = useState<Unpaid | null>(null);

  useEffect(() => {
    if (!performer) return;
    setUnpaid(null);
    setChosen(null);
    void apiFetch(`/api/performers/${performer.id}/unpaid-bookings?forEvent=${eventId}`)
      .then((r) => r.json())
      .then((d) => setUnpaid(d.bookings ?? []));
  }, [performer, eventId]);

  return (
    <Dialog label="Pay an earlier booking" onClose={onClose}>
      {performer ? (
        <>
          <div className={styles.rowHead}>
            <p className={styles.name}>{performer.displayName}</p>
            <button type="button" className={styles.button} onClick={() => setPerformer(null)}>
              Change
            </button>
          </div>
          {unpaid?.length === 0 && (
            <p className={styles.explain}>No unpaid bookings in the 90 days before this event.</p>
          )}
          {unpaid && unpaid.length > 0 && (
            <fieldset className={styles.stack}>
              <legend>Booking to pay</legend>
              {unpaid.map((u) => (
                <label key={u.bookingId}>
                  <input
                    type="radio"
                    name="earlier-booking"
                    checked={chosen?.bookingId === u.bookingId}
                    onChange={() => setChosen(u)}
                  />
                  {`${u.eventDate} · ${ROLE_LABEL[u.performerType] ?? u.performerType} · ${money(u.booked)}`}
                </label>
              ))}
            </fieldset>
          )}
          {chosen && (
            <PaymentEntry
              key={chosen.bookingId}
              eventId={eventId}
              bookingId={chosen.bookingId}
              payeePerformerId={performer.id}
              booked={chosen.booked}
              onSaved={() => {
                onClose();
                onSaved();
              }}
              onRefused={onRefused}
            />
          )}
        </>
      ) : (
        <PerformerPicker eventId={eventId} onPicked={setPerformer} forPaying />
      )}
      <div className={styles.buttons}>
        <button type="button" className={styles.button} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
