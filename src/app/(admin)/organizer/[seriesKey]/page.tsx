"use client";
import { apiFetch } from "@/app/apiFetch";
import { useRouter } from "next/navigation";
import PrintBar from "@/app/_components/PrintBar";
import styles from "./organizer.module.css";

import { Fragment, use, useCallback, useEffect, useState } from "react";

type Performer = { name: string; type: string; amount: number };
type Fyi = {
  donations: number;
  memberships: number;
  futureEvent: number;
  giftCards: number;
  miscSales: number;
};
type Row = {
  eventId: string;
  date: string;
  series: string;
  caller: string;
  band: string;
  dancers: number;
  grossGate: number;
  merchandise: number;
  rent: number;
  performerTotal: number;
  ongoingExpense: number;
  miscExpenses: number;
  danceNet: number;
  danceNetNegative: boolean;
  avgTicket: number;
  breakEvenDancers: number | null;
  performers: Performer[];
  fyi: Fyi;
};
type Bucket = {
  count: number;
  avgDancers: number;
  avgGross: number;
  avgDanceNet: number;
  avgTicket: number;
};
type Quarter = Bucket & { quarter: number };
type Trend = {
  weeks: number;
  danceNet: { date: string; value: number; negative: boolean }[];
  danceNetTrend: { date: string; value: number }[];
  attendance: { date: string; value: number }[];
  attendanceTrend: { date: string; value: number }[];
} | null;
type Report = {
  series: { key: string; name: string };
  perDanceRows: Row[];
  quarterlySummary: { quarters: Quarter[]; ytd: Bucket; lastYear: Bucket };
  trend: Trend;
};

const money = (n: number) => `$${n.toFixed(2)}`;

/** Minimal inline sparkline: bars for values (negatives red), overlaid trend line. */
function Sparkline({
  bars,
  line,
  height = 60,
}: {
  bars: { value: number; negative?: boolean }[];
  line: { value: number }[];
  height?: number;
}) {
  const w = Math.max(bars.length * 10, 100);
  const vals = [...bars.map((b) => b.value), ...line.map((l) => l.value), 0];
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const span = max - min || 1;
  const y = (v: number) => height - ((v - min) / span) * height;
  const bw = w / Math.max(bars.length, 1);
  const linePts = line.map((l, i) => `${i * bw + bw / 2},${y(l.value)}`).join(" ");
  return (
    <svg width={w} height={height} style={{ display: "block" }}>
      <line x1={0} y1={y(0)} x2={w} y2={y(0)} stroke="#ccc" />
      {bars.map((b, i) => {
        const top = Math.min(y(b.value), y(0));
        const h = Math.abs(y(b.value) - y(0));
        return (
          <rect
            key={i}
            x={i * bw + 1}
            y={top}
            width={Math.max(bw - 2, 1)}
            height={h}
            fill={b.negative ? "#d9534f" : "#5cb85c"}
          />
        );
      })}
      <polyline points={linePts} fill="none" stroke="#0275d8" strokeWidth={1.5} />
    </svg>
  );
}

