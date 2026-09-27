import { Fragment, type ReactNode } from "react";
import type { BookingStatus } from "@/server/db/schema";
import type {
  BookingsReportBookingLine,
  BookingsReportRow,
} from "@/server/domain/bookings/reportService";
import styles from "./hub.module.css";

/**
 * Feature 087 — one dance on Booking Central.
 *
 * US1: a row, and beneath it the dance's note (FR-014). Every slot the dance WANTS is filled or marked
 * (FR-004); a slot it does not want is left alone (FR-004a).
 *
 * US2: every part of the row is a way in — the label opens the dance, the venue opens the venue, a name
 * opens THAT booking, a band opens that dance's band bookings, a state letter advances, and a gap mark
 * begins filling the gap. The mark that says someone is wanted is the control that engages one (FR-013a).
 */

export const LETTER: Record<string, string> = {
  proposed: "P",
  requested: "R",
  tentative: "T",
  confirmed: "C",
  declined: "D",
};

/**
 * The ordinary click moves a booking along its course and STOPS at confirmed (FR-011). Declined is not in
 * this cycle and can never be reached from it: declining is a deliberate act done on the booking itself
 * (FR-013). The service can still set any status — this rule is the control's, which is why it is proved
 * where the control lives.
 */
export const NEXT: Partial<Record<BookingStatus, BookingStatus>> = {
  proposed: "requested",
  requested: "tentative",
  tentative: "confirmed",
};

const MUSICIAN_TYPES = new Set(["lead_musician", "musician"]);

/** "19:30:00" → "19:30". */
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

/** Loose musicians are shown by last name (FR-003) — the Booker's spreadsheet convention. */
const lastName = (name: string) => name.trim().split(/\s+/).pop() ?? name;

/** A booking fills its slot unless it has been declined — a declined slot wants filling again. */
const fills = (b: BookingsReportBookingLine) => b.status !== "declined";

/** What the row can do. Absent for a viewer who may only read. */
export type RowActions = {
  canBook: boolean;
  openEvent: (row: BookingsReportRow) => void;
  openVenue: (venueId: string) => void;
  openBooking: (row: BookingsReportRow, bookingId: string) => void;
  openBand: (row: BookingsReportRow) => void;
  advance: (row: BookingsReportRow, line: BookingsReportBookingLine) => void;
  fill: (row: BookingsReportRow, role: "caller" | "music" | "sound_tech") => void;
  /** Book ANOTHER into a slot already filled — a second musician, an instructor (087 walk-through). */
  add: (row: BookingsReportRow, cell: "caller" | "music" | "sound") => void;
};

function State({
  who,
  line,
  onAdvance,
}: {
  who: string;
  line: BookingsReportBookingLine;
  onAdvance?: () => void;
}) {
  const label = `${who}: ${line.status}`;
  const className = `${styles.state} ${styles[`state_${line.status}`] ?? ""}`;
  // Only a booking that can still move is a control. At confirmed (or declined) there is nothing an
  // ordinary click may do, so it is not a button at all — not merely a disabled one.
  if (onAdvance && NEXT[line.status]) {
    return (
      <button
        type="button"
        className={className}
        aria-label={label}
        title={`${line.status} — click for ${NEXT[line.status]}`}
        onClick={onAdvance}
      >
        {LETTER[line.status] ?? "?"}
      </button>
    );
  }
  return (
    <span className={className} aria-label={label} title={line.status}>
      {LETTER[line.status] ?? "?"}
    </span>
  );
}

/** The mark for a slot the dance wants and nobody fills. A dash first, so it reads without colour. */
export function Gap({ label, onFill }: { label: string; onFill?: () => void }) {
  if (onFill) {
    return (
      <button
        type="button"
        className={styles.gap}
        aria-label={label}
        title={label}
        onClick={onFill}
      >
        –
      </button>
    );
  }
  return (
    <span className={styles.gap} role="img" aria-label={label} title={label}>
      –
    </span>
  );
}

/**
 * Add another to a filled slot. The gap mark is the way in while a slot is empty; once it is filled the
 * mark goes, and without this nothing could book a second musician — or an instructor at all, since that
 * slot is never marked (087 walk-through).
 */
function Add({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <button type="button" className={styles.add} aria-label={label} title={label} onClick={onAdd}>
      +
    </button>
  );
}

/** A name that opens its booking, or plain text for a viewer who may only read. */
function Name({ text, onOpen }: { text: string; onOpen?: () => void }) {
  return onOpen ? (
    <button type="button" className={styles.link} onClick={onOpen}>
      {text}
    </button>
  ) : (
    <>{text}</>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <td aria-label={label}>
      <span className={styles.people}>{children}</span>
    </td>
  );
}

