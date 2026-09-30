"use client";
import { apiFetch } from "@/app/apiFetch";

import { useState } from "react";
import styles from "./hub.module.css";

/**
 * Feature 087 US4 — one dance's music, member by member.
 *
 * The row shows a band as ONE state, its lead's (FR-012). This is where the evening's lineup is changed a
 * person at a time: a name opens that person's booking, where they are declined or substituted — the one
 * thing the ordinary status click is built never to do (FR-011). Nothing here touches the band itself:
 * its membership is who the band is, not who played on the 14th (FR-025).
 *
 * It also carries the two things only the bookings report offered: re-pointing the dance to another band
 * (feature 024 US2) and adding a musician beside the band already booked (T058a).
 */

export type LineupBooking = {
  id: string;
  performerName: string;
  performerType: string;
  payCents: number;
  status: string;
  bandId: string | null;
  note: string | null;
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function Lineup({
  eventId,
  band,
  bandId,
  bookings,
  bands,
  canBook,
  onOpenBooking,
  onAddMusician,
  onRepointed,
  onChanged,
}: {
  eventId: string;
  band: string | null;
  bandId: string | null;
  /** Every musician booked for the dance — the band's and any beside it. */
  bookings: LineupBooking[];
  /** The bands the dance could be re-pointed to. */
  bands: { id: string; name: string }[];
  canBook: boolean;
  onOpenBooking: (b: LineupBooking) => void;
  onAddMusician: () => void;
  onRepointed: () => void;
  /** A booking here was changed (the band note) — re-read the lineup and the table. */
  onChanged: () => void;
}) {
  const [toBandId, setToBandId] = useState("");
  const [error, setError] = useState<string | null>(null);

  /**
   * The band note (087 walk-through): a band's booking is one booking per member, so its note is the
   * LEAD's booking note — the field is overloaded on purpose. With no lead, it is the member whose state
   * the table shows for the band, so the note and the state letter always come from the same booking.
   */
  const bandLines = bookings.filter((b) => bandId && b.bandId === bandId);
  const noteHolder =
    bandLines.find((b) => b.performerType === "lead_musician") ??
    bandLines.find((b) => b.status !== "declined") ??
    null;
  const [bandNote, setBandNote] = useState(noteHolder?.note ?? "");
  const [noteSaved, setNoteSaved] = useState(false);

  async function saveBandNote() {
    if (!noteHolder) return;
    setError(null);
    setNoteSaved(false);
    const res = await apiFetch(`/api/bookings/${noteHolder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: bandNote.trim() || null }),
    });
    if (!res.ok) return setError("The band note could not be saved.");
    setNoteSaved(true);
    onChanged();
  }

  // The lead first, then the rest of the band, then anyone booked beside it — the order a Booker reads.
  const rank = (b: LineupBooking) =>
    b.performerType === "lead_musician" ? 0 : b.bandId && b.bandId === bandId ? 1 : 2;
  const ordered = [...bookings].sort((a, b) => rank(a) - rank(b));
  const others = bands.filter((b) => b.id !== bandId);

  // Feature 024 US2: unpaid outgoing bookings are removed, a live-paid one is kept as a no-show, and the
  // incoming band's roster is booked fresh — all server-side.
  async function repoint() {
    if (!toBandId || !bandId) return;
    setError(null);
    const res = await apiFetch(`/api/events/${eventId}/repoint-band`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromBandId: bandId, toBandId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setError(data?.error?.message ?? "Could not re-point the band.");
    }
    onRepointed();
  }

  return (
    <>
      {noteHolder &&
        (canBook ? (
          <div className={styles.member}>
            <label style={{ flexBasis: "100%" }}>
              Band note
              <textarea
                aria-label="Band note"
                rows={2}
                style={{ display: "block", inlineSize: "100%" }}
                value={bandNote}
                onChange={(e) => {
                  setBandNote(e.target.value);
                  setNoteSaved(false);
                }}
              />
            </label>
            <button type="button" onClick={() => void saveBandNote()}>
              Save band note
            </button>
            {noteSaved && <span role="status">Saved.</span>}
          </div>
        ) : (
          noteHolder.note && (
            <p>
              <strong>Band note:</strong> {noteHolder.note}
            </p>
          )
        ))}

      {ordered.length === 0 ? (
        <p>No musicians booked.</p>
      ) : (
        <ul aria-label="Lineup" className={styles.results}>
          {ordered.map((b) => (
            <li key={b.id}>
              <button type="button" className={styles.link} onClick={() => onOpenBooking(b)}>
                {b.performerName}
              </button>
              {b.performerType === "lead_musician" && " (lead)"} — {b.status} —{" "}
              {dollars(b.payCents)}
            </li>
          ))}
        </ul>
      )}

      {canBook && (
        <div className={styles.choices}>
          <button type="button" onClick={onAddMusician}>
            Add a musician
          </button>
        </div>
      )}

      {canBook && bandId && others.length > 0 && (
        <div className={styles.member}>
          <label>
            Re-point {band ?? "this band"} to{" "}
            <select value={toBandId} onChange={(e) => setToBandId(e.target.value)}>
              <option value="">choose a band</option>
              {others.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={!toBandId} onClick={() => void repoint()}>
            Re-point band
          </button>
        </div>
      )}

      {error && <p role="alert">{error}</p>}
    </>
  );
}
