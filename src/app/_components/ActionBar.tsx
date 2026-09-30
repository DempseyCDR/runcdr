import type { ReactNode } from "react";
import styles from "./ActionBar.module.css";

/**
 * Feature 089 (FR-014–FR-018): a form's actions, together in one bar, the main action last — bottom right.
 *
 * `lead` comes first (a dialog's Close, or the "Discard your changes?" question), then the children in
 * the order given; the whole bar sits flush right, so the main action is always bottom right. The bar
 * stays on one line: a long label wraps inside its button rather than the buttons wrapping to a new row.
 *
 * A dialog renders its bar itself; a page with page-level actions (the gate's Save, the gate report's
 * Print) uses `pinned`, which holds the bar at the bottom of the screen, clear of the home indicator.
 */
export default function ActionBar({
  lead,
  pinned = false,
  children,
}: {
  lead?: ReactNode;
  pinned?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label="Actions"
      className={pinned ? `${styles.bar} ${styles.pinned}` : styles.bar}
      data-pinned={pinned ? "" : undefined}
    >
      {lead !== undefined && <div className={styles.lead}>{lead}</div>}
      {children}
    </div>
  );
}