export function HubRow({
  row,
  columns,
  actions,
}: {
  row: BookingsReportRow;
  columns: number;
  actions?: RowActions;
}) {
  const of = (type: string) => row.bookings.filter((b) => b.type === type);
  const callers = of("caller");
  const instructors = of("instructor");
  const sound = of("sound_tech");

  // A band shows ONE state — its lead's, which carries the rest (FR-012). Loose musicians show their own.
  const bandLines = row.bandId ? row.bookings.filter((b) => b.bandId === row.bandId) : [];
  const bandLead =
    bandLines.find((b) => b.type === "lead_musician") ?? bandLines.find((b) => fills(b));
  const loose = row.bookings.filter((b) => MUSICIAN_TYPES.has(b.type) && !b.bandId);

  const callerFilled = callers.some(fills);
  const showsBand = !!(row.band && bandLead);
  const musicFilled = (row.band !== null && bandLines.some(fills)) || loose.some(fills);
  const soundFilled = sound.some(fills);

  const book = actions?.canBook ? actions : undefined;
  const person = (b: BookingsReportBookingLine, text: string) => (
    <span key={b.bookingId} className={styles.person}>
      <Name
        text={text}
        onOpen={actions ? () => actions.openBooking(row, b.bookingId) : undefined}
      />
      <State who={b.performer} line={b} onAdvance={book ? () => book.advance(row, b) : undefined} />
    </span>
  );

  /**
   * Performers' notes, read in the dance's note line after its own note (087 walk-through), in the order
   * of the columns. A band's note is its LEAD's booking note, shown under the band's name; any other
   * member's note is shown under their own.
   */
  const bandNoteLine = row.band && bandLead ? bandLead : null;
  const performerNotes = [
    ...callers,
    ...instructors,
    ...(bandNoteLine ? [bandNoteLine] : []),
    ...bandLines.filter((b) => b !== bandNoteLine),
    ...loose,
    ...sound,
  ]
    .filter((b) => b.note)
    .map((b) => ({
      key: b.bookingId,
      who: b === bandNoteLine ? row.band! : b.performer,
      note: b.note!,
    }));

  const callerCellName = [...callers, ...instructors].map((b) => b.performer).join(", ");
  // A dance with no label is named by its series — the convention the gate report uses too.
  const title = row.label ?? row.series;

  return (
    <>
      <tr className={`${styles.dance} ${row.cancelled ? styles.cancelled : ""}`}>
        <td className={styles.date}>{row.date}</td>
        <td className={styles.date}>{hhmm(row.startTime)}</td>
        <td>
          <Name text={title} onOpen={actions ? () => actions.openEvent(row) : undefined} />
          {row.cancelled && <span className={styles.cancelledWord}>Cancelled</span>}
        </td>
        <td>
          {row.venueShortName && row.venueId ? (
            <Name
              text={row.venueShortName}
              onOpen={actions ? () => actions.openVenue(row.venueId!) : undefined}
            />
          ) : (
            // No venue: the mark opens the dance, which is where a venue is chosen.
            <Gap
              label="No venue assigned"
              onFill={actions ? () => actions.openEvent(row) : undefined}
            />
          )}
        </td>

        {/* The caller first, then any instructor — they share this cell (FR-003a). An instructor never
            fills the caller's slot: a workshop does not excuse a dance from having someone to call it. */}
        <Cell label={callerCellName || "Caller"}>
          {callers.map((b) => person(b, b.performer))}
          {!callerFilled && (
            <Gap
              label="No caller booked"
              onFill={book ? () => book.fill(row, "caller") : undefined}
            />
          )}
          {instructors.map((b) => person(b, b.performer))}
          {book && callerFilled && (
            <Add label="Add a caller or instructor" onAdd={() => book.add(row, "caller")} />
          )}
        </Cell>

        <Cell label="Music">
          {row.band && bandLead && (
            <span className={styles.person}>
              <Name text={row.band} onOpen={actions ? () => actions.openBand(row) : undefined} />
              <State
                who={row.band}
                line={bandLead}
                onAdvance={book ? () => book.advance(row, bandLead) : undefined}
              />
            </span>
          )}
          {/* A musician booked beside a band reads "<band> featuring <musician>" (087 walk-through); on
              their own, musicians are listed by last name as before. */}
          {showsBand && loose.length > 0 && <span className={styles.featuring}>featuring</span>}
          {loose.map((b, i) => (
            <Fragment key={b.bookingId}>
              {showsBand && i > 0 && (
                <span className={styles.featuring}>{i === loose.length - 1 ? "and" : ","}</span>
              )}
              {person(b, lastName(b.performer))}
            </Fragment>
          ))}
          {!musicFilled && (
            <Gap
              label="No music booked"
              onFill={book ? () => book.fill(row, "music") : undefined}
            />
          )}
          {book && musicFilled && <Add label="Add music" onAdd={() => book.add(row, "music")} />}
        </Cell>

        {/* Only where the series uses a sound tech — otherwise the slot is not wanted and is never marked,
            so the Booker is not taught to ignore a permanent warning (FR-004a). */}
        <Cell label="Sound">
          {sound.map((b) => person(b, b.performer))}
          {row.hasSoundTech && !soundFilled && (
            <Gap
              label="No sound tech booked"
              onFill={book ? () => book.fill(row, "sound_tech") : undefined}
            />
          )}
          {book && soundFilled && (
            <Add label="Add a sound tech" onAdd={() => book.add(row, "sound")} />
          )}
        </Cell>
      </tr>
      {(row.note || performerNotes.length > 0) && (
        <tr className={`${styles.note} ${row.cancelled ? styles.cancelled : ""}`}>
          <td colSpan={columns}>
            {[
              ...(row.note ? [<span key="dance">{row.note}</span>] : []),
              ...performerNotes.map((n) => (
                <span key={n.key}>
                  <strong>{n.who}:</strong> {n.note}
                </span>
              )),
            ].map((part, i) => (
              <Fragment key={i}>
                {i > 0 && " · "}
                {part}
              </Fragment>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}
