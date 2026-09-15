"use client";
import { apiFetch } from "@/app/apiFetch";

import { useEffect, useRef, useState } from "react";
import { localToday } from "@/app/localToday";

// Feature 028 (P5-R1): the shared event selector for every single-event surface (check-in, gate, payments,
// treasurer). Owns the event/series fetch, the series + date-range filters, and the default; reports the
// chosen event via onSelect (presentation-only — each page does its own follow-on work). In-page state; the
// event is never encoded in a URL (no deep links — clarification).
export type EventRow = {
  id: string;
  eventDate: string;
  seriesId: string;
  startTime: string | null;
  label: string | null;
};
type SeriesRow = { id: string; key: string; name: string };

/** The DB `time` column round-trips as HH:MM:SS; show HH:MM (feature 020 normalization). */
function toHHMM(t: string | null): string {
  if (!t) return "";
  const m = /^(\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}:${m[2]}` : t;
}

function eventLabel(e: EventRow): string {
  return [e.eventDate, toHHMM(e.startTime), e.label].filter(Boolean).join(" · ");
}

export function EventSelector({
  value,
  onSelect,
}: {
  value: string;
  onSelect: (event: EventRow) => void;
}) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [series, setSeries] = useState<SeriesRow[]>([]);
  // Filters (narrow the list only — they never commit a selection).
  const [seriesId, setSeriesId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const didDefault = useRef(false);

  useEffect(() => {
    void apiFetch("/api/events")
      .then((r) => r.json())
      .then((d) => setEvents(d.items ?? []));
    void apiFetch("/api/series")
      .then((r) => r.json())
      .then((d) => setSeries(d.items ?? []));
  }, []);

  // The list already arrives newest-first (feature 025). Filter client-side by series + date range.
  const filtered = events.filter(
    (e) =>
      (!seriesId || e.seriesId === seriesId) &&
      (!from || e.eventDate >= from) &&
      (!to || e.eventDate <= to),
  );

  // Default ONCE on open (FR-001): the most recent event with date ≤ today within the current filter, else the
  // soonest upcoming. The ref guard means adjusting a filter never re-defaults (and never re-fires onSelect).
  useEffect(() => {
    if (didDefault.current || value || !filtered.length) return;
    const today = localToday(); // feature 079: the device's date, not UTC's
    const def = filtered.find((e) => e.eventDate <= today) ?? filtered[filtered.length - 1];
    if (def) {
      didDefault.current = true;
      onSelect(def);
    }
  }, [filtered, value, onSelect]);

  function pick(id: string) {
    const e = events.find((x) => x.id === id);
    if (e) onSelect(e);
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <label>
        Event:{" "}
        <select aria-label="Event" value={value} onChange={(e) => pick(e.target.value)}>
          <option value="">— select —</option>
          {filtered.map((e) => (
            <option key={e.id} value={e.id}>
              {eventLabel(e)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <small>Series</small>{" "}
        <select
          aria-label="Filter series"
          value={seriesId}
          onChange={(e) => setSeriesId(e.target.value)}
        >
          <option value="">any series</option>
          {series.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <small>From</small>{" "}
        <input
          aria-label="From date"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label>
        <small>To</small>{" "}
        <input
          aria-label="To date"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
      {events.length > 0 && filtered.length === 0 && (
        <span style={{ color: "#888" }}>No events match.</span>
      )}
      {events.length === 0 && <span style={{ color: "#888" }}>No events.</span>}
    </div>
  );
}
