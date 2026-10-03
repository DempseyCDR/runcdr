import type { ReactNode } from "react";
import Dialog from "@/app/_components/Dialog";
import type { BookingsReportRow } from "@/server/domain/bookings/reportService";
import { danceParts, hhmm, type RowActions } from "./danceParts";
import { danceName, showsSound } from "./HubCard";
import styles from "./hub.module.css";

/**
 * Feature 091 US1 (contracts/page.md D1–D6) — a dance opened from its card.
 *
 * The shared dialog, which fills a phone's screen, holding the dance's parts WITH the actions (research
 * R4): everything its row offers on a computer — a name opens its booking, a letter advances, a gap mark
 * or + fills a slot, the venue opens the venue — plus the way into the dance's own form. The editors these
 * open stack on top of it; closing it returns to the card (the dialog gives focus back).
 */
export default function DanceView({
  row,
  actions,
  canEditDance,
  onClose,
}: {
  row: BookingsReportRow;
  actions: RowActions;
  canEditDance: boolean;
  onClose: () => void;
}) {
  // Named as on the card — "C. Sloboda", "feat." (Rich, 2026-10-01).
  const parts = danceParts(row, actions, "initials");
  const section = (heading: string, body: ReactNode) => (
    <section className={styles.danceSection} aria-label={heading}>
      <h3>{heading}</h3>
      <div className={styles.people}>{body}</div>
    </section>
  );

  return (
    <Dialog heading={danceName(row)} onClose={onClose}>
      <div className={styles.danceView}>
        <p className={styles.danceWhen}>
          {[row.date, hhmm(row.startTime)].filter(Boolean).join(" · ")}
          {row.cancelled && <span className={styles.cancelledWord}>Cancelled</span>}
        </p>
        {section("Venue", parts.venue)}
        {section("Caller", parts.caller)}
        {section("Music", parts.music)}
        {showsSound(row) && section("Sound", parts.sound)}
        {parts.notes && section("Notes", parts.notes)}
        <button type="button" className={styles.danceForm} onClick={() => actions.openEvent(row)}>
          {canEditDance ? "Edit dance" : "View dance"}
        </button>
      </div>
    </Dialog>
  );
}
