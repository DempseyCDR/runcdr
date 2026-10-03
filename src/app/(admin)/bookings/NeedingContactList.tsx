import type { PerformerNeedingContact } from "@/server/domain/performers/needContact";
import styles from "./hub.module.css";

/** How each reason reads in the list — the words the Booker would use. */
const NEED_REASON = { none: "no contact", archived: "contact archived", merged: "contact merged" };

/**
 * Feature 087 US5 (FR-026) — the performers the Booker cannot reach, each opened to be settled: link a
 * contact, create one, or archive the performer. Feature 091 (research R7): one list, shown by the
 * computer's prompt and inside the phone's Performers dialog.
 */
export default function NeedingContactList({
  needing,
  onOpen,
}: {
  needing: PerformerNeedingContact[];
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <p>Open one to settle it: link a contact, create one, or archive the performer.</p>
      <ul aria-label="Performers who need a contact" className={styles.results}>
        {needing.map((n) => (
          <li key={n.id}>
            <button type="button" className={styles.link} onClick={() => onOpen(n.id)}>
              {n.displayName}
            </button>{" "}
            <span className={styles.kind}>{NEED_REASON[n.reason]}</span>
          </li>
        ))}
      </ul>
      {needing.length === 0 && <p>None — every performer can be reached.</p>}
    </>
  );
}
