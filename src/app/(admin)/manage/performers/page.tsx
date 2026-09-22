"use client";
import { apiFetch } from "@/app/apiFetch";
import PerformerForm, { type Performer } from "./PerformerForm";

import { useEffect, useRef, useState } from "react";

/**
 * Performers (feature 084, US1 and US2).
 *
 * **Searched, not listed** (FR-005): a roster of several hundred is not something to scroll, so the page
 * opens on a focused search box and fetches nothing until something is typed — the shape the contact
 * directory has used since feature 062. The endpoint still browses the whole roster for the booking flows
 * that read it that way (analysis F1); it is this page that stops asking for one.
 *
 * **One form** creates and edits (FR-001, FR-002). The page this replaced collected a name, a biography,
 * an email and a telephone on creation and then let you change only the public-roster flags.
 */
export default function PerformersPage() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Performer[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ performer?: Performer; name?: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => searchRef.current?.focus(), []);

  // FR-005: nothing is fetched until the Booker types. Clearing the box empties the results with it.
  useEffect(() => {
    const needle = q.trim();
    if (!needle) {
      setItems([]);
      setTruncated(false);
      setSearched(false);
      return;
    }
    const timer = setTimeout(() => {
      void apiFetch(
        `/api/performers?q=${encodeURIComponent(needle)}${showArchived ? "&archived=1" : ""}`,
      )
        .then((r) => r.json())
        .then((d) => {
          setItems(d.items ?? []);
          setTruncated(!!d.truncated);
          setSearched(true);
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [q, showArchived]);

  /**
   * Open the form on the WHOLE record, never the search row.
   *
   * The search answers with summaries — id and display name — so a row carries no `contactId` and no
   * `archivedAt`. Opening the form on one made every performer look unlinked and archived (found in the
   * browser walk, T047).
   */
  async function open(id: string) {
    const res = await apiFetch(`/api/performers/${id}`);
    if (!res.ok) return setMessage("Could not open that performer.");
    setEditing({ performer: (await res.json()) as Performer });
  }

  function refresh() {
    setEditing(null);
    setQ((typed) => typed); // leave the search as it was
  }

  return (
    <main style={{ padding: 24, maxWidth: 640 }}>
      <h1>Performers</h1>

      <label>
        Search performers
        <input
          ref={searchRef}
          value={q}
          placeholder="Type part of a name"
          onChange={(e) => setQ(e.target.value)}
        />
      </label>

      {/* FR-012: how a performer retired by mistake is found again and restored. */}
      <label>
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        Include archived
      </label>

      {truncated && <p>More matched — narrow the search.</p>}

      <ul>
        {items.map((p) => (
          <li key={p.id} style={{ marginBottom: 6 }}>
            <strong>{p.displayName}</strong>
            {p.isCaller ? " · calls" : ""}
            {p.isPublic ? " · public" : ""}
            {p.archivedAt ? " · archived" : ""}{" "}
            <button type="button" onClick={() => void open(p.id)}>
              Edit
            </button>
          </li>
        ))}
      </ul>

      {/* FR-008: nothing found — offer to create that person, carrying what was typed. */}
      {searched && items.length === 0 && (
        <p>
          No performer matches “{q.trim()}”.{" "}
          <button type="button" onClick={() => setEditing({ name: q.trim() })}>
            Add {q.trim()}
          </button>
        </p>
      )}

      <button type="button" onClick={() => setEditing({})}>
        Add a performer
      </button>

      {editing && (
        <section aria-label={editing.performer ? "Edit performer" : "Add a performer"}>
          <h2>{editing.performer ? editing.performer.displayName : "Add a performer"}</h2>
          <PerformerForm
            performer={editing.performer}
            initialName={editing.name}
            onSaved={() => {
              setMessage(editing.performer ? "Performer saved." : "Performer created.");
              refresh();
            }}
            onClose={() => setEditing(null)}
          />
        </section>
      )}

      {message && <p role="status">{message}</p>}
    </main>
  );
}
