import type { MergeSuggestionContact } from "@/server/domain/dedup/suggestionService";
import styles from "../contacts.module.css";

/**
 * Feature 076: how a contact in a proposed duplicate pair is named — shared by the queue row and the
 * comparison modal, so the two cannot drift apart.
 *
 * The display name is the header. When it is CUSTOM, first + last is shown beneath it: pairing runs on
 * first + last, and a custom display name ("Peggy CDR") can hide the very name the pair was proposed on
 * ("Peggy Dempsey"). When it is automatic it already IS first + last, so nothing is repeated — and there
 * is no "(custom)" marker, because the second line appearing is the signal.
 *
 * `children` sits after the display name on the header line, for per-surface suffixes like " · signs in".
 */
export default function PairContactName({
  c,
  children,
}: {
  c: Pick<MergeSuggestionContact, "displayName" | "firstName" | "lastName" | "displayNameOverride">;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div className={styles.dupName}>
        {c.displayName}
        {children}
      </div>
      {c.displayNameOverride ? (
        <div className={styles.dupStructuredName}>
          {[c.firstName, c.lastName].filter(Boolean).join(" ")}
        </div>
      ) : null}
    </>
  );
}
