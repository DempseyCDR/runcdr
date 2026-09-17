"use client";
import { useState } from "react";
import PaymentEntry from "./PaymentEntry";
import { money, ROLE_LABEL } from "./savePayment";
import type { Booking, Payment, RefusalHandler, RowState, VoidedLine } from "./types";
import styles from "./payments.module.css";

/**
 * Feature 081 (FR-003–FR-010, FR-031): one performer on the payments page. A booking still to pay takes a
 * check number — or cash — and an amount that defaults to what was booked; a different amount opens a notes
 * box. A free booking offers **Pay**; a paid one shows how it was paid.
 */
export default function PerformerRow({
  booking,
  eventId,
  state,
  voids,
  canWrite,
  onSaved,
  onDonate,
  onRefused,
  paidActions,
}: {
  booking: Booking;
  eventId: string;
  state: RowState;
  voids: VoidedLine[];
  canWrite: boolean;
  onSaved: () => void;
  onDonate: (b: Booking) => void;
  onRefused?: RefusalHandler;
  /** The paid row's actions (edit, void, delete), supplied by the page. */
  paidActions?: (payment: Payment) => React.ReactNode;
}) {
  const booked = booking.payCents / 100;
  const [open, setOpen] = useState(false);
  const role = ROLE_LABEL[booking.performerType] ?? booking.performerType;
  // Feature 081 (FR-021): a void's history sits right under how the booking was paid, like its note.
  const voidLines = voids.map((v) => (
    <p key={v.paymentId} className={styles.quiet}>
      {`Voided #${v.checkNumber}${v.reason ? ` — ${v.reason}` : ""}`}
    </p>
  ));

  const entering = canWrite && (state.kind === "toPay" || (state.kind === "free" && open));

  return (
    <li aria-label={booking.performerName} className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.name}>{booking.performerName}</span>
        <span className={styles.meta}>
          {role} ·{" "}
          <span>
            {state.kind === "free" ? (booking.isDonated ? "donated" : "free") : money(booked)}
          </span>
        </span>
      </div>

      {state.kind === "paid" && (
        <>
          <p className={styles.paid}>
            {state.payment.method === "cash"
              ? `Cash ${money(state.lineAmount)}`
              : `Check #${state.payment.checkNumber} ${money(state.lineAmount)}${
                  state.payment.lines.length > 1
                    ? ` · check total ${money(state.payment.amount)}`
                    : ""
                }`}
          </p>
          {state.payment.overrideReason && (
            <p className={styles.note}>{state.payment.overrideReason}</p>
          )}
          {voidLines}
          {canWrite && paidActions?.(state.payment)}
        </>
      )}

      {state.kind === "paidElsewhere" && (
        <p className={styles.paid}>{`Paid at ${state.at.eventDate}`}</p>
      )}

      {state.kind !== "paid" && voidLines}

      {canWrite && state.kind === "free" && !open && (
        <div className={styles.buttons}>
          <button type="button" className={styles.button} onClick={() => setOpen(true)}>
            Pay
          </button>
        </div>
      )}

      {entering && (
        <PaymentEntry
          eventId={eventId}
          bookingId={booking.id}
          payeePerformerId={booking.performerId}
          booked={booked}
          onSaved={() => {
            setOpen(false);
            onSaved();
          }}
          onRefused={onRefused}
        >
          {state.kind === "toPay" && (
            <button type="button" className={styles.button} onClick={() => onDonate(booking)}>
              Donated
            </button>
          )}
          {state.kind === "free" && (
            <button type="button" className={styles.button} onClick={() => setOpen(false)}>
              Cancel
            </button>
          )}
        </PaymentEntry>
      )}
    </li>
  );
}
