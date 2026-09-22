"use client";
import { apiFetch } from "@/app/apiFetch";

import { useCallback, useEffect, useState } from "react";
import { formatWallClock } from "@/server/domain/public/wallClock";
import { EventModal } from "@/app/(admin)/_modals/EventModal";

type Series = { id: string; key: string; name: string };
type VenueLite = { id: string; name: string; shortName: string | null };
type Group = { id: string; name: string; kind: string | null };
type EventRow = {
  id: string;
  seriesId: string;
  groupId: string | null;
  eventDate: string;
  chargesAdmission: boolean;
  rentCents: number | null;
  label: string | null;
  startTime: string | null;
  description: string | null;
  status: string;
  advertisedPriceCents: number | null;
};

export default function EventsPage() {
  const [series, setSeries] = useState<Series[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [seriesKey, setSeriesKey] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [chargesAdmission, setChargesAdmission] = useState(true);
  const [label, setLabel] = useState("");
  const [startTime, setStartTime] = useState("");
  const [description, setDescription] = useState("");
  const [groupId, setGroupId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupKind, setGroupKind] = useState("");
  const [rentEventId, setRentEventId] = useState("");
  const [rentAmount, setRentAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Feature 018: manage an existing event (reschedule / cancel / delete / advertised price).
  const [manageId, setManageId] = useState("");
  const [managePrice, setManagePrice] = useState("");
  // Feature 084 (FR-001): the event form — label, description, start time, venue and rent were collected
  // on creation and then unreachable, because nothing on this page opened the modal that edits them.
  const [venues, setVenues] = useState<VenueLite[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Feature 018 (B26): recurring generation.
  const [recSeriesKey, setRecSeriesKey] = useState("");
  const [recFirst, setRecFirst] = useState("");
  const [recLast, setRecLast] = useState("");
  const [recEveryN, setRecEveryN] = useState("1");
  const [recStart, setRecStart] = useState("");
  const [recMessage, setRecMessage] = useState<string | null>(null);

  async function patchEvent(id: string, body: Record<string, unknown>) {
    setError(null);
    const res = await apiFetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error?.message ?? "Failed");
      return;
    }
    void loadEvents();
  }

  async function deleteEvent(id: string, confirmDiscardAttendance = false) {
    setError(null);
    const q = confirmDiscardAttendance ? "?confirmDiscardAttendance=true" : "";
    const res = await apiFetch(`/api/events/${id}${q}`, { method: "DELETE" });
    if (res.ok) {
      if (manageId === id) setManageId("");
      void loadEvents();
      return;
    }
    const body = await res.json().catch(() => null);
    const err = body?.error;
    // Feature 019 US4: attendance no longer blocks — confirm the count, then retry discarding it (FR-018a).
    if (err?.code === "EVENT_HAS_ATTENDANCE") {
      const count = err.detail ?? "some";
      if (
        window.confirm(
          `This event has ${count} checked-in attendee(s). Delete anyway and discard them?`,
        )
      ) {
        void deleteEvent(id, true);
      }
      return;
    }
    // FR-019: name the blocker so the organizer knows what to clear.
    if (err?.code === "EVENT_HAS_HISTORY") {
      setError(`Cannot delete: this event has ${err.detail ?? "history"}. Cancel it instead.`);
      return;
    }
    setError(err?.message ?? "Could not delete this event.");
  }

  async function generateRecurring() {
    setRecMessage(null);
    const res = await apiFetch("/api/events/recurring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seriesKey: recSeriesKey,
        firstDate: recFirst,
        lastDate: recLast,
        everyNWeeks: Number(recEveryN) || 1,
        ...(recStart ? { startTime: recStart } : {}),
      }),
    });
    if (!res.ok) {
      setRecMessage((await res.json().catch(() => null))?.error?.message ?? "Failed to generate");
      return;
    }
    const { events: created } = await res.json();
    setRecMessage(`Generated ${created.length} event(s).`);
    void loadEvents();
  }

  async function setEventRent(clear: boolean) {
    if (!rentEventId) return;
    const rentCents = clear ? null : Math.round(Number(rentAmount) * 100);
    const res = await apiFetch(`/api/events/${rentEventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rentCents }),
    });
    if (res.ok) {
      setRentAmount("");
      void loadEvents();
    } else {
      setError((await res.json().catch(() => null))?.error?.message ?? "Failed to set rent");
    }
  }

  const loadEvents = useCallback(async () => {
    const res = await apiFetch("/api/events");
    setEvents((await res.json()).items ?? []);
  }, []);
  const loadGroups = useCallback(async () => {
    const res = await apiFetch("/api/event-groups");
    setGroups((await res.json()).items ?? []);
  }, []);

  useEffect(() => {
    void apiFetch("/api/series")
      .then((r) => r.json())
      .then((d) => {
        setSeries(d.items ?? []);
        if (d.items?.[0]) {
          setSeriesKey(d.items[0].key);
          setRecSeriesKey(d.items[0].key);
        }
      });
    void loadGroups();
    void loadEvents();
    // The event form offers a venue picker (feature 084).
    void apiFetch("/api/venues")
      .then((r) => r.json())
      .then((d) => setVenues(d.items ?? []));
  }, [loadEvents, loadGroups]);

  const seriesKeyById = (id: string) => series.find((s) => s.id === id)?.key ?? id;

  async function createEvent(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await apiFetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seriesKey,
        eventDate,
        chargesAdmission,
        ...(groupId ? { groupId } : {}),
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(startTime ? { startTime } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error?.message ?? "Failed to create event");
      return;
    }
    setEventDate("");
    setLabel("");
    setStartTime("");
    setDescription("");
    void loadEvents();
  }

  async function createGroup() {
    if (!groupName.trim()) return;
    const res = await apiFetch("/api/event-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: groupName,
        ...(groupKind.trim() ? { kind: groupKind.trim() } : {}),
      }),
    });
    if (res.ok) {
      const g = await res.json();
      setGroupName("");
      await loadGroups();
      setGroupId(g.id);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 760 }}>
      <h1>Events</h1>

      <ul>
        {events.map((ev) => (
          <li key={ev.id}>
            {ev.eventDate}
            {ev.startTime ? ` ${formatWallClock(ev.startTime)}` : ""} — {seriesKeyById(ev.seriesId)}
            {ev.label ? ` · ${ev.label}` : ""}
            {ev.chargesAdmission ? "" : " (free)"}
            {ev.groupId
              ? ` · group ${groups.find((g) => g.id === ev.groupId)?.name ?? ev.groupId}`
              : ""}
            {ev.rentCents != null ? ` · rent $${(ev.rentCents / 100).toFixed(2)}` : ""}
            {ev.advertisedPriceCents != null
              ? ` · $${(ev.advertisedPriceCents / 100).toFixed(2)} advertised`
              : ""}
            {ev.status === "cancelled" ? " · CANCELLED" : ""}
          </li>
        ))}
        {events.length === 0 && <li style={{ color: "#888" }}>No events</li>}
      </ul>

      <h2>Manage event</h2>
      <div style={{ display: "grid", gap: 6, maxWidth: 480 }}>
        <select
          value={manageId}
          onChange={(e) => {
            setManageId(e.target.value);
            const ev = events.find((x) => x.id === e.target.value);
            setManagePrice(
              ev?.advertisedPriceCents != null ? (ev.advertisedPriceCents / 100).toFixed(2) : "",
            );
          }}
        >
          <option value="">— select an event —</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.eventDate} — {seriesKeyById(ev.seriesId)}
              {ev.status === "cancelled" ? " (cancelled)" : ""}
            </option>
          ))}
        </select>
        {manageId && (
          <>
            <button type="button" onClick={() => setEditingId(manageId)}>
              Edit event
            </button>
            <label>
              Advertised price ($, public){" "}
              <input
                type="number"
                step="0.01"
                value={managePrice}
                onChange={(e) => setManagePrice(e.target.value)}
                style={{ width: 90 }}
              />{" "}
              <button
                onClick={() =>
                  patchEvent(manageId, {
                    advertisedPriceCents: managePrice
                      ? Math.round(Number(managePrice) * 100)
                      : null,
                  })
                }
              >
                Save price
              </button>
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              {events.find((x) => x.id === manageId)?.status === "cancelled" ? (
                <button onClick={() => patchEvent(manageId, { status: "scheduled" })}>
                  Revive
                </button>
              ) : (
                <button onClick={() => patchEvent(manageId, { status: "cancelled" })}>
                  Cancel
                </button>
              )}
              <button onClick={() => deleteEvent(manageId)}>Delete</button>
            </div>
          </>
        )}
      </div>

      <h2>Generate recurring events</h2>
      <div style={{ display: "grid", gap: 6, maxWidth: 480 }}>
        <select value={recSeriesKey} onChange={(e) => setRecSeriesKey(e.target.value)}>
          {series.map((s) => (
            <option key={s.id} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
        <label>
          First date{" "}
          <input type="date" value={recFirst} onChange={(e) => setRecFirst(e.target.value)} />
        </label>
        <label>
          Last date{" "}
          <input type="date" value={recLast} onChange={(e) => setRecLast(e.target.value)} />
        </label>
        <label>
          Every{" "}
          <input
            type="number"
            min={1}
            value={recEveryN}
            onChange={(e) => setRecEveryN(e.target.value)}
            style={{ width: 56 }}
          />{" "}
          week(s)
        </label>
        <label>
          Start time (optional){" "}
          <input type="time" value={recStart} onChange={(e) => setRecStart(e.target.value)} />
        </label>
        <button onClick={generateRecurring} disabled={!recSeriesKey || !recFirst || !recLast}>
          Generate
        </button>
        {recMessage && <p style={{ color: "#333" }}>{recMessage}</p>}
      </div>

      <h2>Create event</h2>
      <form onSubmit={createEvent} style={{ display: "grid", gap: 6, maxWidth: 420 }}>
        <select value={seriesKey} onChange={(e) => setSeriesKey(e.target.value)}>
          {series.map((s) => (
            <option key={s.id} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
        <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        <input
          placeholder="Label (optional, e.g. Afternoon)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <label>
          Start time (optional)
          <br />
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <textarea
          placeholder="Description (optional, shown on the public site)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
        <label>
          <input
            type="checkbox"
            checked={chargesAdmission}
            onChange={(e) => setChargesAdmission(e.target.checked)}
          />{" "}
          Charges admission
        </label>
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">— no group —</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!seriesKey || !eventDate}>
          Create event
        </button>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </form>

      <h2>New event group</h2>
      <div style={{ display: "grid", gap: 6, maxWidth: 420 }}>
        <input
          placeholder="Group name"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
        />
        <input
          placeholder="Category (optional)"
          value={groupKind}
          onChange={(e) => setGroupKind(e.target.value)}
        />
        <button onClick={createGroup}>Create group</button>
      </div>

      <h2>Per-event rent override</h2>
      <p style={{ color: "#666", maxWidth: 520 }}>
        Overrides an event&apos;s resolved rent (or sets rent directly when the event has no venue).
        Clear to fall back to the venue/series rent. Manage standard rates under Venue rents.
      </p>
      <div style={{ display: "grid", gap: 6, maxWidth: 420 }}>
        <select value={rentEventId} onChange={(e) => setRentEventId(e.target.value)}>
          <option value="">— select an event —</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.eventDate} — {seriesKeyById(ev.seriesId)}
            </option>
          ))}
        </select>
        <input
          type="number"
          step="0.01"
          placeholder="Rent ($)"
          value={rentAmount}
          onChange={(e) => setRentAmount(e.target.value)}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setEventRent(false)} disabled={!rentEventId || !rentAmount}>
            Set rent
          </button>
          <button onClick={() => setEventRent(true)} disabled={!rentEventId}>
            Clear override
          </button>
        </div>
      </div>
      {editingId &&
        (() => {
          const ev = events.find((x) => x.id === editingId);
          if (!ev) return null;
          return (
            <EventModal
              mode="edit"
              event={{
                id: ev.id,
                seriesKey: seriesKeyById(ev.seriesId),
                eventDate: ev.eventDate,
                startTime: ev.startTime,
                venueId: null,
                rentCents: ev.rentCents,
                label: ev.label,
                description: ev.description,
              }}
              venues={venues}
              onClose={() => setEditingId(null)}
              onSaved={() => {
                setEditingId(null);
                void loadEvents();
              }}
            />
          );
        })()}
    </main>
  );
}
