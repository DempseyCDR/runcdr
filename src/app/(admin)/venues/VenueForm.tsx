"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import ArchiveControl from "@/app/(admin)/ArchiveControl";
import VenueRents from "./VenueRents";

/** A venue as the page holds it. */
export type Venue = {
  id: string;
  name: string;
  shortName: string | null;
  address: string;
  directions: string | null;
  isPublic: boolean;
  latitude: number | null;
  longitude: number | null;
  landlordContactId: string | null;
  landlordName?: string | null;
  archivedAt: string | null;
};

type Props = {
  /** Absent when creating. */
  venue?: Venue;
  /** The viewer may read but not change it (no `venue.write`). */
  readOnly?: boolean;
  onSaved: () => void;
  onClose: () => void;
};

/** The fields this form owns, as they are typed. */
type Contact = { id: string; displayName: string };

type Draft = {
  landlordContactId: string | null;
  name: string;
  shortName: string;
  address: string;
  directions: string;
  isPublic: boolean;
  latitude: string;
  longitude: string;
};

const draftOf = (v?: Venue): Draft => ({
  landlordContactId: v?.landlordContactId ?? null,
  name: v?.name ?? "",
  shortName: v?.shortName ?? "",
  address: v?.address ?? "",
  directions: v?.directions ?? "",
  isPublic: v?.isPublic ?? false,
  latitude: v?.latitude === null || v?.latitude === undefined ? "" : String(v.latitude),
  longitude: v?.longitude === null || v?.longitude === undefined ? "" : String(v.longitude),
});

/** A typed coordinate, or null when the box is empty. Anything unparseable is left out of the save. */
const coord = (typed: string): number | null => (typed.trim() === "" ? null : Number(typed));

/**
 * Feature 084 US1 (FR-001 to FR-003, FR-028): the venue form, used to CREATE and to EDIT.
 *
 * One form for both is the point: the page it replaced collected a name, an address and a short name on
 * creation and then offered no way to change any of them, which is how a field becomes write-once. A save
 * carries only the fields that were touched, so two people editing different fields do not overwrite each
 * other (clarification Q1).
 */
export default function VenueForm({ venue, readOnly = false, onSaved, onClose }: Props) {
  const initial = draftOf(venue);
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Feature 018 (B22): the landlord is a contact — the party the Booker negotiates rent with.
  const [landlordName, setLandlordName] = useState(venue?.landlordName ?? null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Contact[]>([]);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    void apiFetch(`/api/contacts?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((d) => setResults(d.items ?? []));
  }, [q]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  /** What actually changed — the body of a PATCH, or everything filled in for a POST. */
  function body(): Record<string, unknown> {
    const all: Record<string, unknown> = {
      landlordContactId: draft.landlordContactId,
      name: draft.name.trim(),
      shortName: draft.shortName.trim(),
      address: draft.address.trim(),
      directions: draft.directions.trim() || null,
      isPublic: draft.isPublic,
      latitude: coord(draft.latitude),
      longitude: coord(draft.longitude),
    };
    if (!venue) {
      // Creating: send what was filled in, leaving empty optional fields out entirely.
      return Object.fromEntries(
        Object.entries(all).filter(([, v]) => v !== "" && v !== null && v !== false),
      );
    }
    const before = draftOf(venue);
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(all) as (keyof Draft)[]) {
      if (draft[key] !== before[key]) changed[key] = all[key];
    }
    return changed;
  }

  async function save() {
    setError(null);
    if (!draft.name.trim()) return setError("A venue needs a name.");
    if (!draft.address.trim()) return setError("A venue needs an address.");
    const changed = body();
    if (venue && Object.keys(changed).length === 0) return onClose();

    setSaving(true);
    const res = await apiFetch(venue ? `/api/venues/${venue.id}` : "/api/venues", {
      method: venue ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changed),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setError(data?.error?.message ?? `The server refused it (${res.status}).`);
    }
    onSaved();
  }

  return (
    <div>
      <label>
        Name
        <input
          value={draft.name}
          disabled={readOnly}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label>
        Short name
        <input
          value={draft.shortName}
          disabled={readOnly}
          placeholder="Defaults to the name's initials"
          onChange={(e) => set({ shortName: e.target.value })}
        />
      </label>
      <label>
        Address
        <input
          value={draft.address}
          disabled={readOnly}
          onChange={(e) => set({ address: e.target.value })}
        />
      </label>
      <label>
        Directions
        <textarea
          rows={2}
          value={draft.directions}
          disabled={readOnly}
          placeholder="Public directions / transit / parking"
          onChange={(e) => set({ directions: e.target.value })}
        />
      </label>
      <label>
        Latitude
        <input
          inputMode="decimal"
          value={draft.latitude}
          disabled={readOnly}
          onChange={(e) => set({ latitude: e.target.value })}
        />
      </label>
      <label>
        Longitude
        <input
          inputMode="decimal"
          value={draft.longitude}
          disabled={readOnly}
          onChange={(e) => set({ longitude: e.target.value })}
        />
      </label>
      <div>
        <span>
          Landlord: <strong>{landlordName ?? (draft.landlordContactId ? "set" : "none")}</strong>
        </span>
        {!readOnly && (
          <>
            <input
              aria-label="Search a contact"
              placeholder="Search a contact…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <ul>
              {results.map((c) => (
                <li key={c.id}>
                  {c.displayName}{" "}
                  <button
                    type="button"
                    onClick={() => {
                      set({ landlordContactId: c.id });
                      setLandlordName(c.displayName);
                      setQ("");
                      setResults([]);
                    }}
                  >
                    Set as landlord
                  </button>
                </li>
              ))}
            </ul>
            {draft.landlordContactId && (
              <button
                type="button"
                onClick={() => {
                  set({ landlordContactId: null });
                  setLandlordName(null);
                }}
              >
                Clear landlord
              </button>
            )}
          </>
        )}
      </div>

      <label>
        <input
          type="checkbox"
          checked={draft.isPublic}
          disabled={readOnly}
          onChange={(e) => set({ isPublic: e.target.checked })}
        />
        Shown on the public site
      </label>

      {/* FR-015: what the hall costs is part of what the Booker knows about it, so it is managed here
          rather than on a page of its own. Only once the venue exists to hang a rent on. */}
      {venue && !readOnly && <VenueRents venueId={venue.id} />}

      {/* FR-010: retiring a hall that has closed, without losing the events held in it. */}
      {venue && !readOnly && (
        <ArchiveControl
          base={`/api/venues/${venue.id}`}
          what={venue.name}
          archived={venue.archivedAt !== null}
          onChanged={onSaved}
        />
      )}

      {error && <p role="alert">{error}</p>}
      <div>
        {!readOnly && (
          <button type="button" disabled={saving} onClick={() => void save()}>
            {venue ? "Save" : "Create"}
          </button>
        )}
        <button type="button" onClick={onClose}>
          {readOnly ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
