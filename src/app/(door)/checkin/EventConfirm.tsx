"use client";
import { useState } from "react";
import { EventSelector, type EventRow } from "@/app/EventSelector";
import { localToday } from "@/app/localToday";
import styles from "./checkin.module.css";

type SeriesRow = { id: string; key: string; name: string };

/** The DB `time` column round-trips as HH:MM:SS; show HH:MM (feature 020 normalization). */
function toHHMM(t: string | null): string {
  if (!t) return "";
  const m = /^(\d{2}):(\d{2})/.exec(t);
  return m ? `${m[1]}:${m[2]}` : t;
}

/**
 * Feature 079 (FR-003, research R9): the event Meg is checking dancers into, confirmed before she starts.
 *
 * Shown large, with a warning when it is not today's — on the device's own date, since the door phone is at
 * the venue. The shared selector stays mounted (it picks the default event) but is shown only on **Change**,
 * or when there is no event yet to confirm.
 */
export default function EventConfirm({
  event,
  series,
  onSelect,
}: {
  event: EventRow | null;
  series: SeriesRow[];
  onSelect: (event: EventRow) => void;
}) {
  const [changing, setChanging] = useState(false);
  const seriesName = event ? (series.find((s) => s.id === event.seriesId)?.name ?? "") : "";
  const notToday = !!event && event.eventDate !== localToday();

  return (
    <section aria-label="Event" className={styles.event}>
      <div className={styles.eventLine}>
        <h1 className={styles.eventHeading}>
          {event
            ? [event.eventDate, seriesName, toHHMM(event.startTime), event.label]
                .filter(Boolean)
                .join(" · ")
            : "No event selected"}
        </h1>
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => setChanging((c) => !c)}
          aria-expanded={changing || !event}
        >
          Change
        </button>
      </div>
      {notToday && (
        <p className={styles.warning}>Not today — this event is on {event.eventDate}.</p>
      )}
      <div hidden={!changing && !!event}>
        <EventSelector
          value={event?.id ?? ""}
          onSelect={(e) => {
            setChanging(false);
            onSelect(e);
          }}
        />
      </div>
    </section>
  );
}
