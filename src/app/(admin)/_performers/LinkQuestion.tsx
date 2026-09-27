"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import ArchiveControl from "@/app/(admin)/ArchiveControl";

type Suggestion = { id: string; displayName: string; similarity?: number };

type Props = {
  performerId: string;
  displayName: string;
  /** Feature 087 (FR-027, B58): the performer IS linked, but to a contact archived or merged away. */
  retired?: "archived" | "merged" | null;
  /** The retired contact's name, so the Booker can see which record the link points at. */
  contactName?: string | null;
  archived: boolean;
  /** Called once the performer has a contact — with that contact, so the form can offer its spelling. */
  onLinked: (contact: Suggestion) => void;
  /** Called when the performer is archived instead — there is nothing left to edit. */
  onArchived: () => void;
};

/**
 * Feature 084 US4 (FR-021 to FR-027): a performer with no contact, settled before anything else.
 *
 * Three ways out, and only three: link an existing contact, create one, or archive the performer. The
 * queue this drains has sat since feature 072 — 19 performers, 5 of them seed leftovers, most of the rest
 * guests booked once years ago, and two still active.
 *
 * The suggestions tolerate a misspelling, which is the whole point: the live case is the performer "Clara
 * Reidlinger" and the contact "Clara Riedlinger". Matching names for exact equality — what the old
 * auto-linker did — finds nothing there and pushes the Booker into creating a SECOND contact for her.
 */
export default function LinkQuestion({
  performerId,
  displayName,
  retired = null,
  contactName = null,
  archived,
  onLinked,
  onArchived,
}: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [nearMatches, setNearMatches] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Feature 087 walk-through: a search of the whole directory, for when the suggestions miss the person.
  const [findQ, setFindQ] = useState("");
  const [found, setFound] = useState<Suggestion[]>([]);

  useEffect(() => {
    const needle = findQ.trim();
    if (needle.length < 2) return setFound([]);
    let cancelled = false;
    void apiFetch(`/api/contacts?q=${encodeURIComponent(needle)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setFound(d.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [findQ]);

  useEffect(() => {
    void apiFetch(`/api/performers/${performerId}/link-suggestions`)
      .then((r) => r.json())
      .then((d) => setSuggestions(d.items ?? []));
  }, [performerId]);

  async function link(contact: Suggestion) {
    setError(null);
    setBusy(true);
    const res = await apiFetch(`/api/performers/${performerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: contact.id }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setError(data?.error?.message ?? "Could not link that contact.");
    }
    onLinked(contact);
  }

  /** FR-026: look before creating — a near match here is how a duplicate contact gets made. */
  async function askBeforeCreating() {
    setError(null);
    const res = await apiFetch(`/api/contacts?q=${encodeURIComponent(displayName)}`);
    const data = await res.json().catch(() => null);
    const items: Suggestion[] = data?.items ?? [];
    if (items.length > 0) return setNearMatches(items);
    await create();
  }

  async function create() {
    setBusy(true);
    const parts = displayName.trim().split(/\s+/);
    const res = await apiFetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: parts.length > 1 ? parts.slice(0, -1).join(" ") : (parts[0] ?? displayName),
        ...(parts.length > 1 ? { lastName: parts.at(-1) } : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setError(data?.error?.message ?? "Could not create that contact.");
    }
    const contact = await res.json();
    await link({ id: contact.id, displayName: contact.displayName ?? displayName });
  }

  return (
    <div>
      {retired ? (
        <p>
          <strong>{displayName}</strong> is linked to a contact that has been{" "}
          {retired === "merged" ? "merged into another" : "archived"}
          {contactName ? ` (${contactName})` : ""}, so it no longer reaches them. Point it at the
          right one before editing: link one, create one, or archive the performer.
        </p>
      ) : (
        <p>
          <strong>{displayName}</strong> has no contact. Settle that before editing: link one,
          create one, or archive the performer.
        </p>
      )}

      {suggestions.length > 0 && (
        <ul>
          {suggestions.map((c) => (
            <li key={c.id}>
              {c.displayName}{" "}
              <button type="button" disabled={busy} onClick={() => void link(c)}>
                Link {c.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* When the suggestions miss — a married name, a stage name — any contact can be found and linked. */}
      <div>
        <input
          type="search"
          aria-label="Find a contact"
          placeholder="Not listed? Find a contact…"
          value={findQ}
          onChange={(e) => setFindQ(e.target.value)}
        />
        {found.length > 0 && (
          <ul>
            {found.map((c) => (
              <li key={c.id}>
                {c.displayName}{" "}
                <button type="button" disabled={busy} onClick={() => void link(c)}>
                  Link {c.displayName}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {nearMatches ? (
        <div role="alert">
          <p>Did you mean one of these? Creating a second record for the same person makes work.</p>
          <ul>
            {nearMatches.map((c) => (
              <li key={c.id}>
                {c.displayName}{" "}
                <button type="button" disabled={busy} onClick={() => void link(c)}>
                  Link {c.displayName}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" disabled={busy} onClick={() => void create()}>
            No — create a new contact
          </button>
          <button type="button" onClick={() => setNearMatches(null)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={() => void askBeforeCreating()}>
          Create a contact
        </button>
      )}

      <ArchiveControl
        base={`/api/performers/${performerId}`}
        what={displayName}
        archived={archived}
        onChanged={onArchived}
      />

      {error && <p role="alert">{error}</p>}
    </div>
  );
}
