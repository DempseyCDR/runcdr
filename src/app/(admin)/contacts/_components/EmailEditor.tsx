"use client";
import { useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import styles from "../contacts.module.css";

// Feature 066: a contact's emails, editable below the scalar fields in the 063 record editor.
export type EmailRow = {
  id: string;
  email: string;
  purposes: string[];
  consentTopics: string[];
  status: "active" | "transition" | "inactive";
  isLogin: boolean;
  providerLastOpen: string | null;
  providerLastClick: string | null;
  providerSetDate: string | null;
};

// Feature 067: the collision payload now also carries the owner's emailId, so resolving it as a
// household share needs no second lookup.
type Collision = { contactId: string; displayName: string; emailId?: string };

const PURPOSES = ["personal", "booking", "public_profile", "other"] as const;
const TOPICS = [
  "contra",
  "english",
  "openband",
  "special_events",
  "jane_austen_ball",
  "contact_tracing",
  "do_not_contact",
] as const;

/** Compact, read-only delivery-telemetry hint (M-R16). */
function telemetryHint(e: EmailRow): string {
  if (e.providerLastOpen) return `opened ${monthsAgo(e.providerLastOpen)}`;
  if (e.providerLastClick) return `clicked ${monthsAgo(e.providerLastClick)}`;
  if (e.providerSetDate) return "no opens on record";
  return "no delivery data";
}
function monthsAgo(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days < 31) return `${days}d ago`;
  return `~${Math.round(days / 30)}mo ago`;
}

