import styles from "./ContactName.module.css";

/** The names a contact is shown by — structural, so any surface's projection can pass its own row. */
export type ContactNames = {
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  displayNameOverride: string | null;
};

/**
 * Feature 076: how a contact is named — first written for a proposed duplicate pair (the queue row and the
 * comparison modal); feature 079 moved it here so the door's search results, suggestions and checked-in
 * list follow the same rule, rather than a copy that could drift.
 *
 * The display name is the header. When it is CUSTOM, first + last is shown beneath it: pairing runs on
 * first + last, and a custom display name ("Peggy CDR") can hide the very name the pair was proposed on
 * ("Peggy Dempsey"). When it is automatic it already IS first + last, so nothing is repeated — and there
 * is no "(custom)" marker, because the second line appearing is the signal.
 *
 * `children` sits after the display name on the header line, for per-surface suffixes like " · signs in".
 */
export default function ContactName({
  c,
  children,
}: {
  c: ContactNames;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div className={styles.name}>
        {c.displayName}
        {children}
      </div>
      {c.displayNameOverride ? (
        <div className={styles.structuredName}>
          {[c.firstName, c.lastName].filter(Boolean).join(" ")}
        </div>
      ) : null}
    </>
  );
}
