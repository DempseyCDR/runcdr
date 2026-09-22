"use client";
import { apiFetch } from "@/app/apiFetch";

import { useCallback, useEffect, useRef, useState } from "react";
import { PROMO_LINK_TYPES, STYLE_TAGS, type PromoLink } from "@/server/domain/public/promoLinks";

type BandSummary = {
  id: string;
  name: string;
  memberCount: number;
  leadPerformerName: string | null;
};
type Performer = { id: string; displayName: string };
type RosterEntry = { performerId: string; isLead: boolean; instrument: string | null };

export default function BandsPage() {
  const [bands, setBands] = useState<BandSummary[]>([]);
  const [performers, setPerformers] = useState<Performer[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  // Feature 053 (P7-R9): public roster fields.
  const [isPublic, setIsPublic] = useState(false);
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [links, setLinks] = useState<PromoLink[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  // Feature 084 (FR-005): searched, not listed — the page fetches nothing until a name is typed. The
  // endpoint still browses the roster for the booking flows that read it that way (analysis F1).
  const [q, setQ] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const needle = q.trim();
    if (!needle) {
      setBands([]);
      setTruncated(false);
      return;
    }
    const res = await apiFetch(
      `/api/bands?q=${encodeURIComponent(needle)}${showArchived ? "&archived=1" : ""}`,
    );
    const data = await res.json();
    setBands(data.items ?? []);
    setTruncated(!!data.truncated);
  }, [q, showArchived]);

  useEffect(() => searchRef.current?.focus(), []);

  useEffect(() => {
    void load();
    void apiFetch("/api/performers")
      .then((r) => r.json())
      .then((d) => setPerformers(d.items ?? []));
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setBio("");
    setPhotoUrl("");
    setRoster([]);
    setIsPublic(false);
    setStyleTags([]);
    setLinks([]);
  }

  async function edit(id: string) {
    const res = await apiFetch(`/api/bands/${id}`);
    const b = await res.json();
    setEditingId(id);
    setName(b.name);
    setBio(b.bio ?? "");
    setPhotoUrl(b.photoUrl ?? "");
    setRoster(
      b.members.map((m: RosterEntry) => ({
        performerId: m.performerId,
        isLead: m.isLead,
        instrument: m.instrument ?? null,
      })),
    );
    setIsPublic(b.isPublic ?? false);
    setStyleTags(b.styles ?? []);
    setLinks(b.links ?? []);
  }

  function toggleMember(performerId: string) {
    setRoster((r) =>
      r.some((m) => m.performerId === performerId)
        ? r.filter((m) => m.performerId !== performerId)
        : [...r, { performerId, isLead: r.length === 0, instrument: null }],
    );
  }

  function setLead(performerId: string) {
    setRoster((r) => r.map((m) => ({ ...m, isLead: m.performerId === performerId })));
  }

  function setInstrument(performerId: string, instrument: string) {
    setRoster((r) =>
      r.map((m) => (m.performerId === performerId ? { ...m, instrument: instrument || null } : m)),
    );
  }

  function toggleStyle(s: string) {
    setStyleTags((t) => (t.includes(s) ? t.filter((x) => x !== s) : [...t, s]));
  }

  function addLink() {
    setLinks((l) => [...l, { type: "website", url: "" }]);
  }
  function setLink(i: number, patch: Partial<PromoLink>) {
    setLinks((l) => l.map((link, idx) => (idx === i ? { ...link, ...patch } : link)));
  }
  function removeLink(i: number) {
    setLinks((l) => l.filter((_, idx) => idx !== i));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const body = {
      name,
      bio: bio || undefined,
      photoUrl: photoUrl || undefined,
      members: roster,
      isPublic,
      styles: styleTags,
      links: links.filter((l) => l.url.trim() !== ""),
    };
    const res = await apiFetch(editingId ? `/api/bands/${editingId}` : "/api/bands", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setMessage(
        (await res.json().catch(() => null))?.error?.message ??
          "Failed (need a name and exactly one lead)",
      );
      return;
    }
    resetForm();
    void load();
  }

  async function archive(id: string) {
    await apiFetch(`/api/bands/${id}`, { method: "DELETE" });
    if (editingId === id) resetForm();
    void load();
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>Bands</h1>

      <label>
        Search bands
        <input
          ref={searchRef}
          value={q}
          placeholder="Type part of a name"
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {/* FR-012: how a band retired by mistake is found again. */}
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
        {bands.map((b) => (
          <li key={b.id}>
            {b.name} — {b.memberCount} member(s), lead: {b.leadPerformerName ?? "—"}{" "}
            <button onClick={() => edit(b.id)}>Edit</button>{" "}
            <button onClick={() => archive(b.id)}>Archive</button>
          </li>
        ))}
        {q.trim() && bands.length === 0 && (
          <li style={{ color: "#888" }}>No band matches “{q.trim()}”.</li>
        )}
      </ul>

      <h2>{editingId ? "Edit band" : "New band"}</h2>
      <form onSubmit={save} style={{ display: "grid", gap: 6, maxWidth: 420 }}>
        <input placeholder="Band name" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea
          placeholder="Bio (optional)"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
        />
        <input
          placeholder="Photo URL (optional)"
          value={photoUrl}
          onChange={(e) => setPhotoUrl(e.target.value)}
        />
        <fieldset>
          <legend>Roster (check members, pick one lead)</legend>
          {performers.map((p) => {
            const entry = roster.find((m) => m.performerId === p.id);
            return (
              <div key={p.id}>
                <label>
                  <input type="checkbox" checked={!!entry} onChange={() => toggleMember(p.id)} />{" "}
                  {p.displayName}
                </label>
                {entry && (
                  <>
                    <label style={{ marginLeft: 8 }}>
                      <input
                        type="radio"
                        name="lead"
                        checked={entry.isLead}
                        onChange={() => setLead(p.id)}
                      />{" "}
                      lead
                    </label>
                    <input
                      style={{ marginLeft: 8 }}
                      placeholder="instrument (optional)"
                      aria-label={`${p.displayName} instrument`}
                      value={entry.instrument ?? ""}
                      onChange={(e) => setInstrument(p.id, e.target.value)}
                    />
                  </>
                )}
              </div>
            );
          })}
        </fieldset>

        <fieldset>
          <legend>Public roster (feature 053)</legend>
          <label>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />{" "}
            Show this band on the public /performers roster
          </label>
          <div style={{ marginTop: 6 }}>
            Styles:{" "}
            {STYLE_TAGS.map((s) => (
              <label key={s} style={{ marginRight: 8 }}>
                <input
                  type="checkbox"
                  checked={styleTags.includes(s)}
                  onChange={() => toggleStyle(s)}
                />{" "}
                {s}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 6 }}>
            <div>Promotional links:</div>
            {links.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 4, marginTop: 4 }}>
                <select
                  aria-label={`link ${i + 1} type`}
                  value={l.type}
                  onChange={(e) => setLink(i, { type: e.target.value as PromoLink["type"] })}
                >
                  {PROMO_LINK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="https://…"
                  aria-label={`link ${i + 1} url`}
                  value={l.url}
                  onChange={(e) => setLink(i, { url: e.target.value })}
                />
                <button type="button" onClick={() => removeLink(i)}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" onClick={addLink} style={{ marginTop: 4 }}>
              + Add link
            </button>
          </div>
        </fieldset>

        <div>
          <button type="submit">{editingId ? "Save changes" : "Create band"}</button>{" "}
          {editingId && (
            <button type="button" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
        {message && <p style={{ color: "crimson" }}>{message}</p>}
      </form>
    </main>
  );
}
