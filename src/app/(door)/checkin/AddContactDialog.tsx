"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import ContactName, { type ContactNames } from "@/app/_components/ContactName";
import styles from "./checkin.module.css";

/** A search result, as the page's results use it (contract §1). */
export type Suggestion = ContactNames & { id: string; checkedIn?: boolean };

/** How a check-in attempt came out, so the dialog can ask its next question. */
export type CheckInResult =
  | { ok: true }
  | {
      ok: false;
      code?: string;
      message: string;
      other?: { contactId: string; displayName: string; emailId?: string };
    };

type Owner = { contactId: string; displayName: string };

/**
 * Feature 079, User Story 2 (FR-013–FR-017): add a walk-in without making a duplicate or losing their email.
 *
 * As Meg types, existing contacts that match are offered first — the best dedup is the one never created.
 * If the email she enters already belongs to someone, nothing is created until she says which it is: that
 * person, a different person sharing the address, or a mistake. The extras row on the page applies to
 * whichever check-in this dialog makes; it is summarised here because the row is hidden behind the dialog.
 */
export default function AddContactDialog({
  eventId,
  extrasSummary,
  onCheckIn,
  onClose,
}: {
  eventId: string;
  /** e.g. "2 children · comp"; empty when the extras row is clear. */
  extrasSummary: string;
  /** Records a check-in with the extras row applied; the page resets and closes on success. */
  onCheckIn: (body: Record<string, unknown>, label: string) => Promise<CheckInResult>;
  onClose: () => void;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [display, setDisplay] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [ownerIn, setOwnerIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => firstRef.current?.focus(), []);

  // FR-014: "did you mean…?" — the email once it looks like one, otherwise the name as typed so far.
  const query = email.includes("@") ? email.trim() : `${first} ${last}`.trim();
  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, ...(eventId ? { eventId } : {}) });
      void apiFetch(`/api/attendance/search?${params}`)
        .then((r) => r.json())
        .then((d) => setSuggestions((d.items ?? []).slice(0, 5)));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, eventId]);

  function newContactBody(shareEmail: boolean) {
    return {
      newContact: {
        firstName: first.trim(),
        ...(last.trim() ? { lastName: last.trim() } : {}),
        ...(display.trim() ? { displayNameOverride: display.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(shareEmail ? { shareEmail: true } : {}),
      },
    };
  }

  async function attempt(body: Record<string, unknown>, label: string): Promise<CheckInResult> {
    setBusy(true);
    setError(null);
    try {
      return await onCheckIn(body, label);
    } finally {
      setBusy(false);
    }
  }

  async function addNew(shareEmail: boolean) {
    const label = `${first} ${last}`.trim();
    const result = await attempt(newContactBody(shareEmail), label);
    if (result.ok) return;
    if (result.code === "EMAIL_ACTIVE_ELSEWHERE" && result.other) {
      setOwner({ contactId: result.other.contactId, displayName: result.other.displayName });
      return;
    }
    setError(result.message);
  }

  async function checkInExisting(contactId: string, displayName: string) {
    const result = await attempt({ contactId }, displayName);
    if (result.ok) return;
    if (result.code === "ALREADY_CHECKED_IN") {
      if (owner?.contactId === contactId) setOwnerIn(true);
      else setError(`${displayName} is already checked in.`);
      return;
    }
    setError(result.message);
  }

  return (
    <div className={styles.backdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add contact"
        className={styles.panel}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <h2 className={styles.dialogHeading}>Add contact</h2>
        {extrasSummary && <p className={styles.hint}>With: {extrasSummary}</p>}

        <div className={styles.form}>
          <label>
            First name
            <input ref={firstRef} value={first} onChange={(e) => setFirst(e.target.value)} />
          </label>
          <label>
            Last name
            <input value={last} onChange={(e) => setLast(e.target.value)} />
          </label>
          <label>
            Display name (optional)
            <input
              value={display}
              placeholder={`${first} ${last}`.trim() || "First Last"}
              onChange={(e) => setDisplay(e.target.value)}
            />
          </label>
          <label>
            Email
            <input
              ref={emailRef}
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setOwner(null);
              }}
            />
          </label>
          <label>
            Phone
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>

        {suggestions.length > 0 && !owner && (
          <p className={styles.suggestHeading}>Already here? Check them in instead:</p>
        )}
        {suggestions.length > 0 && !owner && (
          <ul aria-label="Did you mean…" className={styles.results}>
            {suggestions.map((s) => (
              <li key={s.id} className={styles.result}>
                <div className={styles.resultName}>
                  <ContactName c={s} />
                </div>
                <div className={styles.resultAction}>
                  {s.checkedIn ? (
                    <span className={styles.checkmark} role="img" aria-label="Already checked in">
                      ✓
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={styles.button}
                      disabled={busy}
                      onClick={() => void checkInExisting(s.id, s.displayName)}
                    >
                      Check in
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {owner && !ownerIn && (
          <div className={styles.question}>
            <p>
              {email.trim()} already belongs to {owner.displayName}. Is this the same person?
            </p>
            <div className={styles.choices}>
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                onClick={() => void checkInExisting(owner.contactId, owner.displayName)}
              >
                {`It's ${owner.displayName}`}
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={busy}
                onClick={() => void addNew(true)}
              >
                Different person sharing it
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => {
                  setOwner(null);
                  emailRef.current?.focus();
                }}
              >
                Fix the email
              </button>
            </div>
          </div>
        )}

        {owner && ownerIn && (
          <div className={styles.question}>
            <p>{owner.displayName} is already checked in.</p>
            <button type="button" className={styles.button} onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}

        <div className={styles.choices}>
          {!owner && (
            <button
              type="button"
              className={styles.primaryButton}
              disabled={busy || !first.trim()}
              onClick={() => void addNew(false)}
            >
              Add and check in
            </button>
          )}
          <button type="button" className={styles.button} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
