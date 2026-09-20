"use client";
import { useState } from "react";
import Dialog from "@/app/_components/Dialog";
import { money } from "./save";
import styles from "./gate.module.css";

/** Feature 082 (FR-010): the bill faces, largest first, then the coins as one dollar amount. */
const FACES = ["100", "50", "20", "10", "5", "1", "coins"] as const;
type Face = (typeof FACES)[number];
export type CashCount = Partial<Record<Face, number>>;

const label = (f: Face) => (f === "coins" ? "Coins" : `$${f}`);

/** What a denomination is worth, in cents: a count of bills, or the coins' own dollar amount. */
function worth(face: Face, typed: string): number {
  const n = Number(typed) || 0;
  return face === "coins" ? Math.round(n * 100) : n * Number(face) * 100;
}

/** The counts as the dialog keys them — strings, so "4." can be typed on the way to "4.35". */
function typedFrom(count: CashCount): Record<Face, string> {
  return Object.fromEntries(
    FACES.map((f) => [f, count[f] !== undefined && count[f] !== 0 ? String(count[f]) : ""]),
  ) as Record<Face, string>;
}

function countFrom(typed: Record<Face, string>): CashCount {
  const out: CashCount = {};
  for (const f of FACES) if (Number(typed[f])) out[f] = Number(typed[f]);
  return out;
}

/**
 * Feature 082 (FR-010–FR-013, research R9): counting the drawer. The keypad is buttons, so it works on a
 * phone with no keyboard and needs no focus tricks; the total runs as the counts go in. Checks are not
 * counted here — they are recorded one by one (FR-013).
 *
 * The count is kept (`onKeep`) whenever Mary moves off a denomination or closes the dialog, so neither a
 * reload nor a closed dialog loses a half-finished count (FR-012).
 */
export default function CountDialog({
  initial,
  onKeep,
  onUse,
  onClose,
}: {
  initial: CashCount;
  onKeep: (count: CashCount) => void;
  onUse: (totalDollars: number) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState(() => typedFrom(initial));
  const [at, setAt] = useState(0);
  const face = FACES[at]!;
  const totalCents = FACES.reduce((a, f) => a + worth(f, typed[f]), 0);

  const keep = () => onKeep(countFrom(typed));
  const move = (to: number) => {
    keep();
    setAt(Math.max(0, Math.min(FACES.length - 1, to)));
  };
  const press = (k: string) =>
    setTyped((t) => {
      const current = t[face];
      if (k === "." && (face !== "coins" || current.includes("."))) return t;
      // Coins are dollars and cents; nothing past the cents.
      if (face === "coins" && /\.\d\d$/.test(current)) return t;
      return { ...t, [face]: current + k };
    });
  const erase = () => setTyped((t) => ({ ...t, [face]: t[face].slice(0, -1) }));
  const close = () => {
    keep();
    onClose();
  };

  return (
    <Dialog label="Count the cash" onClose={close}>
      <ul className={styles.list}>
        {FACES.map((f, i) => (
          <li key={f}>
            <button
              type="button"
              aria-label={label(f)}
              aria-pressed={i === at}
              className={`${styles.faceRow} ${i === at ? styles.faceChosen : ""}`}
              onClick={() => move(i)}
            >
              <span>{label(f)}</span>
              <span>{typed[f] || "—"}</span>
              <span className={styles.quiet}>{money(worth(f, typed[f]) / 100)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className={styles.total} aria-live="polite">
        Total {money(totalCents / 100)}
      </p>
      <div className={styles.keypad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
          <button key={k} type="button" className={styles.key} onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button
          type="button"
          className={styles.key}
          aria-label="Decimal point"
          disabled={face !== "coins"}
          onClick={() => press(".")}
        >
          .
        </button>
        <button type="button" className={styles.key} onClick={() => press("0")}>
          0
        </button>
        <button type="button" className={styles.key} onClick={erase}>
          Delete
        </button>
        <button type="button" className={styles.key} onClick={() => move(at - 1)}>
          Previous
        </button>
        <span />
        <button type="button" className={styles.key} onClick={() => move(at + 1)}>
          Next
        </button>
      </div>
      <div className={styles.buttons}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => {
            keep();
            onUse(totalCents / 100);
          }}
        >
          Use as gross cash
        </button>
        <button type="button" className={styles.button} onClick={close}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
