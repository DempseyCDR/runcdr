"use client";
import { apiFetch } from "@/app/apiFetch";
import { EventSelector } from "@/app/EventSelector";
import AttendanceBreakdownView from "@/app/_components/AttendanceBreakdownView";
import { to12Hour } from "@/app/_components/EventConfirm";
import type { TreasurerReport } from "@/server/domain/treasurer/reportService";
import styles from "./treasurer.module.css";

import { useCallback, useEffect, useState } from "react";

type Report = Pick<
  TreasurerReport,
  | "header"
  | "attendance"
  | "recordedBy"
  | "receipts"
  | "expenses"
  | "card"
  | "deposits"
  | "eveningNote"
  | "paidElsewhere"
  | "paidTonightForEarlier"
>;

/** Dollars as the report reads them; a shortfall is "−$15.00". */
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
/** A column's figure, or nothing — the paper report leaves an unused column blank. */
const cell = (n: number) => (n ? money(n) : "");

const CATEGORY_LABEL: Record<string, string> = {
  admission: "Admission",
  merchandise: "Merchandise",
  gift_card: "Gift cards sold",
  misc_sales: "Other items",
  donation: "Donation",
  future_event: "Future event",
  membership: "Membership",
};

const ROLE_LABEL: Record<string, string> = {
  caller: "Caller",
  lead_musician: "Lead musician",
  musician: "Musician",
  open_band_musician: "Open band",
  sound_tech: "Sound tech",
  instructor: "Instructor",
};

/** Feature 082 (FR-032): what a deposit is made of, in the words of the slip. */
function makeUpOf(m: Extract<Report["deposits"][number], { kind: "main" }>["makeUp"]): string {
  return [
    `counted cash ${money(m.countedCash)}`,
    `less cash box seed ${money(m.seedFloat)}`,
    ...(m.otherPaidOut ? [`less paid out ${money(m.otherPaidOut)}`] : []),
    ...(m.performerCash ? [`less performers ${money(m.performerCash)}`] : []),
    ...(m.checks ? [`plus checks ${money(m.checks)}`] : []),
  ].join(", ");
}

/**
 * A note beneath its line (research R18). `indent` leaves that many columns empty first, so a receipt's
 * note starts where the name does; the note itself runs to the end of the row.
 */
function NoteRows({ notes, span, indent = 0 }: { notes: string[]; span: number; indent?: number }) {
  return notes.map((n, i) => (
    <tr key={i} className={styles.noteRow}>
      {Array.from({ length: indent }, (_, c) => (
        <td key={c} />
      ))}
      <td colSpan={span - indent}>{n}</td>
    </tr>
  ));
}

