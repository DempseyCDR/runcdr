"use client";
import { useState } from "react";
import { EventSelector, type EventRow } from "@/app/EventSelector";
import { localToday } from "@/app/localToday";
import styles from "./EventConfirm.module.css";

type SeriesRow = { id: string; key: string; name: string };

/** The DB `time` column round-trips as HH:MM:SS; feature 081 shows it on a 12-hour clock ("7:30 PM"). */
export function to12Hour(t: string | null): string {
  if (!t) return "";
  const m = /^(\d{2}):(\d{2})/.exec(t);
  if (!m) return t;
  const hours = Number(m[1]);
  return `${hours % 12 || 12}:${m[2]} ${hours < 12 ? "AM" : "PM"}`;
}

/**
 * Feature 079 (FR-003, research R9): the event Meg is checking dancers into, confirmed before she starts.
 * Feature 081 (FR-002): shared with the performer payments page, where Mary confirms the evening she pays.
 *
 * Shown large, with a warning when it is not today's — on the device's own date, since the door phone is at
 * the venue. The shared selector stays mounted (it picks the default event) but is shown only on **Change**,
 * or when there is no event yet to confirm.
 */
export default function EventConfirm({
  event,
  series,
  onSelect,
  defaultToMySeries = false,
}: {
  event: EventRow | null;
  series: SeriesRow[];
  onSelect: (event: EventRow) => void;
  /**
   * Feature 086 (FR-010, FR-013): forwarded to the shared selector. Gate money and payments opt in;
   * check-in mounts this same wrapper and deliberately does not, so the default cannot be applied here
   * on everyone's behalf — each page says for itself.
   */
  defaultToMySeries?: boolean;
}) {
  const [changing, setChanging] = useState(false);
  const seriesName = event ? (series.find((s) => s.id === event.seriesId)?.name ?? "") : "";
  const notToday = !!event && event.eventDate !== localToday();

  return (
    <section aria-label="Event" className={styles.event}>
      <div className={styles.eventLine}>
        <h1 className={styles.eventHeading}>
          {event
            ? // Feature 081: the series first, then the label, the date and the time.
              [seriesName, event.label, event.eventDate, to12Hour(event.startTime)]
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
          defaultToMySeries={defaultToMySeries}
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
