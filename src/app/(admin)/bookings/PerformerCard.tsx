"use client";
import { apiFetch } from "@/app/apiFetch";

import { useState } from "react";
import PerformerForm, { type Performer } from "../_performers/PerformerForm";
import type { PerformerHistoryItem } from "@/server/domain/bookings/performerHistory";
import type { PerformerBand } from "@/server/domain/bands/bandService";
import styles from "./hub.module.css";

/**
 * Feature 087 US3 — a performer, opened from the hub's search. It replaces the performers page.
 *
 * The form is the one that page used, unchanged (research R5). Two questions are added beside it, both
 * ones the old bookings report answered with filters the hub deliberately dropped (FR-001b): where has
 * this person played and where are they booked (FR-019), and which bands are they in (FR-020).
 *
 * Both are asked on demand rather than on opening: most visits to a performer are to change something
 * about them, and neither list is needed for that.
 */

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

export default function PerformerCard({
  performer,
  initialName,
  readOnly,
  onSaved,
  onClose,
  onOpenBand,
}: {
  /** The whole record — absent when making a new performer. */
  performer?: Performer;
  initialName?: string;
  readOnly: boolean;
  onSaved: () => void;
  onClose: () => void;
  onOpenBand: (band: { id: string; name: string }) => void;
}) {
  const [dances, setDances] = useState<PerformerHistoryItem[] | null>(null);
  const [bands, setBands] = useState<PerformerBand[] | null>(null);

  async function toggleDances() {
    if (dances) return setDances(null);
    const res = await apiFetch(`/api/performers/${performer!.id}/history`);
    setDances(res.ok ? ((await res.json()).items ?? []) : []);
  }

  async function toggleBands() {
    if (bands) return setBands(null);
    const res = await apiFetch(`/api/bands?performer=${performer!.id}`);
    setBands(res.ok ? ((await res.json()).items ?? []) : []);
  }

  return (
    <>
      <h2>{performer?.displayName ?? "New performer"}</h2>

      {performer && (
        <div className={styles.choices}>
          <button type="button" aria-expanded={!!dances} onClick={() => void toggleDances()}>
            Dances
          </button>
          <button type="button" aria-expanded={!!bands} onClick={() => void toggleBands()}>
            Bands
          </button>
        </div>
      )}

      {dances && (
        <section>
          {dances.length === 0 ? (
            <p>No dances — played or booked.</p>
          ) : (
            <ul aria-label="Dances" className={styles.results}>
              {dances.map((d) => (
                <li key={`${d.eventId}-${d.role}`}>
                  {d.date} {hhmm(d.startTime)} — {d.label ?? d.series} — {d.role.replace(/_/g, " ")}
                  , {d.status}
                  {d.cancelled && " (dance cancelled)"}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {bands && (
        <section>
          {bands.length === 0 ? (
            <p>Not in any band.</p>
          ) : (
            <ul aria-label="Bands" className={styles.results}>
              {bands.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => onOpenBand({ id: b.id, name: b.name })}
                  >
                    {b.name}
                  </button>
                  {b.isLead && " (lead)"}
                  {b.archived && " (archived)"}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <PerformerForm
        performer={performer}
        readOnly={readOnly}
        initialName={initialName}
        onSaved={onSaved}
        onClose={onClose}
      />
    </>
  );
}
