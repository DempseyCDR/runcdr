"use client";
import { apiFetch } from "@/app/apiFetch";

import { useCallback, useEffect, useState } from "react";

type Series = { id: string; key: string; name: string };
type Resolved = { seriesKey: string; amount: number; effectiveDate: string } | null;

/**
 * Feature 019 US5 (FR-021): the per-series cash box seed — the cash in the till before the doors open.
 * Effective-dated and audited like rates/expenses; a new door record opens at the value in effect on the
 * event date (the FS can still override it per night). Unconfigured series fall back to the $15 default.
 */
export default function DoorParametersPage() {
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [seriesKey, setSeriesKey] = useState("");
  const [amount, setAmount] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [resolved, setResolved] = useState<Resolved>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch("/api/series")
      .then((r) => r.json())
      .then((d: { items: Series[] }) => {
        setSeriesList(d.items);
        if (d.items[0]) setSeriesKey(d.items[0].key);
      });
  }, []);

  const loadResolved = useCallback(async () => {
    if (!seriesKey) return;
    const r = await apiFetch(`/api/door-parameters?seriesKey=${seriesKey}&on=${effectiveDate}`);
    const d = await r.json();
    setResolved(d.resolved);
  }, [seriesKey, effectiveDate]);

  useEffect(() => {
    void loadResolved();
  }, [loadResolved]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await apiFetch("/api/door-parameters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seriesKey, amount: Number(amount), effectiveDate }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setMessage(b?.error?.message ?? "Failed");
      return;
    }
    setAmount("");
    setMessage("Cash box seed saved");
    void loadResolved();
  }

  return (
    <main style={{ padding: 24, maxWidth: 480 }}>
      <h1>Door cash box seed</h1>
      <p style={{ color: "#666" }}>
        Effective-dated, per series; a new door record opens at the value in effect on the event
        date. The FS may still override it per night. Unset series use the $15 default.
      </p>
      <form onSubmit={save} style={{ display: "grid", gap: 6 }}>
        <label>
          Series
          <br />
          <select value={seriesKey} onChange={(e) => setSeriesKey(e.target.value)}>
            {seriesList.map((s) => (
              <option key={s.id} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <input
          placeholder="Cash box seed (dollars)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          type="date"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
        />
        <button type="submit">Save the cash box seed</button>
        {message && <p>{message}</p>}
      </form>

      <h2>Currently in effect (on {effectiveDate})</h2>
      {resolved ? (
        <p>
          Cash box seed: <strong>${resolved.amount.toFixed(2)}</strong>
        </p>
      ) : (
        <p style={{ color: "#777" }}>
          No cash box seed configured for this series/date — $15 default applies.
        </p>
      )}
    </main>
  );
}
