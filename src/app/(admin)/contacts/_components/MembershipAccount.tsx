"use client";
import { useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import styles from "../contacts.module.css";

// Feature 068 (FR-018/FR-019): the MEMBERSHIP household on a contact record — who paid, and who the
// payment covers. Deliberately distinct from the shared-email household (FR-020): they overlap often and
// are not the same set, so the two blocks are labelled and styled apart.
export type MembershipBlock = {
  status: "never" | "current" | "lapsed" | "long_lapsed";
  expiryDate: string | null;
  /** Present when this contact OWNS an account. The level is the payer's attribute (FR-013). */
  asPayer: {
    level: string;
    members: { contactId: string; displayName: string }[];
  } | null;
  /** Present when someone else's account covers this contact. */
  asMember: { payerContactId: string; payerDisplayName: string } | null;
};

const LEVELS = ["individual", "family", "supporter", "student"] as const;

const STATUS_LABEL: Record<MembershipBlock["status"], string> = {
  never: "not a member",
  current: "current",
  lapsed: "lapsed",
  long_lapsed: "long lapsed",
};

export default function MembershipAccount({
  contactId,
  membership,
  canWrite,
  onChanged,
}: {
  contactId: string;
  membership: MembershipBlock;
  /** FR-017: membership writes stay with the FS/Treasurer. Mel sees the household but cannot change it. */
  canWrite: boolean;
  onChanged: () => void | Promise<void>;
}) {
  // Only a CHANGED level is held; otherwise show the account's own. Seeding at mount went stale when a
  // re-fetch (onChanged) made this contact a payer, and Save would then write the default (feature 075).
  const [levelEdit, setLevelEdit] = useState<string | null>(null);
  const level = levelEdit ?? membership.asPayer?.level ?? "individual";
  const [error, setError] = useState<string | null>(null);
  // Adding a member is a SEARCH, not an id box. A contact id is an internal key; asking a human for one
  // makes the control unusable in practice — which is how a family account could end up with no workable
  // way to add a family member.
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ id: string; displayName: string }[]>([]);

  if (!membership.asPayer && !membership.asMember) return null;

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) return setHits([]);
    const res = await apiFetch(`/api/contacts?q=${encodeURIComponent(q.trim())}`);
    if (!res.ok) return setHits([]);
    const data = await res.json();
    setHits((data.items ?? []).filter((c: { id: string }) => c.id !== contactId).slice(0, 8));
  }

  async function addMember(id: string) {
    setQuery("");
    setHits([]);
    await send("/membership/members", "POST", { contactId: id });
  }

  async function send(path: string, method: string, body?: unknown) {
    setError(null);
    const res = await apiFetch(`/api/contacts/${contactId}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.ok) {
      await onChanged();
      return setLevelEdit(null);
    }
    const parsed = await res.json().catch(() => null);
    // A capacity refusal names who would be displaced — show it verbatim (FR-003a).
    setError(parsed?.error?.message ?? "Could not update the membership.");
  }

  return (
    <section className={styles.membershipSection} aria-label="Membership account">
      <h3 className={styles.emailHeading}>Membership</h3>

      <p className={styles.rowMeta}>
        {STATUS_LABEL[membership.status]}
        {membership.expiryDate ? ` — through ${membership.expiryDate}` : ""}
      </p>

      {membership.asMember && (
        <p className={styles.rowMeta}>
          Covered by <strong>{membership.asMember.payerDisplayName}</strong>&apos;s membership.
        </p>
      )}

      {membership.asPayer && (
        <>
          <p className={styles.rowMeta}>
            Pays for a <strong>{membership.asPayer.level}</strong> membership.
          </p>

          {membership.asPayer.members.length > 0 ? (
            <>
              <p className={styles.rowMeta}>Also covered:</p>
              <ul className={styles.sharedNames}>
                {membership.asPayer.members.map((m) => (
                  <li key={m.contactId}>
                    {m.displayName}
                    {canWrite && (
                      <>
                        {" "}
                        <button
                          type="button"
                          className={styles.dupButton}
                          onClick={() =>
                            send("/membership/members", "DELETE", { contactId: m.contactId })
                          }
                        >
                          Remove {m.displayName}
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.rowMeta}>Covers this contact only.</p>
          )}

          {canWrite && (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Level</span>
                <select
                  className={styles.input}
                  value={level}
                  onChange={(e) => setLevelEdit(e.target.value)}
                >
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={styles.button}
                onClick={() => send("/membership", "PATCH", { level })}
              >
                Save level
              </button>

              {/* Labelled explicitly: the email editor on this same record also has an "Add …" control,
                  and the two must not be confusable. Searches name, dedup key and email — so a household
                  member with a different surname is found by their OWN name (or address). */}
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Add a member to this membership</span>
                <input
                  className={styles.input}
                  placeholder="Search by name or email…"
                  value={query}
                  onChange={(e) => void search(e.target.value)}
                />
              </label>
              {hits.length > 0 && (
                <ul className={styles.sharedNames}>
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        className={styles.dupButton}
                        onClick={() => void addMember(h.id)}
                      >
                        Add {h.displayName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
