"use client";
import { apiFetch } from "@/app/apiFetch";
import VenueForm, { type Venue } from "./VenueForm";

import { useCallback, useEffect, useState } from "react";

type EventRow = { id: string; eventDate: string; venueId: string | null };

/**
 * Venues (feature 084 US1).
 *
 * One form creates and edits a venue — the page this replaced collected a name, an address and a short
 * name on creation and then offered a scatter of single-field controls, so a venue could never simply be
 * corrected. The list opens the form; the form owns every field the record holds (FR-001, FR-002).
 */
export default function VenuesPage() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [editing, setEditing] = useState<{ venue?: Venue } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [eventId, setEventId] = useState("");
  const [venueId, setVenueId] = useState("");

  const load = useCallback(async () => {
    const [v, e] = await Promise.all([
      apiFetch(`/api/venues${showArchived ? "?archived=1" : ""}`).then((r) => r.json()),
      apiFetch("/api/events").then((r) => r.json()),
    ]);
    setVenues(v.items ?? []);
    setEvents(e.items ?? []);
  }, [showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  async function assign() {
    if (!eventId) return;
    setMessage(null);
    const res = await apiFetch(`/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ venueId: venueId || null }),
    });
    if (!res.ok) {
      setMessage((await res.json().catch(() => null))?.error?.message ?? "Failed to assign venue");
      return;
    }
    setMessage("Venue assigned.");
    void load();
  }

  return (
    <main style={{ padding: 24, maxWidth: 640 }}>
      <h1>Venues</h1>

      <button type="button" onClick={() => setEditing({})}>
        Add a venue
      </button>

      {/* FR-012: how a hall retired by mistake is found again. */}
      <label>
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Include archived
      </label>

      <ul>
        {venues.map((v) => (
          <li key={v.id} style={{ marginBottom: 10 }}>
            <strong>{v.shortName ?? "—"}</strong> · {v.name} — {v.address}
            {v.landlordContactId ? " · landlord set" : ""}
            {v.isPublic ? " · public" : ""}
            {v.archivedAt ? " · archived" : ""}{" "}
            <button type="button" onClick={() => setEditing({ venue: v })}>
              Edit
            </button>
          </li>
        ))}
        {venues.length === 0 && <li style={{ color: "#888" }}>No venues</li>}
      </ul>

      {editing && (
        <section aria-label={editing.venue ? `Edit ${editing.venue.name}` : "Add a venue"}>
          <h2>{editing.venue ? editing.venue.name : "Add a venue"}</h2>
          <VenueForm
            venue={editing.venue}
            onSaved={() => {
              setEditing(null);
              setMessage(editing.venue ? "Venue saved." : "Venue created.");
              void load();
            }}
            onClose={() => setEditing(null)}
          />
        </section>
      )}

      <h2 style={{ marginTop: 24 }}>Assign a venue to an event</h2>
      <div style={{ display: "grid", gap: 6, maxWidth: 420 }}>
        <select aria-label="Event" value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">— event —</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.eventDate}
            </option>
          ))}
        </select>
        <select aria-label="Venue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
          <option value="">— (no venue) —</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <button onClick={assign} disabled={!eventId}>
          Assign
        </button>
      </div>
      {message && <p>{message}</p>}
    </main>
  );
}
