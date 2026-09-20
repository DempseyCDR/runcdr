"use client";
import AttendanceBreakdownView from "@/app/_components/AttendanceBreakdownView";
import type { AttendanceBreakdown } from "@/server/domain/attendance/breakdownService";
import type { DoorRecord, MoneyForm } from "./types";
import styles from "./gate.module.css";

/**
 * Feature 082 (FR-005): the counts the door kept, for Mary to confirm. Comps and gift cards are editable
 * beside what was recorded; open-band comps are the door's alone and read-only.
 *
 * The door and the gate keep ONE count each (the door adds to it at check-in, the gate's Save sets it), so
 * "what the door recorded" is only that until the gate first saves the money — after that the figure is
 * the gate's own, and the hint says so rather than claiming otherwise.
 */
export default function DoorCounts({
  form,
  record,
  breakdown,
  disabled,
  onChange,
}: {
  form: MoneyForm;
  record: DoorRecord;
  breakdown: AttendanceBreakdown | null;
  disabled: boolean;
  onChange: (patch: Partial<MoneyForm>) => void;
}) {
  const recorded = (n: number) =>
    record.moneyRecordedBy ? `last saved ${n}` : `the door recorded ${n}`;
  return (
    <section aria-labelledby="gate-counts" className={styles.section}>
      <h2 id="gate-counts" className={styles.sectionHeading}>
        Door counts
      </h2>
      <div className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="gate-comps">Comps (admitted free)</label>
          <input
            id="gate-comps"
            className={styles.input}
            inputMode="numeric"
            aria-describedby="gate-comps-door"
            value={form.compCount}
            disabled={disabled}
            onChange={(e) => onChange({ compCount: e.target.value })}
          />
          <span id="gate-comps-door" className={styles.hint}>
            {recorded(record.compCount)}
          </span>
        </div>
        <div className={styles.field}>
          <label htmlFor="gate-gifts">Gift cards redeemed</label>
          <input
            id="gate-gifts"
            className={styles.input}
            inputMode="numeric"
            aria-describedby="gate-gifts-door"
            value={form.giftCardRedemptionCount}
            disabled={disabled}
            onChange={(e) => onChange({ giftCardRedemptionCount: e.target.value })}
          />
          <span id="gate-gifts-door" className={styles.hint}>
            {recorded(record.giftCardRedemptionCount)}
          </span>
        </div>
      </div>
      <p className={styles.quiet}>Open-band comps: {record.openBandCount}</p>
      {/* Feature 079 (FR-027): who came, beside the counts it is made of. */}
      {breakdown && <AttendanceBreakdownView breakdown={breakdown} />}
    </section>
  );
}