export default function EmailEditor({
  contactId,
  emails,
  canDeleteUnrestricted,
  onChanged,
}: {
  contactId: string;
  emails: EmailRow[];
  canDeleteUnrestricted: boolean;
  onChanged: () => void | Promise<void>;
}) {
  // Rows come from props on every render; state holds only the unsaved edits, keyed by row id. A write's
  // onChanged() re-fetches the record into this same instance (the parent's key is the record id), so a
  // copy seeded at mount would never see the added, deleted or retired row (feature 075).
  const [edits, setEdits] = useState<Record<string, Partial<EmailRow>>>({});
  const [collision, setCollision] = useState<Record<string, Collision | null>>({});
  const [loginConfirm, setLoginConfirm] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string | null>>({});
  const [addr, setAddr] = useState("");
  // Feature 067 (FR-005): the ADD path detects a collision server-side too; it used to be discarded.
  const [addCollision, setAddCollision] = useState<Collision | null>(null);

  const drafts = emails.map((e) => ({ ...e, ...edits[e.id] }));

  function patchDraft(id: string, patch: Partial<EmailRow>) {
    setEdits((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  }

  /** After a successful write: re-fetch, then let the server's values replace this row's draft. */
  async function settle(id?: string) {
    await onChanged();
    if (!id) return;
    setEdits((s) => {
      const next = { ...s };
      delete next[id];
      return next;
    });
    setCollision((s) => ({ ...s, [id]: null }));
  }

  // Consent topics: do-not-contact is exclusive (M-R15.1); never reach zero (M-R15.2).
  function toggleTopic(d: EmailRow, topic: string) {
    let next: string[];
    if (topic === "do_not_contact") {
      next = d.consentTopics.includes("do_not_contact") ? [] : ["do_not_contact"];
    } else {
      const base = d.consentTopics.filter((t) => t !== "do_not_contact");
      next = base.includes(topic) ? base.filter((t) => t !== topic) : [...base, topic];
    }
    if (next.length === 0) return; // prevent zero topics
    patchDraft(d.id, { consentTopics: next });
  }

  function togglePurpose(d: EmailRow, purpose: string) {
    const next = d.purposes.includes(purpose)
      ? d.purposes.filter((p) => p !== purpose)
      : [...d.purposes, purpose];
    if (next.length === 0) return; // prevent zero purposes (M-R15.2)
    patchDraft(d.id, { purposes: next });
  }

  async function saveRow(d: EmailRow, confirmedLogin = false) {
    const original = emails.find((e) => e.id === d.id);
    const addressChanged = !!original && original.email !== d.email;
    const deactivating = !!original && original.status !== "inactive" && d.status === "inactive";
    // A login email's address-change / deactivation needs an explicit confirmation (M-R15.4).
    if (d.isLogin && (addressChanged || deactivating) && !confirmedLogin) {
      setLoginConfirm((s) => ({ ...s, [d.id]: true }));
      return;
    }
    setRowError((s) => ({ ...s, [d.id]: null }));
    setCollision((s) => ({ ...s, [d.id]: null }));
    setLoginConfirm((s) => ({ ...s, [d.id]: false }));
    const res = await apiFetch(`/api/contacts/${contactId}/emails/${d.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: d.email,
        purposes: d.purposes,
        consentTopics: d.consentTopics,
        status: d.status,
      }),
    });
    if (res.ok) return settle(d.id);
    const body = await res.json().catch(() => null);
    if (body?.error?.code === "EMAIL_ACTIVE_ELSEWHERE") {
      const detail = body.error.other ?? null; // { contactId, displayName }
      setCollision((s) => ({ ...s, [d.id]: detail }));
      return;
    }
    setRowError((s) => ({ ...s, [d.id]: body?.error?.message ?? "Could not save email." }));
  }

  async function deleteRow(id: string) {
    const res = await apiFetch(`/api/contacts/${contactId}/emails/${id}`, { method: "DELETE" });
    if (res.ok) await settle(id);
  }

  /**
   * Feature 067 (M-R26): the third resolution — these are different people sharing one household
   * address. The editing contact rides the owner's email; `retireEmailId` retires the row being edited,
   * which is the address being replaced (FR-017).
   */
  async function linkAsShared(other: Collision, retireEmailId?: string) {
    if (!other.emailId) return;
    const res = await apiFetch(`/api/contacts/${contactId}/message-recipient`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailId: other.emailId, ...(retireEmailId ? { retireEmailId } : {}) }),
    });
    if (!res.ok) return;
    if (!retireEmailId) setAddCollision(null);
    await settle(retireEmailId);
  }

  // Collision → review as duplicate: merge in the direction Mel chooses (M-R15.3 / F2).
  async function reviewMerge(canonicalId: string, mergedId: string, rowId?: string) {
    const res = await apiFetch("/api/dedup/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canonicalId, mergedId }),
    });
    if (!res.ok) return;
    if (!rowId) setAddCollision(null);
    await settle(rowId);
  }

  async function addEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!addr.trim()) return;
    const res = await apiFetch(`/api/contacts/${contactId}/emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: addr.trim() }),
    });
    if (res.ok) {
      setAddr("");
      setAddCollision(null);
      return settle();
    }
    const body = await res.json().catch(() => null);
    if (body?.error?.code === "EMAIL_ACTIVE_ELSEWHERE") {
      setAddCollision(body.error.other ?? null);
    }
  }

  return (
    <section className={styles.emailSection} aria-label="Emails">
      <h3 className={styles.emailHeading}>Emails</h3>
      <ul className={styles.emailList}>
        {drafts.map((d) => (
          <li key={d.id} className={styles.emailRow} aria-label={`Email ${d.email}`}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Address</span>
              <input
                className={styles.input}
                value={d.email}
                onChange={(e) => patchDraft(d.id, { email: e.target.value })}
              />
            </label>
            {d.isLogin && <span className={styles.loginBadge}>Used for staff sign-in</span>}

            <fieldset className={styles.fieldset}>
              <legend>Purposes</legend>
              {PURPOSES.map((p) => (
                <label key={p} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={d.purposes.includes(p)}
                    onChange={() => togglePurpose(d, p)}
                  />{" "}
                  {p}
                </label>
              ))}
            </fieldset>

            <fieldset className={styles.fieldset}>
              <legend>Consent topics</legend>
              {TOPICS.map((t) => {
                const dnc = d.consentTopics.includes("do_not_contact");
                const greyed = dnc && t !== "do_not_contact";
                return (
                  <label key={t} className={greyed ? styles.checkGreyed : styles.check}>
                    <input
                      type="checkbox"
                      checked={d.consentTopics.includes(t)}
                      disabled={greyed}
                      onChange={() => toggleTopic(d, t)}
                    />{" "}
                    {t}
                  </label>
                );
              })}
            </fieldset>

            {/* Status: Active/Inactive toggle; transition is system-managed → read-only (M-R14). */}
            {d.status === "transition" ? (
              <p className={styles.rowMeta}>Status: transition (system-managed)</p>
            ) : (
              <label className={styles.check}>
                <input
                  type="checkbox"
                  aria-label={`Active ${d.email}`}
                  checked={d.status === "active"}
                  onChange={(e) =>
                    patchDraft(d.id, { status: e.target.checked ? "active" : "inactive" })
                  }
                />{" "}
                Active
              </label>
            )}

            <p className={styles.telemetry}>{telemetryHint(d)}</p>

            <div className={styles.emailActions}>
              {loginConfirm[d.id] ? (
                <button type="button" className={styles.button} onClick={() => saveRow(d, true)}>
                  This is a staff sign-in email — proceed?
                </button>
              ) : (
                <button type="button" className={styles.button} onClick={() => saveRow(d)}>
                  Save email
                </button>
              )}
              {canDeleteUnrestricted && (
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => deleteRow(d.id)}
                >
                  Delete email
                </button>
              )}
            </div>

            {rowError[d.id] && <p className={styles.error}>{rowError[d.id]}</p>}
            {collision[d.id] && (
              <div className={styles.error}>
                <p>Already active on {collision[d.id]!.displayName} — review as duplicate.</p>
                <span className={styles.dupActions}>
                  <button
                    type="button"
                    className={styles.dupButton}
                    onClick={() => reviewMerge(contactId, collision[d.id]!.contactId, d.id)}
                  >
                    Keep this contact
                  </button>
                  <button
                    type="button"
                    className={styles.dupButton}
                    onClick={() => reviewMerge(collision[d.id]!.contactId, contactId, d.id)}
                  >
                    Keep {collision[d.id]!.displayName}
                  </button>
                  {collision[d.id]!.emailId && (
                    <button
                      type="button"
                      className={styles.dupButton}
                      onClick={() => linkAsShared(collision[d.id]!, d.id)}
                    >
                      Different people — link as shared
                    </button>
                  )}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      {addCollision && (
        <div className={styles.error}>
          <p>Already active on {addCollision.displayName} — same person, or one household email?</p>
          <span className={styles.dupActions}>
            <button
              type="button"
              className={styles.dupButton}
              onClick={() => reviewMerge(contactId, addCollision.contactId)}
            >
              Keep this contact
            </button>
            <button
              type="button"
              className={styles.dupButton}
              onClick={() => reviewMerge(addCollision.contactId, contactId)}
            >
              Keep {addCollision.displayName}
            </button>
            {addCollision.emailId && (
              <button
                type="button"
                className={styles.dupButton}
                onClick={() => linkAsShared(addCollision)}
              >
                Different people — link as shared
              </button>
            )}
          </span>
        </div>
      )}

      <form onSubmit={addEmail} className={styles.emailAdd}>
        <input
          className={styles.input}
          placeholder="Add email address"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
        />
        <button type="submit" className={styles.button}>
          Add email
        </button>
      </form>
    </section>
  );
}
