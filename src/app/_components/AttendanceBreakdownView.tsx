import type { AttendanceBreakdown } from "@/server/domain/attendance/breakdownService";
import styles from "./AttendanceBreakdownView.module.css";

/** How a booked kind reads in a double-booking warning. */
const KIND_LABEL: Record<AttendanceBreakdown["doubleBookings"][number]["kinds"][number], string> = {
  caller: "caller",
  lead_musician: "lead musician",
  musician: "musician",
  open_band_musician: "open-band leader",
  sound_tech: "sound tech",
  instructor: "instructor",
};

/**
 * Feature 079 (FR-022, FR-025, FR-027, FR-033): an event's attendance breakdown, rendered identically at the
 * top of the door's checked-in dialog, the treasurer report and the gate page — which is why it is one
 * component taking the server's one computation, never a figure worked out on the page.
 *
 * Two wrapping lists: who paid (paying, children), then who came in without paying. Sound tech and instructor
 * appear only when one was checked in — most events have neither, and a zero would be noise.
 */
export default function AttendanceBreakdownView({ breakdown }: { breakdown: AttendanceBreakdown }) {
  const { performers: p } = breakdown;
  const free: [string, number][] = [
    ["Caller", p.caller],
    ["Band", p.band],
    ...(p.soundTech > 0 ? ([["Sound tech", p.soundTech]] as [string, number][]) : []),
    ...(p.instructor > 0 ? ([["Instructor", p.instructor]] as [string, number][]) : []),
    ["Door attendant", breakdown.doorAttendant],
    ["Comps", breakdown.comps],
    ["Gift cards", breakdown.giftCards],
  ];

  return (
    <section aria-label="Attendance" className={styles.breakdown}>
      <ul className={styles.counts}>
        <Count label="Paying" value={breakdown.paying} />
        <Count label="Children" value={breakdown.children} />
      </ul>
      <ul className={styles.counts}>
        {free.map(([label, value]) => (
          <Count key={label} label={label} value={value} />
        ))}
      </ul>
      {breakdown.doubleBookings.length > 0 && (
        <div role="alert" className={styles.warning}>
          {breakdown.doubleBookings.map((d) => (
            <p key={d.contactId}>
              {`${d.displayName} is booked more than once for this event, as ${d.kinds
                .map((k) => KIND_LABEL[k])
                .join(" and ")} — counted once. Check the booking.`}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <li className={styles.count}>
      <span className={styles.label}>{label}</span> <strong>{value}</strong>
    </li>
  );
}
