"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import type { EventRow } from "@/app/EventSelector";
import EventConfirm from "@/app/_components/EventConfirm";
import { localToday } from "@/app/localToday";
import PaymentSummaryView from "@/app/_components/PaymentSummaryView";
import { orderBookings } from "@/server/domain/payments/order";
import AddPerformerDialog from "./AddPerformerDialog";
import ConfirmDialog, { CHOICE_CODES, type Choice } from "./ConfirmDialog";
import DeleteDialog from "./DeleteDialog";
import Dialog from "@/app/_components/Dialog";
import EarlierBookingDialog from "./EarlierBookingDialog";
import EditPaymentDialog from "./EditPaymentDialog";
import PerformerRow from "./PerformerRow";
import SeveralPerformersDialog from "./SeveralPerformersDialog";
import SubstituteDialog from "./SubstituteDialog";
import VoidDialog from "./VoidDialog";
import { money, send } from "./savePayment";
import type { Booking, Payment, PaymentsList, RefusalHandler, RowState } from "./types";
import styles from "./payments.module.css";

type SeriesRow = { id: string; key: string; name: string };

/**
 * Feature 081 (FR-017): whether the treasurer report was generated after the evening itself — the Treasurer
 * works from it the next day, so a report printed on the night does not mean anything is in the ledger yet.
 */
function generatedAfterTheEvening(generatedAt: string | null | undefined, eventDate?: string) {
  return !!generatedAt && !!eventDate && localToday(new Date(generatedAt)) > eventDate;
}

/** Which row state a booking is in, from the payments recorded here and elsewhere. */
function rowState(b: Booking, list: PaymentsList): RowState {
  for (const p of list.payments) {
    if (p.voided) continue;
    const line = p.lines.find((l) => l.bookingId === b.id);
    if (line) return { kind: "paid", payment: p, lineAmount: line.amount };
  }
  const elsewhere = list.paidElsewhere[b.id];
  if (elsewhere) return { kind: "paidElsewhere", at: elsewhere };
  return b.payCents > 0 ? { kind: "toPay" } : { kind: "free" };
}

/**
 * Feature 081 (MARY-R1–R4, R6, R7, R9–R14, R17–R19): performer payments, built for a phone.
 *
 * The event is confirmed at the top as on /checkin, then the summary, then one row per booked performer in
 * paying order. Mary records a check or cash on a row; less common tasks open dialogs. Someone without payment
 * authority sees the same page without its controls (FR-030) — the server checks every write regardless.
 */
