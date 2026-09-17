"use client";
import { apiFetch } from "@/app/apiFetch";
import { EventSelector } from "@/app/EventSelector";
import AttendanceBreakdownView from "@/app/_components/AttendanceBreakdownView";
import type { AttendanceBreakdown } from "@/server/domain/attendance/breakdownService";
import type { PaymentReportLine, TreasurerReport } from "@/server/domain/treasurer/reportService";

import { useCallback, useEffect, useState } from "react";

type Line = {
  category: string;
  class: string;
  cash: number;
  card: number;
  total: number;
};
type Report = {
  event: { id: string; date: string; seriesKey: string };
  gateSalesSummary: {
    customer: string;
    posVerification: { gross: number; fee: number };
    lines: Line[];
  };
  namedCustomerReceipts: {
    kind: string;
    contact: string;
    contactId: string | null;
    class: string;
    amount: number;
  }[];
  bills: { vendor: string; class: string; amount: number }[];
  performerPayments: {
    payee: string;
    amount: number;
    class: string;
    checkNumber: string | null;
  }[];
  deposit: { amount: number };
  fees: { doorFee: number; onlineFee: number; total: number };
  compCount: number;
  giftCardRedemptionCount: number;
  attendance: AttendanceBreakdown;
} & Pick<TreasurerReport, "checks" | "cashPayments" | "otherCashPaidOut" | "paidElsewhere">;

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * Feature 081 (FR-028): what a payment paid — each booking's booked and paid amounts where they differ, the
 * event a booking was at when it was not this one, and Mary's note when there is a difference.
 */
function PaidLines({ payment }: { payment: PaymentReportLine }) {
  const shown = payment.lines.filter((l) => l.paid !== l.booked || l.eventDate);
  const differs = payment.lines.some((l) => l.paid !== l.booked);
  if (shown.length === 0) return null;
  return (
    <div style={{ color: "#555", fontSize: "0.9em" }}>
      {shown.map((l, i) => (
        <div key={i}>
          {l.paid !== l.booked
            ? `${l.performer}: booked ${money(l.booked)} · paid ${money(l.paid)}`
            : `${l.performer}: ${money(l.paid)}`}
          {l.eventDate ? ` — for the ${l.eventDate} event` : ""}
        </div>
      ))}
      {differs && payment.note && <div>{payment.note}</div>}
    </div>
  );
}

// Feature 028 (P5-R1): the treasurer report is now a single `/treasurer` page with the shared event selector
// (in-page state — the event is no longer a `[eventId]` URL param; the old `/treasurer/latest` nav entry is
// fixed to point here). The selector defaults to the most recent event ≤ today; the report loads on select
// and reloads when the selected event changes.
export default function TreasurerReportPage() {
  const [eventId, setEventId] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!eventId) {
      setReport(null);
      setError(null);
      return;
    }
    setError(null);
    const r = await apiFetch(`/api/events/${eventId}/treasurer-report`);
    if (!r.ok) {
      setReport(null);
      setError((await r.json()).error?.message ?? "Failed");
      return;
    }
    setReport(await r.json());
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main style={{ padding: 24, maxWidth: 820 }}>
      <h1>Treasurer Report</h1>
      <EventSelector value={eventId} onSelect={(e) => setEventId(e.id)} />

      {error && <p role="alert">Error: {error}</p>}
      {!error && eventId && !report && <p>Loading…</p>}

      {report && (
        <>
          <h2>
            {report.event.date} ({report.event.seriesKey})
          </h2>

          {/* Feature 079 (FR-027): the evening's attendance breakdown — the same figures as the door and the
              gate page. Its comps and gift cards are feature 040's reconciliation counts (P6-R9). */}
          <AttendanceBreakdownView breakdown={report.attendance} />

          {/* Feature 040 (P6-R8): sections read in QBO data-entry order — Sales Receipts → Bills →
              Performer Payments → Deposit → Fees. */}
          <h2>Sales Receipts</h2>

          <h3>Gate Sales Summary — {report.gateSalesSummary.customer}</h3>
          <p>
            Card verification: gross {money(report.gateSalesSummary.posVerification.gross)} · fee{" "}
            {money(report.gateSalesSummary.posVerification.fee)}
          </p>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Class</th>
                <th>Cash</th>
                <th>Card</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {report.gateSalesSummary.lines.map((l) => (
                <tr key={l.category}>
                  <td>{l.category}</td>
                  <td>{l.class}</td>
                  <td>{money(l.cash)}</td>
                  <td>{money(l.card)}</td>
                  <td>{money(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Named-Customer Receipts</h3>
          <ul>
            {report.namedCustomerReceipts.map((r, i) => (
              <li key={`${r.kind}:${r.contactId ?? i}`}>
                {r.kind} — <strong>{r.contact}</strong> — {money(r.amount)} ({r.class})
              </li>
            ))}
            {report.namedCustomerReceipts.length === 0 && <li style={{ color: "#888" }}>None</li>}
          </ul>

          <h2>Bills</h2>
          <p style={{ color: "#888", marginTop: 0 }}>
            To record in QBO — not paid through the Financial Secretary.
          </p>
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Class</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {report.bills.map((b, i) => (
                <tr key={i}>
                  <td>{b.vendor}</td>
                  <td>{b.class}</td>
                  <td>{money(b.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Feature 081 (FR-027): every check — live and voided — in check-number order. */}
          <h2>Performer Payments</h2>
          <ul aria-label="Checks">
            {report.checks.map((c) => (
              <li key={c.checkNumber}>
                <strong>#{c.checkNumber}</strong> — {c.payee} — {money(c.amount)} ({c.class})
                {c.voided && (
                  <div style={{ color: "#a15c00" }}>
                    {`Voided — ${c.voidReason ?? "no reason"}${c.replacedBy ? ` · replaced by #${c.replacedBy}` : ""}`}
                  </div>
                )}
                <PaidLines payment={c} />
              </li>
            ))}
            {report.checks.length === 0 && <li style={{ color: "#888" }}>No checks</li>}
          </ul>
          {report.paidElsewhere.length > 0 && (
            <>
              <h3>Paid at another event</h3>
              <ul aria-label="Paid at another event">
                {report.paidElsewhere.map((p, i) => (
                  <li key={i}>
                    {`${p.performer} — ${money(p.amount)} — paid at the ${p.eventDate} event`}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* Feature 081 (FR-033, FR-038): cash out of the takings — to performers, and everything else. */}
          <section aria-label="Cash paid out">
            <h2>Cash paid out</h2>
            <ul>
              {report.cashPayments.map((c, i) => (
                <li key={i}>
                  <span>{`${c.payee} — ${money(c.amount)}`}</span>
                  <PaidLines payment={c} />
                </li>
              ))}
              {report.otherCashPaidOut.amount > 0 && (
                <li>
                  {`Other cash paid out: ${money(report.otherCashPaidOut.amount)}${
                    report.otherCashPaidOut.reason ? ` — ${report.otherCashPaidOut.reason}` : ""
                  }`}
                </li>
              )}
              {report.cashPayments.length === 0 && report.otherCashPaidOut.amount === 0 && (
                <li style={{ color: "#888" }}>None</li>
              )}
            </ul>
          </section>

          <h2>Deposit</h2>
          <p>{money(report.deposit.amount)} → ESL Checking</p>

          <h2>Fees (informational)</h2>
          <p>
            Door {money(report.fees.doorFee)} · Online {money(report.fees.onlineFee)} · Total{" "}
            {money(report.fees.total)}
          </p>

          <button onClick={() => window.print()} style={{ marginTop: 16 }}>
            Print
          </button>
        </>
      )}
    </main>
  );
}
