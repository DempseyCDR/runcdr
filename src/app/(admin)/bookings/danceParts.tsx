import { Fragment, type ReactNode } from "react";
import type { BookingStatus } from "@/server/db/schema";
import type {
  BookingsReportBookingLine,
  BookingsReportRow,
} from "@/server/domain/bookings/reportService";
import styles from "./hub.module.css";

/**
 * Feature 087 — one dance on Booking Central; feature 091 (research R4) — its parts, in one place.
 *
 * Every slot the dance WANTS is filled or marked (087 FR-004); a slot it does not want is left alone
 * (FR-004a). With actions, every part is a way in — the label opens the dance, the venue opens the venue, a
 * name opens THAT booking, a band opens that dance's band bookings, a state letter advances, and a gap mark
 * begins filling the gap (FR-013a). Without actions, the same parts are text: names, letters and marks.
 *
 * The table's row, the phone's card and the opened dance all render from these parts, so the three can
 * never disagree about who is booked, what is missing, or what may be done (091 FR-014, SC-005).
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
export const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

/** Loose musicians are shown by last name (FR-003) — the Booker's spreadsheet convention. */
const lastName = (name: string) => name.trim().split(/\s+/).pop() ?? name;

/**
 * Feature 091 (FR-002b, Rich 2026-10-01): on a card, every performer is "C. Sloboda" — first initial and
 * last name — so Sean can tell Catherine Sloboda from her brother Matt in a narrow column. A one-word
 * name is left whole.
 */
const initialAndLast = (name: string) => {
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? `${words[0]!.charAt(0)}. ${words[words.length - 1]}` : name.trim();
};

/** A booking fills its slot unless it has been declined — a declined slot wants filling again. */
const fills = (b: BookingsReportBookingLine) => b.status !== "declined";

/** What the parts can do. Absent for a card, or for a viewer who may only read. */
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
  // ordinary click may do, so it is not a button at all — not merely a disabled one. A control is the tap
  // minimum around the letter's chip, which stays small so the table stays a spreadsheet (091).
  if (onAdvance && NEXT[line.status]) {
    return (
      <button
        type="button"
        className={styles.hit}
        aria-label={label}
        title={`${line.status} — click for ${NEXT[line.status]}`}
        onClick={onAdvance}
      >
        <span className={className}>{LETTER[line.status] ?? "?"}</span>
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
        className={styles.hit}
        aria-label={label}
        title={label}
        onClick={onFill}
      >
        <span className={styles.gap}>–</span>
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
    <button type="button" className={styles.hit} aria-label={label} title={label} onClick={onAdd}>
      <span className={styles.add}>+</span>
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

/**
 * A slot's items, with its + kept on the same line as the item before it (Rich, 2026-10-01): the two
 * wrap as one, so a + never sits alone on a line, looking as if it belonged to the next column.
 */
function withAdd(items: ReactNode[], add: ReactNode): ReactNode {
  const shown = items.filter(Boolean);
  if (!add) return <>{shown}</>;
  const last = shown.pop();
  return (
    <>
      {shown}
      <span key="keep" className={styles.keep} data-keep="">
        {last}
        {add}
      </span>
    </>
  );
}

export type DanceParts = {
  /** The dance's label, or its series when it has none — the gate report's convention. */
  name: string;
  /** The name as a way into the dance, with "Cancelled" in words beside it when it is. */
  title: ReactNode;
  venue: ReactNode;
  /** Who is in the caller's cell, for its accessible name. */
  callerLabel: string;
  caller: ReactNode;
  music: ReactNode;
  sound: ReactNode;
  /** The dance's note, then each performer's, in the order of the columns; null when there are none. */
  notes: ReactNode | null;
};

export function danceParts(
  row: BookingsReportRow,
  actions?: RowActions,
  /** `initials`: every performer as "C. Sloboda" (the card). Otherwise the row's names (087 FR-003). */
  naming: "row" | "initials" = "row",
): DanceParts {
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
        text={naming === "initials" ? initialAndLast(b.performer) : text}
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

  const name = row.label ?? row.series;

  return {
    name,
    title: (
      <>
        <Name text={name} onOpen={actions ? () => actions.openEvent(row) : undefined} />
        {row.cancelled && <span className={styles.cancelledWord}>Cancelled</span>}
      </>
    ),

    venue:
      row.venueName && row.venueId ? (
        <Name
          text={row.venueName}
          onOpen={actions ? () => actions.openVenue(row.venueId!) : undefined}
        />
      ) : (
        // No venue: the mark opens the dance, which is where a venue is chosen.
        <Gap
          label="No venue assigned"
          onFill={actions ? () => actions.openEvent(row) : undefined}
        />
      ),

    callerLabel: [...callers, ...instructors].map((b) => b.performer).join(", "),

    // The caller first, then any instructor — they share this cell (FR-003a). An instructor never fills
    // the caller's slot: a workshop does not excuse a dance from having someone to call it.
    caller: withAdd(
      [
        ...callers.map((b) => person(b, b.performer)),
        !callerFilled && (
          <Gap
            key="gap"
            label="No caller booked"
            onFill={book ? () => book.fill(row, "caller") : undefined}
          />
        ),
        ...instructors.map((b) => person(b, b.performer)),
      ],
      book && callerFilled && (
        <Add label="Add a caller or instructor" onAdd={() => book.add(row, "caller")} />
      ),
    ),

    music: withAdd(
      [
        row.band && bandLead && (
          <span key="band" className={`${styles.person} ${styles.band}`}>
            <Name text={row.band} onOpen={actions ? () => actions.openBand(row) : undefined} />
            <State
              who={row.band}
              line={bandLead}
              onAdvance={book ? () => book.advance(row, bandLead) : undefined}
            />
          </span>
        ),
        // A musician booked beside a band reads "<band> featuring <musician>" (087 walk-through); on
        // their own, musicians are listed by last name as before. On a card it is "feat." (091).
        showsBand && loose.length > 0 && (
          <span key="feat" className={styles.featuring}>
            {naming === "initials" ? "feat." : "featuring"}
          </span>
        ),
        ...loose.flatMap((b, i) => [
          showsBand && i > 0 && (
            <span key={`and-${b.bookingId}`} className={styles.featuring}>
              {i === loose.length - 1 ? "and" : ","}
            </span>
          ),
          person(b, lastName(b.performer)),
        ]),
        !musicFilled && (
          <Gap
            key="gap"
            label="No music booked"
            onFill={book ? () => book.fill(row, "music") : undefined}
          />
        ),
      ],
      book && musicFilled && <Add label="Add music" onAdd={() => book.add(row, "music")} />,
    ),

    // Only where the series uses a sound tech is a missing one marked — otherwise the slot is not wanted,
    // so the Booker is not taught to ignore a permanent warning (FR-004a).
    sound: withAdd(
      [
        ...sound.map((b) => person(b, b.performer)),
        row.hasSoundTech && !soundFilled && (
          <Gap
            key="gap"
            label="No sound tech booked"
            onFill={book ? () => book.fill(row, "sound_tech") : undefined}
          />
        ),
      ],
      book && soundFilled && <Add label="Add a sound tech" onAdd={() => book.add(row, "sound")} />,
    ),

    notes:
      row.note || performerNotes.length > 0
        ? [
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
          ))
        : null,
  };
}