export default function PaymentsPage() {
  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [list, setList] = useState<PaymentsList | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [donateFor, setDonateFor] = useState<Booking | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [dialog, setDialog] = useState<"add" | "substitute" | "several" | "earlier" | null>(null);
  const [acting, setActing] = useState<{
    kind: "edit" | "void" | "delete";
    payment: Payment;
  } | null>(null);

  useEffect(() => {
    void apiFetch("/api/series")
      .then((r) => r.json())
      .then((d) => setSeries(d.items ?? []));
    void apiFetch("/api/me/capabilities")
      .then((r) => r.json())
      .then((d) => setCanWrite(d.performerPaymentWrite === true));
  }, []);

  const eventId = event?.id ?? "";

  const refresh = useCallback(async () => {
    if (!eventId) return;
    const [b, p] = await Promise.all([
      apiFetch(`/api/events/${eventId}/bookings`).then((r) => r.json()),
      apiFetch(`/api/events/${eventId}/performer-payments`).then((r) => r.json()),
    ]);
    setBookings(Array.isArray(b.bookings) ? b.bookings : []);
    setList({
      payments: p.payments ?? [],
      voidedByBooking: p.voidedByBooking ?? {},
      paidElsewhere: p.paidElsewhere ?? {},
      summary: p.summary,
      treasurerReportGeneratedAt: p.treasurerReportGeneratedAt ?? null,
    });
  }, [eventId]);

  useEffect(() => {
    setMessage(null);
    void refresh();
  }, [refresh]);

  async function confirmDonate() {
    const b = donateFor;
    if (!b) return;
    const sent = await send(`/api/bookings/${b.id}/donate`, "POST", {});
    setDonateFor(null);
    if (!sent.ok) return setMessage(sent.message);
    await refresh();
  }

  // Feature 081 (R3, R5): a number already used, or a second payment tonight, becomes a question.
  const onRefused: RefusalHandler = (refusal, body, hooks) => {
    if (!CHOICE_CODES.has(refusal.code)) return false;
    setChoice({ refusal, body, hooks });
    return true;
  };

  // Feature 081 (FR-015, FR-016, FR-034): what can be done to a payment; the page says once what Void and
  // Delete mean.
  const paidActions = (payment: Payment) => (
    <div className={styles.buttons}>
      <button
        type="button"
        className={styles.button}
        onClick={() => setActing({ kind: "edit", payment })}
      >
        Edit
      </button>
      {payment.method === "check" && (
        <button
          type="button"
          className={styles.button}
          onClick={() => setActing({ kind: "void", payment })}
        >
          Void
        </button>
      )}
      <button
        type="button"
        className={styles.button}
        onClick={() => setActing({ kind: "delete", payment })}
      >
        Delete
      </button>
    </div>
  );

  const rows = list
    ? orderBookings(bookings)
        .map((b) => ({ booking: b, state: rowState(b, list) }))
        // A performer who declined and was never paid is neither owed nor listed (research R10).
        .filter(
          (r) =>
            r.booking.status !== "declined" ||
            r.state.kind === "paid" ||
            r.state.kind === "paidElsewhere",
        )
    : [];

  // Feature 081 (FR-037): tonight's payments for other evenings' bookings, listed apart from tonight's rows.
  const earlierPaid = (list?.payments ?? []).flatMap((payment) =>
    payment.voided
      ? []
      : payment.lines.filter((l) => l.eventId !== eventId).map((line) => ({ payment, line })),
  );

  const unpaid = rows
    .filter((r) => r.state.kind === "toPay" || r.state.kind === "free")
    .map((r) => r.booking);

  return (
    <main className={styles.page}>
      <EventConfirm event={event} series={series} onSelect={setEvent} />
      {list?.summary && <PaymentSummaryView summary={list.summary} />}
      {message && (
        <p role="alert" className={styles.error}>
          {message}
        </p>
      )}

      {/* Feature 081 (FR-018): what Void and Delete mean, once, where a phone can read it without hovering. */}
      {canWrite && list && (
        <p className={styles.explain}>Void: the check was written. Delete: it was never written.</p>
      )}
      {list && (
        <ul aria-label="Performers" className={styles.list}>
          {rows.map(({ booking, state }) => (
            <PerformerRow
              key={booking.id}
              booking={booking}
              eventId={eventId}
              state={state}
              voids={list.voidedByBooking[booking.id] ?? []}
              canWrite={canWrite}
              onSaved={() => void refresh()}
              onDonate={setDonateFor}
              onRefused={onRefused}
              paidActions={paidActions}
            />
          ))}
        </ul>
      )}

      {earlierPaid.length > 0 && (
        <>
          <h2 className={styles.sectionHeading}>Earlier bookings paid tonight</h2>
          <ul aria-label="Earlier bookings paid tonight" className={styles.list}>
            {earlierPaid.map(({ payment, line }) => (
              <li key={`${payment.id}-${line.bookingId}`} className={styles.row}>
                <p className={styles.paid}>
                  {`${line.performer} — ${line.eventDate} — ${
                    payment.method === "cash"
                      ? `Cash ${money(line.amount)}`
                      : `Check #${payment.checkNumber} ${money(line.amount)}`
                  }`}
                </p>
                {payment.overrideReason && <p className={styles.note}>{payment.overrideReason}</p>}
                {canWrite && paidActions(payment)}
              </li>
            ))}
          </ul>
        </>
      )}

      {canWrite && list && (
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={() => setDialog("add")}>
            Add a performer
          </button>
          <button type="button" className={styles.button} onClick={() => setDialog("substitute")}>
            Substitute a performer
          </button>
          <button type="button" className={styles.button} onClick={() => setDialog("several")}>
            One check, several performers
          </button>
          <button type="button" className={styles.button} onClick={() => setDialog("earlier")}>
            Pay an earlier booking
          </button>
        </div>
      )}

      {dialog === "add" && (
        <AddPerformerDialog
          eventId={eventId}
          onClose={() => setDialog(null)}
          onSaved={() => void refresh()}
        />
      )}
      {dialog === "substitute" && (
        <SubstituteDialog
          eventId={eventId}
          bookings={rows.map((r) => r.booking)}
          onClose={() => setDialog(null)}
          onSaved={() => void refresh()}
        />
      )}
      {dialog === "earlier" && (
        <EarlierBookingDialog
          eventId={eventId}
          onClose={() => setDialog(null)}
          onSaved={() => void refresh()}
          onRefused={onRefused}
        />
      )}
      {dialog === "several" && (
        <SeveralPerformersDialog
          eventId={eventId}
          bookings={unpaid}
          onClose={() => setDialog(null)}
          onSaved={() => void refresh()}
          onRefused={onRefused}
        />
      )}

      {acting?.kind === "edit" && (
        <EditPaymentDialog
          payment={acting.payment}
          bookings={bookings}
          unpaid={unpaid}
          onClose={() => setActing(null)}
          onSaved={() => void refresh()}
          onRefused={onRefused}
        />
      )}
      {acting?.kind === "void" && (
        <VoidDialog
          payment={acting.payment}
          onClose={() => setActing(null)}
          onSaved={() => void refresh()}
        />
      )}
      {acting?.kind === "delete" && (
        <DeleteDialog
          payment={acting.payment}
          reportGenerated={generatedAfterTheEvening(
            list?.treasurerReportGeneratedAt,
            event?.eventDate,
          )}
          onClose={() => setActing(null)}
          onSaved={() => void refresh()}
          onVoidInstead={() => setActing({ kind: "void", payment: acting.payment })}
        />
      )}

      {choice && (
        <ConfirmDialog choice={choice} onClose={() => setChoice(null)} onAnother={setChoice} />
      )}

      {donateFor && (
        <Dialog label="Donated fee" onClose={() => setDonateFor(null)}>
          <p>
            {donateFor.performerName} is donating the fee — no payment will be made, and the booking
            is kept as donated.
          </p>
          <div className={styles.buttons}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void confirmDonate()}
            >
              Confirm donation
            </button>
            <button type="button" className={styles.button} onClick={() => setDonateFor(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
