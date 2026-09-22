"use client";
import { apiFetch } from "@/app/apiFetch";

import { useCallback, useEffect, useRef, useState } from "react";

// Feature 020 US4 (FR-017..FR-020): the event modal — create / edit / read-only over the existing event
// API. Rent shows the resolved default (never blank) and re-defaults when the venue changes; Option A on
// save — if rent equals the shown default, store no override (null), else store the typed value.

type EventLite = {
  id: string;
  seriesKey: string;
  eventDate: string;
  startTime: string | null;
  venueId: string | null;
  rentCents: number | null;
  label: string | null;
  description: string | null;
};
type Venue = { id: string; name: string; shortName: string | null };

type Props = {
  mode: "create" | "edit" | "readonly";
  event: EventLite;
  venues: Venue[];
  onClose: () => void;
  onSaved?: () => void;
};

function centsToStr(c: number): string {
  return String(c / 100);
}

// The DB `time` column renders "HH:MM:SS"; the event PATCH validation accepts only "HH:MM". Normalise
// whatever we load (event or prior-event default) so an unchanged start time saves cleanly.
function toHHMM(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : "";
}

export function EventModal({ mode, event, venues, onClose, onSaved }: Props) {
  const readOnly = mode === "readonly";
  const [eventDate, setEventDate] = useState(event.eventDate);
  const [startTime, setStartTime] = useState(toHHMM(event.startTime));
  const [venueId, setVenueId] = useState(event.venueId ?? "");
  const [label, setLabel] = useState(event.label ?? "");
  const [description, setDescription] = useState(event.description ?? "");
  const [rent, setRent] = useState(""); // dollars; initialised from the resolved default
  const [resolvedDefault, setResolvedDefault] = useState<number | null>(null); // cents
  const [error, setError] = useState<string | null>(null);

  // Pre-fill a NEW event's venue + start time from the series' prior event (FR-018).
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (mode !== "create" || prefilledRef.current) return;
    prefilledRef.current = true;
    void apiFetch(
      `/api/events/prior-defaults?seriesKey=${event.seriesKey}&before=${event.eventDate}`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.venueId) setVenueId(d.venueId);
        if (d.startTime) setStartTime(toHHMM(d.startTime));
      })
      .catch(() => {});
  }, [mode, event.seriesKey, event.eventDate]);

  // Resolve the rent default for the current venue/date; re-runs when the venue changes (FR-019).
  const loadRentDefault = useCallback(async () => {
    const res = await apiFetch(
      `/api/events/rent-preview?seriesKey=${event.seriesKey}&venueId=${venueId}&date=${eventDate}`,
    );
    const d = await res.json();
    setResolvedDefault(d.rentCents ?? 0);
    // If the event has an explicit per-event override, show it; else show the resolved default.
    setRent(event.rentCents != null ? centsToStr(event.rentCents) : centsToStr(d.rentCents ?? 0));
  }, [event.seriesKey, event.rentCents, venueId, eventDate]);

  useEffect(() => {
    void loadRentDefault();
  }, [loadRentDefault]);

  async function save() {
    setError(null);
    const enteredCents = Math.round((Number(rent) || 0) * 100);
    // Option A: equal to the resolved default → store no override (null, dynamic); else store the value.
    const rentCents = enteredCents === (resolvedDefault ?? 0) ? null : enteredCents;

    const body = {
      eventDate,
      startTime: startTime || null,
      venueId: venueId || null,
      rentCents,
      label: label || null,
      description: description || null,
    };
    // Feature 084 (FR-028): an edit carries only what changed, so two people editing different fields of
    // one event do not overwrite each other — and an unchanged start time is never re-sent (which is what
    // used to 422 on "HH:MM:SS"). Creating sends the lot.
    const before = {
      eventDate: event.eventDate,
      startTime: toHHMM(event.startTime) || null,
      venueId: event.venueId ?? null,
      rentCents: event.rentCents,
      label: event.label || null,
      description: event.description || null,
    };
    const changed = Object.fromEntries(
      Object.entries(body).filter(([k, v]) => v !== before[k as keyof typeof before]),
    );
    if (mode !== "create" && Object.keys(changed).length === 0) {
      onSaved?.();
      onClose();
      return;
    }
    const url = mode === "create" ? "/api/events" : `/api/events/${event.id}`;
    const res = await apiFetch(url, {
      method: mode === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode === "create" ? { ...body, seriesKey: event.seriesKey } : changed),
    });
    if (res.status === 403) return setError("Only the Booker may edit events.");
    if (!res.ok) return setError("Could not save event");
    onSaved?.();
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-label="Event"
      style={{ border: "1px solid #ccc", padding: 16, maxWidth: 460 }}
    >
      <h2>{mode === "create" ? "New event" : `Event — ${eventDate}`}</h2>
      {error && <p role="alert">{error}</p>}
      <div style={{ display: "grid", gap: 6 }}>
        <label>
          Date{" "}
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            disabled={readOnly}
          />
        </label>
        <label>
          Start time{" "}
          <input
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            disabled={readOnly}
            placeholder="HH:MM"
          />
        </label>
        <label>
          Venue{" "}
          <select value={venueId} onChange={(e) => setVenueId(e.target.value)} disabled={readOnly}>
            <option value="">— none —</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.shortName ? `${v.shortName} · ${v.name}` : v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rent{" "}
          <input
            value={rent}
            onChange={(e) => setRent(e.target.value)}
            disabled={readOnly}
            inputMode="decimal"
          />
          {resolvedDefault != null && (
            <small style={{ color: "#777" }}> (default ${centsToStr(resolvedDefault)})</small>
          )}
        </label>
        <label>
          Label{" "}
          <input value={label} onChange={(e) => setLabel(e.target.value)} disabled={readOnly} />
        </label>
        <label>
          Description{" "}
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={readOnly}
          />
        </label>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        {readOnly ? (
          <button type="button" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button type="button" onClick={() => void save()}>
              Save
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
