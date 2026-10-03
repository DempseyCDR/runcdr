import type { ReactNode } from "react";
import type { BookingsReportRow } from "@/server/domain/bookings/reportService";
import { danceParts, hhmm, type RowActions } from "./danceParts";
import styles from "./hub.module.css";

/** How a dance is named on its card, and in the heading of the dance it opens. */
export function danceName(row: BookingsReportRow): string {
  return [row.date, row.series, row.label].filter(Boolean).join(" · ");
}

/** Whether the dance has a sound slot to show: the series wants one, or one is booked anyway. */
export const showsSound = (row: BookingsReportRow) =>
  row.hasSoundTech || row.bookings.some((b) => b.type === "sound_tech");

/**
 * Feature 091 — one dance on Booking Central, at every width (Rich, 2026-10-01: the card is the basis for
 * every width; the table is retired).
 *
 * **On a phone** the parts WITHOUT actions (research R4): names, state letters and gap marks as text, so
 * nothing on a card can change a booking (FR-002a). Its one control is the button naming the dance,
 * stretched over the whole card (research R5): a tap anywhere opens the dance, where the letters advance.
 *
 * **From 48rem** the card is live, as the table was: the parts WITH actions — a name opens its booking, a
 * letter advances, a gap mark or + fills the slot, the label opens the dance's form, the venue its venue —
 * with the time, the venue and the notes line the phone's card leaves out, and Caller, Music and Sound
 * set side by side across the card.
 */
export function HubCard({
  row,
  wide,
  actions,
  onOpen,
}: {
  row: BookingsReportRow;
  wide: boolean;
  actions: RowActions;
  /** The phone's: open the dance. */
  onOpen: () => void;
}) {
  const parts = danceParts(row, wide ? actions : undefined, "initials");

  // Each kind of performer is a term with its names beside it (Rich: a description list). The pairs are
  // grouped so that, wide, each group is a column; on a phone the groups dissolve into one list.
  const slot = (term: string, names: ReactNode) => (
    <div className={styles.slot}>
      <dt>{term}</dt>
      <dd className={styles.people}>{names}</dd>
    </div>
  );
  const slots = (
    <dl className={styles.cardSlots}>
      {slot("Caller", parts.caller)}
      {slot("Music", parts.music)}
      {showsSound(row) && slot("Sound", parts.sound)}
    </dl>
  );

  return (
    <li
      className={[styles.card, wide && styles.wideCard, row.cancelled && styles.cancelledCard]
        .filter(Boolean)
        .join(" ")}
      data-dance={row.eventId}
    >
      {wide ? (
        <>
          <h2 className={styles.cardHead}>
            <span className={styles.cardWhen}>
              {[row.date, hhmm(row.startTime), row.label ? row.series : null]
                .filter(Boolean)
                .join(" · ")}
              {" · "}
            </span>
            {parts.title}
            <span className={styles.cardVenue}>
              {" · "}
              {parts.venue}
            </span>
          </h2>
          {slots}
          {parts.notes && <p className={styles.cardNotes}>{parts.notes}</p>}
        </>
      ) : (
        <>
          <h2 className={styles.cardHead}>
            <button type="button" className={styles.cardOpen} onClick={onOpen}>
              {danceName(row)}
            </button>
          </h2>
          {row.cancelled && <p className={styles.cancelledWord}>Cancelled</p>}
          {slots}
        </>
      )}
    </li>
  );
}
