"use client";
import { useState } from "react";
import { apiFetch } from "@/app/apiFetch";

type Props = {
  /** Where the archive and restore routes live, e.g. "/api/venues/v1". */
  base: string;
  /** What is being retired, for the question: "Grange Hall still has…". */
  what: string;
  archived: boolean;
  onChanged: () => void;
};

/**
 * Feature 084 (FR-010, FR-012, FR-014): retire a record, or put it back.
 *
 * Archiving something with dates still to come is a QUESTION, not a refusal: the server answers 409 with
 * how many and when the next one is, and this asks before sending again with `confirm`. Nothing is
 * deleted either way, and the bookings already made are untouched.
 */
export default function ArchiveControl({ base, what, archived, onChanged }: Props) {
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(path: "archive" | "restore", confirm = false) {
    setError(null);
    setBusy(true);
    const res = await apiFetch(`${base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(confirm ? { confirm: true } : {}),
    });
    setBusy(false);
    if (res.ok) {
      setAsking(null);
      onChanged();
      return;
    }
    const data = await res.json().catch(() => null);
    if (res.status === 409) return setAsking(data?.error?.message ?? `${what} is still in use.`);
    setError(data?.error?.message ?? `The server refused it (${res.status}).`);
  }

  if (archived) {
    return (
      <div>
        <span>Archived.</span>{" "}
        <button type="button" disabled={busy} onClick={() => void send("restore")}>
          Restore
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      {asking ? (
        <div role="alert">
          <p>{asking}</p>
          <button type="button" disabled={busy} onClick={() => void send("archive", true)}>
            Archive anyway
          </button>
          <button type="button" onClick={() => setAsking(null)}>
            Keep it
          </button>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={() => void send("archive")}>
          Archive
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
