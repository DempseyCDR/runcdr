"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import ContactName from "@/app/_components/ContactName";
import AttendanceBreakdownView from "@/app/_components/AttendanceBreakdownView";
import type { AttendanceBreakdown } from "@/server/domain/attendance/breakdownService";
import CorrectionModal, { type Attendee } from "./CorrectionModal";
import styles from "./checkin.module.css";

type Sort = "display" | "first" | "last";
const SORTS: [Sort, string][] = [
  ["display", "Display name"],
  ["first", "First name"],
  ["last", "Last name"],
];

/**
 * Feature 079, User Story 3 (FR-018–FR-021): who is in tonight, and the evening's attendance breakdown.
 *
 * Both are fetched when the dialog opens and again after every correction — the list and counts are the
 * server's, so a reliever on another phone sees every attendant's check-ins (MEG-R6). Nothing updates on its
 * own while the dialog is open.
 */
export default function CheckedInDialog({
  eventId,
  isCommunityDance,
  onClose,
}: {
  eventId: string;
  isCommunityDance: boolean;
  onClose: () => void;
}) {
  const [sort, setSort] = useState<Sort>("display");
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [breakdown, setBreakdown] = useState<AttendanceBreakdown | null>(null);
  const [editing, setEditing] = useState<Attendee | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    const [list, counts] = await Promise.all([
      apiFetch(`/api/events/${eventId}/attendance?sort=${sort}`).then((r) => r.json()),
      apiFetch(`/api/events/${eventId}/attendance-breakdown`).then((r) => r.json()),
    ]);
    setAttendees(list.attendees ?? []);
    setBreakdown(counts as AttendanceBreakdown);
  }, [eventId, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.backdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Checked in"
        className={styles.panel}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !editing) onClose();
        }}
      >
        <div className={styles.eventLine}>
          <h2 className={styles.dialogHeading}>Checked in</h2>
          <button type="button" className={styles.button} onClick={onClose}>
            Close
          </button>
        </div>

        {breakdown && <AttendanceBreakdownView breakdown={breakdown} />}

        <div className={styles.choices} role="group" aria-label="Sort by">
          {SORTS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={styles.button}
              aria-pressed={sort === key}
              onClick={() => setSort(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <ul aria-label="Checked in" className={styles.results}>
          {attendees.map((a) => (
            <li key={a.id} className={styles.result}>
              <button
                type="button"
                className={styles.attendeeButton}
                title="Correct this check-in"
                onClick={() => setEditing(a)}
              >
                {a.displayName ? (
                  <ContactName
                    c={{
                      displayName: a.displayName,
                      firstName: a.firstName,
                      lastName: a.lastName,
                      displayNameOverride: a.displayNameOverride,
                    }}
                  >
                    {a.childrenCount > 0 ? ` +${a.childrenCount}` : ""}
                    {a.isOpenBand ? " · open band" : ""}
                  </ContactName>
                ) : (
                  <span>Anonymous{a.childrenCount > 0 ? ` +${a.childrenCount}` : ""}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {editing && (
        <CorrectionModal
          attendee={editing}
          eventId={eventId}
          isCommunityDance={isCommunityDance}
          onClose={() => {
            setEditing(null);
            void load(); // comp and gift-card nudges change the counts without closing it
          }}
          onDone={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