/** Line 1: the evening and whose it was. Line 2: who recorded it and who came. */
function Heading({ report }: { report: Report }) {
  const h = report.header;
  const first = [
    [h.date, to12Hour(h.startTime)].filter(Boolean).join(" "),
    h.title,
    h.venue,
    h.band ?? (h.musicians.join(", ") || null),
    h.caller && `caller ${h.caller}`,
    h.soundTech && `sound ${h.soundTech}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const { gateMoney, performerPayments } = report.recordedBy;
  const recorded =
    gateMoney === performerPayments || !performerPayments
      ? (gateMoney ?? "no one yet")
      : `${gateMoney ?? "no one"} (money) · ${performerPayments} (payments)`;
  return (
    <div role="group" aria-label="The evening" className={styles.heading}>
      <p className={styles.headLine}>{first}</p>
      <div className={styles.headLine}>
        <span>Recorded by {recorded}</span>
        <AttendanceBreakdownView breakdown={report.attendance} />
        <span>Total {report.attendance.attendance}</span>
      </div>
    </div>
  );
}

function Receipts({ receipts }: { receipts: Report["receipts"] }) {
  return (
    <section aria-labelledby="report-receipts" className={styles.section}>
      <h2 id="report-receipts">Receipts</h2>
      <table aria-label="Receipts" className={styles.table}>
        <thead>
          <tr>
            <th className={styles.qty}>Qty</th>
            <th>Name</th>
            <th className={styles.amount}>Cash</th>
            <th className={styles.amount}>Check</th>
            <th className={styles.amount}>Card</th>
          </tr>
        </thead>
        <tbody>
          {receipts.lines.map((l, i) => {
            const what = `${CATEGORY_LABEL[l.category] ?? l.category}${l.level ? ` (${l.level})` : ""}`;
            // Who else a membership covers, read from the payer's account (the quickstart walk, §3.3).
            const withWhom =
              l.members.length > 0
                ? `, with ${l.members.slice(0, -1).join(", ")}${l.members.length > 1 ? " and " : ""}${l.members.at(-1)}`
                : "";
            return [
              <tr key={i}>
                <td className={styles.qty}>{l.quantity ?? ""}</td>
                <td>{`${what}${l.name ? ` — ${l.name}` : ""}${withWhom}${l.for ? `, for ${l.for}` : ""}`}</td>
                <td className={styles.amount}>{cell(l.cash)}</td>
                <td className={styles.amount}>{cell(l.check)}</td>
                <td className={styles.amount}>{cell(l.card)}</td>
              </tr>,
              <NoteRows key={`${i}n`} notes={l.notes} span={5} indent={1} />,
            ];
          })}
          <tr>
            <td />
            <td>Admission</td>
            <td className={styles.amount}>{cell(receipts.admission.cash)}</td>
            <td />
            <td className={styles.amount}>{cell(receipts.admission.card)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={2}>Totals</th>
            <td className={styles.amount}>{money(receipts.totals.cash)}</td>
            <td className={styles.amount}>{money(receipts.totals.check)}</td>
            <td className={styles.amount}>{money(receipts.totals.card)}</td>
          </tr>
          <tr>
            <th colSpan={2}>Total receipts</th>
            <td colSpan={3} className={styles.amount}>
              {money(receipts.totals.total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function Expenses({ expenses }: { expenses: Report["expenses"] }) {
  const { payments, otherPaidOut, totals, rent, reconciliation } = expenses;
  const booked = reconciliation.booked > 0 || reconciliation.paid > 0;
  const empty = payments.length === 0 && otherPaidOut.amount === 0 && rent.amount === 0 && !booked;
  return (
    <section aria-labelledby="report-expenses" className={styles.section}>
      <h2 id="report-expenses">Expenses</h2>
      {empty ? (
        <p className={styles.quiet}>None</p>
      ) : (
        <table aria-label="Expenses" className={styles.table}>
          <thead>
            <tr>
              <th>Role</th>
              <th>Name</th>
              <th>Check #</th>
              <th className={styles.amount}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p, i) => [
              <tr key={i} className={p.voided ? styles.voided : undefined}>
                <td>{p.role ? ROLE_LABEL[p.role] : ""}</td>
                <td>{p.payee}</td>
                <td>{p.cash ? "cash" : p.checkNumber}</td>
                <td className={styles.amount}>{money(p.amount)}</td>
              </tr>,
              <NoteRows key={`${i}n`} notes={p.notes} span={4} />,
            ])}
            {otherPaidOut.amount > 0 && (
              <>
                <tr>
                  <td />
                  <td>Other cash paid out</td>
                  <td>cash</td>
                  <td className={styles.amount}>{money(otherPaidOut.amount)}</td>
                </tr>
                <NoteRows notes={otherPaidOut.reason ? [otherPaidOut.reason] : []} span={4} />
              </>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th>Totals</th>
              <td colSpan={2}>{`checks ${money(totals.check)} · cash ${money(totals.cash)}`}</td>
              <td className={styles.amount}>{money(totals.total)}</td>
            </tr>
            {/* Rent is owed, not paid at the gate, so it stands outside the totals (B54). */}
            {rent.amount > 0 && (
              <tr>
                <td>Rent</td>
                <td>{rent.vendor}</td>
                <td>unpaid</td>
                <td className={styles.amount}>{money(rent.amount)}</td>
              </tr>
            )}
            {/* Feature 085 (FR-008): did we pay everyone? A zero is an answer, so it is still shown. */}
            {booked && (
              <tr>
                <td>Performers</td>
                <td>{`booked ${money(reconciliation.booked)} · paid ${money(reconciliation.paid)}`}</td>
                <td>outstanding</td>
                <td className={styles.amount}>{money(reconciliation.outstanding)}</td>
              </tr>
            )}
          </tfoot>
        </table>
      )}
    </section>
  );
}

function Deposits({ report }: { report: Report }) {
  const { card } = report;
  return (
    <section aria-labelledby="report-deposits" className={styles.section}>
      <h2 id="report-deposits">Deposits</h2>
      <ul className={styles.list}>
        {report.deposits.map((d, i) =>
          d.kind === "main" ? (
            <li key={i} aria-label="Main deposit">
              <strong>Main deposit</strong> — {money(d.amount)} → ESL Checking
              <div className={styles.quiet}>{makeUpOf(d.makeUp)}</div>
            </li>
          ) : (
            <li key={i} aria-label={`Check from ${d.writer}`}>
              <strong>Check from {d.writer}</strong> — {money(d.amount)} → ESL Checking, deposited
              on its own
            </li>
          ),
        )}
      </ul>
      <p>{`Card: gross ${money(card.gross)} · ${card.transactions} transactions · fee ${money(card.fee)}`}</p>
    </section>
  );
}

function Notes({ report }: { report: Report }) {
  const { eveningNote, paidElsewhere, paidTonightForEarlier } = report;
  const bookings = [
    ...paidElsewhere.map(
      (p) => `${p.performer} — ${money(p.amount)} — paid at the ${p.eventDate} event`,
    ),
    ...paidTonightForEarlier.map(
      (p) => `${p.performer} — ${money(p.amount)} — for the ${p.eventDate} event, paid tonight`,
    ),
  ];
  return (
    <section aria-labelledby="report-notes" className={styles.section}>
      <h2 id="report-notes">Notes</h2>
      {eveningNote && <p className={styles.eveningNote}>{eveningNote}</p>}
      {bookings.length > 0 && (
        <ul aria-label="Bookings paid at another evening" className={styles.list}>
          {bookings.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {!eveningNote && bookings.length === 0 && <p className={styles.quiet}>None</p>}
    </section>
  );
}

// Feature 028 (P5-R1): the treasurer report is a single `/treasurer` page with the shared event selector
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
    <main className={styles.page}>
      {/* Feature 082 (FR-031, research R18, R19): the evening's gate report, laid out as the paper one —
          receipts on the left, expenses on the right — for a laptop, and printed on landscape letter. */}
      <h1>Gate report</h1>
      <EventSelector value={eventId} onSelect={(e) => setEventId(e.id)} defaultToMySeries />

      {error && <p role="alert">Error: {error}</p>}
      {!error && eventId && !report && <p>Loading…</p>}

      {report && (
        <>
          <article aria-label="Gate report" data-printable-report className={styles.report}>
            <Heading report={report} />
            <div className={styles.columns}>
              <div role="group" aria-label="Receipts and deposits" data-column="left">
                <Receipts receipts={report.receipts} />
                <Deposits report={report} />
              </div>
              <div role="group" aria-label="Expenses and notes" data-column="right">
                <Expenses expenses={report.expenses} />
                <Notes report={report} />
              </div>
            </div>
          </article>

          <button type="button" onClick={() => window.print()} className={styles.printButton}>
            Print
          </button>
        </>
      )}
    </main>
  );
}
