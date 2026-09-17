"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import { ROLE_LABEL, send } from "./savePayment";
import styles from "./payments.module.css";

export type PickedPerformer = { id: string; displayName: string };
type Found = PickedPerformer & { bookedAs?: string | null };
type Contact = { id: string; displayName: string };

/**
 * Feature 081 (FR-024, FR-026, X-P1): find a performer for the Add and Substitute dialogs. Someone already
 * booked on the evening is shown but cannot be chosen. Someone not yet a performer can be created here — from a
 * contact who already exists, or as a new person, whose contact the server creates first.
 */
export default function PerformerPicker({
  eventId,
  onPicked,
  forPaying = false,
}: {
  eventId: string;
  onPicked: (p: PickedPerformer) => void;
  /**
   * Finding someone to pay rather than to book: being booked tonight does not stop paying an older booking,
   * and there is no creating a performer who has nothing to be paid for.
   */
  forPaying?: boolean;
}) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [creating, setCreating] = useState<null | "contact" | "new">(null);
  const [contactQ, setContactQ] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [person, setPerson] = useState({ firstName: "", lastName: "", email: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!q.trim()) return setFound([]);
    const url = `/api/performers?q=${encodeURIComponent(q.trim())}${forPaying ? "" : `&eventId=${eventId}`}`;
    void apiFetch(url)
      .then((r) => r.json())
      .then((d) => setFound(d.items ?? []));
  }, [q, eventId, forPaying]);

  useEffect(() => {
    if (!contactQ.trim()) return setContacts([]);
    void apiFetch(`/api/attendance/search?q=${encodeURIComponent(contactQ.trim())}`)
      .then((r) => r.json())
      .then((d) => setContacts(d.items ?? []));
  }, [contactQ]);

  async function create(body: Record<string, string>) {
    setError(null);
    const sent = await send<PickedPerformer>("/api/performers", "POST", body);
    if (!sent.ok) return setError(sent.message);
    onPicked({ id: sent.data.id, displayName: sent.data.displayName });
  }

  if (creating === null) {
    return (
      <div className={styles.entry}>
        <label className={styles.wide}>
          Find a performer
          <input
            className={styles.input}
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <ul className={`${styles.picks} ${styles.wide}`}>
          {found.map((p) => (
            <li key={p.id} aria-label={p.displayName} className={styles.pick}>
              {p.bookedAs && !forPaying ? (
                <span className={styles.quiet}>
                  {`${p.displayName} — already booked as ${ROLE_LABEL[p.bookedAs] ?? p.bookedAs}`}
                </span>
              ) : (
                <button type="button" className={styles.button} onClick={() => onPicked(p)}>
                  {p.displayName}
                </button>
              )}
            </li>
          ))}
        </ul>
        {q.trim() && !forPaying && (
          <button
            type="button"
            className={`${styles.button} ${styles.wide}`}
            onClick={() => {
              setCreating("contact");
              setContactQ(q.trim());
            }}
          >
            Not listed? Create a performer
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.entry}>
      {creating === "contact" ? (
        <>
          <label className={styles.wide}>
            Find a contact
            <input
              className={styles.input}
              autoComplete="off"
              value={contactQ}
              onChange={(e) => setContactQ(e.target.value)}
            />
          </label>
          <ul className={`${styles.picks} ${styles.wide}`}>
            {contacts.map((c) => (
              <li key={c.id} className={styles.pick}>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => void create({ contactId: c.id })}
                >
                  {`Use ${c.displayName}`}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={`${styles.button} ${styles.wide}`}
            onClick={() => setCreating("new")}
          >
            A new person
          </button>
        </>
      ) : (
        <>
          {(["firstName", "lastName", "email"] as const).map((field) => (
            <label key={field} className={styles.wide}>
              {{ firstName: "First name", lastName: "Last name", email: "Email" }[field]}
              <input
                className={styles.input}
                type={field === "email" ? "email" : "text"}
                autoComplete="off"
                value={person[field]}
                onChange={(e) => setPerson((p) => ({ ...p, [field]: e.target.value }))}
              />
            </label>
          ))}
          <button
            type="button"
            className={`${styles.primaryButton} ${styles.wide}`}
            disabled={!person.firstName.trim()}
            onClick={() =>
              void create(
                Object.fromEntries(
                  Object.entries(person)
                    .map(([k, v]) => [k, v.trim()])
                    .filter(([, v]) => v),
                ),
              )
            }
          >
            Create performer
          </button>
        </>
      )}
      <button
        type="button"
        className={`${styles.button} ${styles.wide}`}
        onClick={() => setCreating(null)}
      >
        Back to performers
      </button>
      {error && (
        <p role="alert" className={`${styles.error} ${styles.wide}`}>
          {error}
        </p>
      )}
    </div>
  );
}
