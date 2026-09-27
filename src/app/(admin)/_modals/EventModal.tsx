"use client";
import { apiFetch } from "@/app/apiFetch";
import Dialog from "@/app/_components/Dialog";

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
  /** Feature 087 (FR-014): the Booker's private note. Shown only when the host asks (`withNote`). */
  note?: string | null;
  /** Feature 087: whether the dance is cancelled — read only where the host offers `withStatus`. */
  status?: "scheduled" | "cancelled";
};
type Venue = { id: string; name: string; shortName: string | null };

type Props = {
  mode: "create" | "edit" | "readonly";
  event: EventLite;
  venues: Venue[];
  onClose: () => void;
  onSaved?: () => void;
  /**
   * Feature 087 (FR-014, FR-016): show and save the Booker's private note. Opt-in, because the events
   * page shares this editor and the Webmaster edits the public blurb there — the note is the Booker's, and
   * must not be on a page the Webmaster uses. Booking Central passes it; the events page does not.
   */
  withNote?: boolean;
  /**
   * Feature 087 (walk-through): offer cancelling, reviving and deleting the DANCE. Opt-in, because the
   * events page has its own controls for these; Booking Central passes it. Each asks before it acts.
   */
  withStatus?: boolean;
};

/** The act waiting on the Booker's "yes" — or, after a refused delete, on a second one. */
type Confirming = "cancel" | "delete" | { discard: string } | null;

function centsToStr(c: number): string {
  return String(c / 100);
}

// The DB `time` column renders "HH:MM:SS"; the event PATCH validation accepts only "HH:MM". Normalise
// whatever we load (event or prior-event default) so an unchanged start time saves cleanly.
function toHHMM(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : "";
}

export function EventModal({
  mode,
  event,
  venues,
  onClose,
  onSaved,
  withNote = false,
  withStatus = false,
}: Props) {
  const readOnly = mode === "readonly";
  const [eventDate, setEventDate] = useState(event.eventDate);
  const [startTime, setStartTime] = useState(toHHMM(event.startTime));
  const [venueId, setVenueId] = useState(event.venueId ?? "");
  const [label, setLabel] = useState(event.label ?? "");
  const [description, setDescription] = useState(event.description ?? "");
  const [note, setNote] = useState(event.note ?? "");
  const [rent, setRent] = useState(""); // dollars; initialised from the resolved default
  const [resolvedDefault, setResolvedDefault] = useState<number | null>(null); // cents
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);

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
      ...(withNote ? { note: note || null } : {}),
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
      ...(withNote ? { note: event.note || null } : {}),
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

  /** Cancel or revive the dance — a status change only; its bookings are untouched (feature 018). */
  async function setStatus(status: "scheduled" | "cancelled") {
    setError(null);
    const res = await apiFetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setConfirming(null);
    if (!res.ok) return setError("The dance could not be changed.");
    onSaved?.();
    onClose();
  }

  /**
   * Delete a dance made by mistake. The server refuses one with history (bookings, money) and names it —
   * that dance is CANCELLED instead — and asks before discarding check-ins (feature 019 FR-018a), exactly
   * as the events page does.
   */
  async function remove(discardAttendance = false) {
    setError(null);
    const q = discardAttendance ? "?confirmDiscardAttendance=true" : "";
    const res = await apiFetch(`/api/events/${event.id}${q}`, { method: "DELETE" });
    setConfirming(null);
    if (res.ok) {
      onSaved?.();
      onClose();
      return;
    }
    const err = (await res.json().catch(() => null))?.error;
    if (err?.code === "EVENT_HAS_ATTENDANCE")
      return setConfirming({ discard: String(err.detail ?? "some") });
    if (err?.code === "EVENT_HAS_HISTORY") {
      return setError(
        `This dance has ${err.detail ?? "history"}, so it cannot be deleted. Cancel it instead.`,
      );
    }
    setError(err?.message ?? "The dance could not be deleted.");
  }

  const cancelled = event.status === "cancelled";
  // Cancel, revive and delete the DANCE — only where the host offers them, and only when editing.
  const lifecycle = withStatus && mode === "edit";

  return (
    <Dialog
      label="Event"
      heading={mode === "create" ? "New event" : `Event — ${eventDate}`}
      onClose={onClose}
    >
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
          {/* The public blurb — the longer text of the two, so at least the note's size (087). */}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={readOnly}
            rows={4}
          />
        </label>
        {withNote && (
          // Feature 087 (FR-014): private to the club's volunteers — never shown on the public site.
          <label>
            Note{" "}
            <textarea
              aria-label="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={readOnly}
              rows={3}
            />
          </label>
        )}
      </div>

      {/* A question about the DANCE, asked above the buttons before anything happens to it. */}
      {lifecycle && confirming === "cancel" && (
        <div role="group" aria-label="Cancel the dance" style={{ marginTop: 12 }}>
          <p>
            Cancel the dance on {event.eventDate}? It stays on the table, marked Cancelled, and its
            bookings are kept. It can be revived.
          </p>
          <button type="button" onClick={() => void setStatus("cancelled")}>
            Yes, cancel the dance
          </button>{" "}
          <button type="button" onClick={() => setConfirming(null)}>
            Keep it
          </button>
        </div>
      )}
      {lifecycle && confirming === "delete" && (
        <div role="group" aria-label="Delete the dance" style={{ marginTop: 12 }}>
          <p>
            Delete the dance on {event.eventDate}? Only for a dance made by mistake — one that has
            bookings or money is cancelled instead.
          </p>
          <button type="button" onClick={() => void remove()}>
            Yes, delete it
          </button>{" "}
          <button type="button" onClick={() => setConfirming(null)}>
            Keep it
          </button>
        </div>
      )}
      {lifecycle && confirming && typeof confirming === "object" && (
        <div role="group" aria-label="Discard check-ins" style={{ marginTop: 12 }}>
          <p>This dance has {confirming.discard} check-in(s). Deleting it discards them.</p>
          <button type="button" onClick={() => void remove(true)}>
            Delete and discard {confirming.discard} check-ins
          </button>{" "}
          <button type="button" onClick={() => setConfirming(null)}>
            Keep it
          </button>
        </div>
      )}

      {/* One row at the foot, in this order, wrapping on a phone (087 walk-through). "Close", not
          "Cancel": on this form, cancel means the DANCE. */}
      <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {lifecycle &&
          (cancelled ? (
            <button type="button" onClick={() => void setStatus("scheduled")}>
              Revive this dance
            </button>
          ) : (
            <button type="button" onClick={() => setConfirming("cancel")}>
              Cancel this dance…
            </button>
          ))}
        {lifecycle && (
          <button type="button" onClick={() => setConfirming("delete")}>
            Delete this dance…
          </button>
        )}
        {!readOnly && (
          <button type="button" onClick={() => void save()}>
            Save
          </button>
        )}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
