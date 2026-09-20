"use client";
import { useState } from "react";
import Dialog from "@/app/_components/Dialog";
import { send, type Sent } from "./savePayment";
import type { Refusal, RefusalHooks, SentBody } from "./types";
import styles from "./payments.module.css";

/** A refusal the page asks Mary about, with the payment that was refused and what to do next. */
export type Choice = { refusal: Refusal; body: SentBody; hooks: RefusalHooks };

type TakenDetails = { paymentId: string; voided: boolean; sameEvent: boolean };

/** Feature 081: the refusals the payments page turns into a question rather than an error. */
export const CHOICE_CODES = new Set(["CHECK_NUMBER_TAKEN", "SECOND_PAYMENT_TO_PAYEE"]);

/**
 * Feature 081 (FR-013, FR-014, research R3–R5): the server said no, and Mary decides.
 *
 * - **Check number already used** — add this booking to that check (only a live check at this event, and only
 *   for one booking), or change the number; a duplicate check book takes a letter.
 * - **Pay again?** — the performer already has a payment tonight; pay again only when told to.
 *
 * `onAnother` hands a further refusal (paying again can still find the number taken) back to the page.
 */
export default function ConfirmDialog({
  choice,
  onClose,
  onAnother,
}: {
  choice: Choice;
  onClose: () => void;
  onAnother: (next: Choice) => void;
}) {
  const { refusal, body, hooks } = choice;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finish(attempt: Promise<Sent>, again: SentBody) {
    setBusy(true);
    setError(null);
    const sent = await attempt;
    setBusy(false);
    if (sent.ok) {
      onClose();
      return hooks.done();
    }
    if (CHOICE_CODES.has(sent.code)) return onAnother({ refusal: sent, body: again, hooks });
    setError(sent.message);
  }

  if (refusal.code === "CHECK_NUMBER_TAKEN") {
    const d = refusal.details as TakenDetails;
    const line = body.lines?.[0];
    const canAdd =
      !hooks.noAdd && !d.voided && d.sameEvent && body.lines?.length === 1 && line !== undefined;
    return (
      <Dialog label="Check number already used" onClose={onClose}>
        <p>{refusal.message}</p>
        <p className={styles.explain}>
          {`From a duplicate check book? Add a letter, e.g. ${body.checkNumber ?? ""}A.`}
        </p>
        <div className={styles.buttons}>
          {canAdd && (
            <button
              type="button"
              className={styles.primaryButton}
              disabled={busy}
              onClick={() =>
                void finish(
                  send(`/api/performer-payments/${d.paymentId}/lines`, "POST", {
                    eventId: body.eventId,
                    bookingId: line.bookingId,
                    amount: line.amount,
                  }),
                  body,
                )
              }
            >
              {`Add this booking to check #${body.checkNumber}`}
            </button>
          )}
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              onClose();
              hooks.focusNumber?.();
            }}
          >
            Change the number
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

  return (
    <Dialog label="Pay again?" onClose={onClose}>
      <p>{`${refusal.message} Pay again?`}</p>
      <div className={styles.buttons}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={busy}
          onClick={() => {
            const again = { ...body, confirmSecondPayment: true };
            void finish(
              hooks.resend ? hooks.resend(again) : send("/api/performer-payments", "POST", again),
              again,
            );
          }}
        >
          Pay again
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
