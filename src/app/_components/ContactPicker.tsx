"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import styles from "./SaleOrCheckDialog.module.css";

export type Person = { id: string; displayName: string };

/**
 * Feature 082 (FR-015, FR-024): find a person among the contacts, or add them when they are not one yet.
 *
 * Existing contacts are offered first, as Mary or Meg types — the best duplicate is the one never created.
 * Only then is "Add … as a new contact" offered, taking a first and a last name; anything more is added to
 * the contact record later.
 */
export default function ContactPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Person | null;
  onChange: (person: Person | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  const [adding, setAdding] = useState<{ first: string; last: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setFound([]);
    let stale = false;
    void apiFetch(`/api/attendance/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!stale) setFound((d.items ?? []) as Person[]);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [query]);

  if (value) {
    return (
      <div className={styles.chosen}>
        <span>
          {label}: <strong>{value.displayName}</strong>
        </span>
        <button type="button" className={styles.linkButton} onClick={() => onChange(null)}>
          Change {label.toLowerCase()}
        </button>
      </div>
    );
  }

  async function add() {
    if (!adding?.first.trim()) return setError("A first name, at least.");
    setError(null);
    const body = {
      firstName: adding.first.trim(),
      ...(adding.last.trim() ? { lastName: adding.last.trim() } : {}),
    };
    try {
      const res = await apiFetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return setError(data?.error?.message ?? "The contact could not be added.");
      setAdding(null);
      setQuery("");
      onChange({ id: data.id, displayName: data.displayName });
    } catch {
      setError("Could not reach the server.");
    }
  }

  if (adding) {
    return (
      <div className={styles.fields}>
        <label>
          First name
          <input
            className={styles.input}
            value={adding.first}
            onChange={(e) => setAdding({ ...adding, first: e.target.value })}
          />
        </label>
        <label>
          Last name
          <input
            className={styles.input}
            value={adding.last}
            onChange={(e) => setAdding({ ...adding, last: e.target.value })}
          />
        </label>
        <div className={`${styles.buttons} ${styles.wide}`}>
          <button type="button" className={styles.primaryButton} onClick={() => void add()}>
            Add contact
          </button>
          <button type="button" className={styles.button} onClick={() => setAdding(null)}>
            Back
          </button>
        </div>
        {error && (
          <p role="alert" className={`${styles.error} ${styles.wide}`}>
            {error}
          </p>
        )}
      </div>
    );
  }

  const typed = query.trim();
  const [first, ...rest] = typed.split(/\s+/);
  return (
    <div className={styles.picker}>
      <label className={styles.field}>
        {label}
        <input
          className={styles.input}
          value={query}
          placeholder="Type a name"
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {found.length > 0 && (
        <ul className={styles.picks}>
          {found.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={styles.pick}
                onClick={() => {
                  setQuery("");
                  onChange(p);
                }}
              >
                {p.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
      {typed.length >= 2 && (
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => setAdding({ first: first ?? "", last: rest.join(" ") })}
        >
          Add {typed} as a new contact
        </button>
      )}
    </div>
  );
}
