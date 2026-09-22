"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/app/apiFetch";

type Rent = {
  id: string;
  venueId: string;
  seriesId: string | null;
  amountCents: number;
  effectiveDate: string;
};
type Series = { id: string; key: string; name: string };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Feature 084 US5 (FR-015, FR-029, FR-030): a venue's rents, managed where the venue is.
 *
 * They used to live on a page of their own, which is why nobody looked there. A rent is what a hall costs
 * for one series from one date, and it is CHANGED by adding a newer dated row rather than by rewriting an
 * old figure — otherwise a report of an evening already banked would quietly move (clarification Q2).
 * A row nothing has used yet can simply go.
 */
export default function VenueRents({ venueId }: { venueId: string }) {
  const [rents, setRents] = useState<Rent[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [amount, setAmount] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [seriesKey, setSeriesKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/venue-rents?venueId=${venueId}`);
    setRents((await res.json()).items ?? []);
  }, [venueId]);

  useEffect(() => {
    void load();
    void apiFetch("/api/series")
      .then((r) => r.json())
      .then((d) => setSeries(d.items ?? []));
  }, [load]);

  const seriesName = (id: string | null) =>
    id ? (series.find((s) => s.id === id)?.name ?? "one series") : "every series";

  async function add() {
    setError(null);
    if (!(Number(amount) > 0)) return setError("How much is the rent?");
    if (!effectiveDate) return setError("From what date does it apply?");
    setBusy(true);
    const res = await apiFetch("/api/venue-rents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venueId,
        amount: Number(amount),
        effectiveDate,
        ...(seriesKey ? { seriesKey } : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setError(data?.error?.message ?? "Could not add that rent.");
    }
    setAmount("");
    setEffectiveDate("");
    void load();
  }

  async function remove(rent: Rent) {
    setError(null);
    setBusy(true);
    const res = await apiFetch(`/api/venue-rents/${rent.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setError(data?.error?.message ?? "Could not remove that rent.");
    }
    void load();
  }

  return (
    <section aria-label="Rents">
      <h3>Rents</h3>
      {rents.length === 0 ? (
        <p>None set.</p>
      ) : (
        <ul>
          {rents.map((r) => (
            <li key={r.id}>
              {money(r.amountCents)} · {seriesName(r.seriesId)} · from {r.effectiveDate}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(r)}
                aria-label={`Remove the rent from ${r.effectiveDate}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* FR-029: a change is a NEW rent from a date; the rows above are never rewritten. */}
      <label>
        Amount
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label>
        From
        <input
          type="date"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
        />
      </label>
      <label>
        Series
        <select value={seriesKey} onChange={(e) => setSeriesKey(e.target.value)}>
          <option value="">Every series</option>
          {series.map((s) => (
            <option key={s.id} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={busy} onClick={() => void add()}>
        Add this rent
      </button>

      {error && <p role="alert">{error}</p>}
    </section>
  );
}
