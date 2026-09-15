"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import styles from "./checkin.module.css";

/** One check-in as the checked-in list shows it (contract §5). */
export type Attendee = {
  id: string;
  contactId: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  displayNameOverride: string | null;
  childrenCount: number;
  isOpenBand: boolean;
};

type Sibling = {
  id: string;
  eventDate: string;
  startTime: string | null;
  seriesKey: string;
  label: string | null;
};

/** The DB `time` column round-trips as HH:MM:SS; show HH:MM (feature 020 normalization). */
function toHHMM(t: string | null): string {
  if (!t) return "";
  const m = /^(\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}:${m[2]}` : t;
}

/**
 * Feature 025 US1: correct one check-in — children, open band, the comp and gift-card counts, a move to the
 * other event in the group, assigning an anonymous check-in to a contact, or removing it. Feature 079 moved it
 * out of the page, to open over the checked-in dialog; its behaviour is unchanged.
 */
export default function CorrectionModal({
  attendee,
  eventId,
  isCommunityDance,
  onClose,
  onDone,
}: {
  attendee: Attendee;
  eventId: string;
  isCommunityDance: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [children, setChildren] = useState(String(attendee.childrenCount));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [siblings, setSiblings] = useState<Sibling[]>([]);
  const [moveTo, setMoveTo] = useState("");
  const [reassignQ, setReassignQ] = useState("");
  const [reassignHits, setReassignHits] = useState<{ id: string; displayName: string }[]>([]);

  useEffect(() => {
    void apiFetch(`/api/events/${eventId}/group-siblings`)
      .then((r) => r.json())
      .then((d) => setSiblings(d.items ?? []));
  }, [eventId]);

  async function call(input: RequestInfo, init: RequestInit, close: boolean): Promise<void> {
    setError(null);
    const res = await apiFetch(input, init);
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setError(b?.error?.message ?? "Could not apply the correction");
      return;
    }
    if (close) onDone();
  }

  const patch = (body: unknown, close = true) =>
    call(
      `/api/attendance/${attendee.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      close,
    );

  async function reassignSearch(v: string) {
    setReassignQ(v);
    if (v.trim().length < 1) return setReassignHits([]);
    const res = await apiFetch(`/api/attendance/search?q=${encodeURIComponent(v)}`);
    setReassignHits((await res.json()).items ?? []);
  }

  async function doorCount(count: "comp" | "gift", delta: 1 | -1) {
    setError(null);
    setNote(null);
    const res = await apiFetch(`/api/events/${eventId}/door-count`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count, delta }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      return setError(b?.error?.message ?? "Could not adjust the count");
    }
    setNote(`${count === "comp" ? "Comp" : "Gift-card"} count ${delta > 0 ? "+1" : "−1"}.`);
  }

  const name = attendee.displayName ?? "unmatched";

  return (
    <div className={styles.backdrop}>
      <div role="dialog" aria-modal="true" aria-label="Correct attendance" className={styles.panel}>
        <h3>Correct: {name}</h3>
        {error && (
          <p role="alert" style={{ color: "#b00020" }}>
            {error}
          </p>
        )}
        {note && <p style={{ color: "#2e7d32" }}>{note}</p>}

        <div style={{ display: "grid", gap: 8 }}>
          <div>
            <label>
              Children{" "}
              <input
                aria-label="Edit children"
                type="number"
                min={0}
                value={children}
                onChange={(e) => setChildren(e.target.value)}
                style={{ width: 56 }}
              />
            </label>{" "}
            <button onClick={() => void patch({ childrenCount: Number(children) || 0 })}>
              Save children
            </button>
          </div>

          <label>
            <input
              aria-label="Open band"
              type="checkbox"
              checked={attendee.isOpenBand}
              disabled={!isCommunityDance && !attendee.isOpenBand}
              onChange={(e) => void patch({ isOpenBand: e.target.checked })}
            />{" "}
            Open-band musician
          </label>

          <div>
            Comp: <button onClick={() => void doorCount("comp", 1)}>Comp +1</button>{" "}
            <button onClick={() => void doorCount("comp", -1)}>Comp -1</button>
            {"  "}Gift: <button onClick={() => void doorCount("gift", 1)}>Gift +1</button>{" "}
            <button onClick={() => void doorCount("gift", -1)}>Gift -1</button>
          </div>

          {siblings.length > 0 && (
            <div>
              <label>
                Move to{" "}
                <select
                  aria-label="Move to"
                  value={moveTo}
                  onChange={(e) => setMoveTo(e.target.value)}
                >
                  <option value="">— sibling event —</option>
                  {siblings.map((s) => (
                    <option key={s.id} value={s.id}>
                      {[s.eventDate, toHHMM(s.startTime), s.seriesKey, s.label]
                        .filter(Boolean)
                        .join(" · ")}
                    </option>
                  ))}
                </select>
              </label>{" "}
              <button disabled={!moveTo} onClick={() => void patch({ eventId: moveTo })}>
                Move
              </button>
            </div>
          )}

          {attendee.contactId === null && (
            <div>
              <label>
                Reassign to{" "}
                <input
                  aria-label="Reassign to"
                  value={reassignQ}
                  onChange={(e) => void reassignSearch(e.target.value)}
                />
              </label>
              <ul style={{ listStyle: "none", padding: 0 }}>
                {reassignHits.map((h) => (
                  <li key={h.id}>
                    <button onClick={() => void patch({ contactId: h.id })}>
                      Assign {h.displayName}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              onClick={() =>
                void call(`/api/attendance/${attendee.id}`, { method: "DELETE" }, true)
              }
            >
              Delete attendance
            </button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
