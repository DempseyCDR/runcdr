import type { PaymentSummary } from "@/server/domain/payments/paymentSummary";
import styles from "./PaymentSummaryView.module.css";

const money = (dollars: number) => `$${Math.abs(dollars).toFixed(2)}`;
const signed = (dollars: number) => `${dollars < 0 ? "−" : "+"}${money(dollars)}`;

/**
 * Feature 081 (FR-004, FR-005): what an evening's performers are booked for and what is left to pay — the same
 * server computation at the top of /payments and /gate. The difference and the earlier-bookings lines appear
 * only when they say something.
 */
export default function PaymentSummaryView({ summary }: { summary: PaymentSummary }) {
  const left =
    summary.stillToPayCount > 0
      ? `Still to pay ${money(summary.stillToPay)} (${summary.stillToPayCount})`
      : "All paid";
  return (
    <section aria-label="Payments" className={styles.summary}>
      <p className={styles.line}>
        {`Booked ${money(summary.booked)} · Paid ${money(summary.paid)} · ${left}`}
      </p>
      {summary.difference !== 0 && (
        <p className={styles.secondary}>{`Difference ${signed(summary.difference)}`}</p>
      )}
      {summary.earlierPaidHere > 0 && (
        <p className={styles.secondary}>
          {`Earlier bookings paid tonight ${money(summary.earlierPaidHere)}`}
        </p>
      )}
    </section>
  );
}