export default function OrganizerReportPage({
  params,
}: {
  params: Promise<{ seriesKey: string }>;
}) {
  const { seriesKey } = use(params);
  const router = useRouter();
  const [allSeries, setAllSeries] = useState<{ key: string; name: string }[]>([]);
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/organizer/${seriesKey}/report?year=${year}`);
    if (!r.ok) {
      setError((await r.json()).error?.message ?? "Failed");
      return;
    }
    setError(null);
    setReport(await r.json());
  }, [seriesKey, year]);

  useEffect(() => {
    void load();
  }, [load]);

  // Feature 090 (FR-022): every series, for the selector — every volunteer may read every report.
  useEffect(() => {
    void apiFetch("/api/series")
      .then((r) => r.json())
      .then((d: { items?: { key: string; name: string }[] }) => setAllSeries(d.items ?? []));
  }, []);

  if (error) return <main style={{ padding: 24 }}>Error: {error}</main>;
  if (!report) return <main style={{ padding: 24 }}>Loading…</main>;

  const { quarters, ytd, lastYear } = report.quarterlySummary;

  return (
    <main style={{ padding: 24, maxWidth: 1200 }}>
      {/* Feature 090 (FR-022): which series and which year — outside the report, so they never print. */}
      <div className={styles.controls}>
        <label className={styles.control}>
          Series
          <select value={seriesKey} onChange={(e) => router.push(`/organizer/${e.target.value}`)}>
            {allSeries.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.control}>
          Year
          <input
            type="number"
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
      </div>

      {/* Feature 090 (FR-023): the report — all that prints (PrintBar's rules), its heading as text. */}
      <article data-printable-report className={styles.report}>
        <h1>
          {report.series.name} — Organizer Report {year}
        </h1>

        <h2>Per-dance results</h2>
        <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
          <thead>
            <tr>
              {[
                "Date",
                "Series",
                "Caller",
                "Band",
                "Dancers",
                "Gross gate",
                "Merch",
                "Rent",
                "Performers",
                "Ongoing",
                "Misc",
                "Dance Net",
                "Avg ticket",
                "Break-even",
              ].map((h) => (
                <th
                  key={h}
                  style={{ borderBottom: "1px solid #999", textAlign: "right", padding: "4px 6px" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.perDanceRows.map((r) => (
              <Fragment key={r.eventId}>
                <tr
                  onClick={() => setOpenRow(openRow === r.eventId ? null : r.eventId)}
                  style={{ cursor: "pointer" }}
                >
                  <td style={{ padding: "4px 6px" }}>{r.date}</td>
                  <td style={{ padding: "4px 6px" }}>{r.series}</td>
                  <td style={{ padding: "4px 6px" }}>{r.caller}</td>
                  <td style={{ padding: "4px 6px" }}>{r.band}</td>
                  <td style={{ textAlign: "right", padding: "4px 6px" }}>{r.dancers}</td>
                  <td style={{ textAlign: "right", padding: "4px 6px" }}>{money(r.grossGate)}</td>
                  <td style={{ textAlign: "right", padding: "4px 6px" }}>{money(r.merchandise)}</td>
                  <td style={{ textAlign: "right", padding: "4px 6px" }}>{money(r.rent)}</td>
                  <td style={{ textAlign: "right", padding: "4px 6px" }}>
                    {money(r.performerTotal)}
                  </td>
                  <td style={{ textAlign: "right", padding: "4px 6px" }}>
                    {money(r.ongoingExpense)}
                  </td>
                  <td style={{ textAlign: "right", padding: "4px 6px" }}>
                    {money(r.miscExpenses)}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      padding: "4px 6px",
                      color: r.danceNetNegative ? "#d9534f" : "inherit",
                      fontWeight: 600,
                    }}
                  >
                    {money(r.danceNet)}
                  </td>
                  <td style={{ textAlign: "right", padding: "4px 6px" }}>{money(r.avgTicket)}</td>
                  <td style={{ textAlign: "right", padding: "4px 6px" }}>
                    {r.breakEvenDancers ?? "—"}
                  </td>
                </tr>
                {openRow === r.eventId && (
                  <tr>
                    <td colSpan={14} style={{ background: "#f7f7f7", padding: "8px 12px" }}>
                      {r.band && (
                        <>
                          <strong>Band:</strong> {r.band}
                          <br />
                        </>
                      )}
                      <strong>Performers:</strong>{" "}
                      {r.performers.length === 0
                        ? "none"
                        : r.performers
                            .map((p) => `${p.name} (${p.type}, ${money(p.amount)})`)
                            .join(", ")}
                      <br />
                      <strong>FYI (pass-through):</strong> donations {money(r.fyi.donations)},
                      memberships {money(r.fyi.memberships)}, future event{" "}
                      {money(r.fyi.futureEvent)}, gift cards {money(r.fyi.giftCards)}, misc sales{" "}
                      {money(r.fyi.miscSales)}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        <h2>Quarterly summary ({year})</h2>
        <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Bucket", "Dances", "Avg dancers", "Avg gross", "Avg Dance Net", "Avg ticket"].map(
                (h) => (
                  <th
                    key={h}
                    style={{
                      borderBottom: "1px solid #999",
                      padding: "4px 10px",
                      textAlign: "right",
                    }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {quarters.map((q) => (
              <tr key={q.quarter}>
                <td style={{ padding: "4px 10px" }}>Q{q.quarter}</td>
                <td style={{ textAlign: "right", padding: "4px 10px" }}>{q.count}</td>
                <td style={{ textAlign: "right", padding: "4px 10px" }}>{q.avgDancers}</td>
                <td style={{ textAlign: "right", padding: "4px 10px" }}>{money(q.avgGross)}</td>
                <td style={{ textAlign: "right", padding: "4px 10px" }}>{money(q.avgDanceNet)}</td>
                <td style={{ textAlign: "right", padding: "4px 10px" }}>{money(q.avgTicket)}</td>
              </tr>
            ))}
            {(
              [
                ["YTD", ytd],
                ["Last year", lastYear],
              ] as const
            ).map(([label, b]) => (
              <tr key={label} style={{ fontWeight: 600, borderTop: "1px solid #ccc" }}>
                <td style={{ padding: "4px 10px" }}>{label}</td>
                <td style={{ textAlign: "right", padding: "4px 10px" }}>{b.count}</td>
                <td style={{ textAlign: "right", padding: "4px 10px" }}>{b.avgDancers}</td>
                <td style={{ textAlign: "right", padding: "4px 10px" }}>{money(b.avgGross)}</td>
                <td style={{ textAlign: "right", padding: "4px 10px" }}>{money(b.avgDanceNet)}</td>
                <td style={{ textAlign: "right", padding: "4px 10px" }}>{money(b.avgTicket)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Rolling trends</h2>
        {report.trend === null ? (
          <p style={{ color: "#777" }}>
            Trend charts appear once the series spans at least 12 weeks of dances.
          </p>
        ) : (
          <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13, marginBottom: 4 }}>
                Dance Net ({report.trend.weeks} weeks, 4-event avg)
              </div>
              <Sparkline bars={report.trend.danceNet} line={report.trend.danceNetTrend} />
            </div>
            <div>
              <div style={{ fontSize: 13, marginBottom: 4 }}>
                Attendance ({report.trend.weeks} weeks, 4-event avg)
              </div>
              <Sparkline bars={report.trend.attendance} line={report.trend.attendanceTrend} />
            </div>
          </div>
        )}
      </article>

      <PrintBar />
    </main>
  );
}
