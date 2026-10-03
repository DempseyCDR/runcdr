"use client";
import { apiFetch } from "@/app/apiFetch";

import { useEffect, useId, useState } from "react";
import Dialog, { DialogActions, useInDialog } from "@/app/_components/Dialog";
import PerformerForm from "../_performers/PerformerForm";
import { PROMO_LINK_TYPES, STYLE_TAGS, type PromoLink } from "@/server/domain/public/promoLinks";
import styles from "./hub.module.css";

/**
 * Feature 087 US3 (FR-021 to FR-024) — a band's roster, edited from the hub.
 *
 * The bands page this replaces listed EVERY performer in the directory with a checkbox beside each, so a
 * band appeared as the few ticked among hundreds. Here a band lists its members and only its members: a
 * checkbox takes one off, a radio picks the lead, and a search adds someone.
 *
 * An unticked member stays in the list, unticked, until Save — so a slip of the mouse is undone by
 * ticking again rather than by searching for the person all over.
 *
 * The lead is OPTIONAL (FR-022). Taking the lead off leaves the band with no lead, said plainly (FR-023),
 * and a band with no lead offers the members who can be emailed instead (FR-024). Membership is undated:
 * changing it touches no booking, past or future (FR-025) — a dance's lineup is changed on the dance.
 *
 * Every other field the bands page edited (biography, photo, instruments, the public roster, archive) is
 * carried over whole: deleting that page must take no capability with it (FR-031).
 */

type Entry = {
  performerId: string;
  performerName: string;
  isLead: boolean;
  instrument: string | null;
  /** Ticked. An unticked entry is shown until Save and then left out. */
  kept: boolean;
};

type Band = {
  id: string;
  name: string;
  bio: string | null;
  photoUrl: string | null;
  isPublic: boolean;
  styles: string[];
  links: PromoLink[];
  archivedAt: string | null;
  members: Omit<Entry, "kept">[];
};

type Props = {
  /** Absent when creating a band. */
  bandId?: string;
  /** A name typed into the hub search that matched nothing — carried in rather than retyped. */
  initialName?: string;
  /** The viewer may read but not change it (no `performer.write`). */
  readOnly?: boolean;
  /** With the band when it was created or saved — so the host can search for it, or book it. */
  onSaved: (band?: { id: string; name: string }) => void;
  onClose: () => void;
};

export default function BandRoster({
  bandId,
  initialName,
  readOnly = false,
  onSaved,
  onClose,
}: Props) {
  const formId = useId();
  const inDialog = useInDialog();
  const [name, setName] = useState(initialName ?? "");
  const [bio, setBio] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [links, setLinks] = useState<PromoLink[]>([]);
  const [archivedAt, setArchivedAt] = useState<string | null>(null);
  const [roster, setRoster] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; displayName: string }[]>([]);
  // Feature 091 (Rich, 2026-10-02): the text the search last answered for — a new performer is offered
  // for it after every answer, as the hub's search does — and the new performer being made.
  const [answered, setAnswered] = useState("");
  const [making, setMaking] = useState<string | null>(null);
  // FR-024: the members who can be emailed, asked for only while the band has no lead.
  const [reachable, setReachable] = useState<{ name: string; email: string }[] | null>(null);

  useEffect(() => {
    if (!bandId) return;
    void (async () => {
      const res = await apiFetch(`/api/bands/${bandId}`);
      if (!res.ok) return setError("Could not open that band.");
      const b = (await res.json()) as Band;
      setName(b.name);
      setBio(b.bio ?? "");
      setPhotoUrl(b.photoUrl ?? "");
      setIsPublic(b.isPublic ?? false);
      setStyleTags(b.styles ?? []);
      setLinks(b.links ?? []);
      setArchivedAt(b.archivedAt ?? null);
      setRoster(b.members.map((m) => ({ ...m, instrument: m.instrument ?? null, kept: true })));
    })();
  }, [bandId]);

  const kept = roster.filter((m) => m.kept);
  const hasLead = kept.some((m) => m.isLead);
  const keptKey = kept.map((m) => m.performerId).join(",");

  // FR-024. Email is behind `contact.pii.read`, so each member's address comes from the endpoint that
  // guards it — a refusal reads as "no address", never as an error the Booker must dismiss.
  useEffect(() => {
    if (hasLead || !keptKey) {
      setReachable(null);
      return;
    }
    let cancelled = false;
    const ids = keptKey.split(",");
    void Promise.all(
      ids.map(async (id) => {
        const res = await apiFetch(`/api/performers/${id}/mailto`).catch(() => null);
        const email: string | null = res?.ok ? ((await res.json()).email ?? null) : null;
        return { id, email };
      }),
    ).then((answers) => {
      if (cancelled) return;
      setReachable(
        answers.flatMap(({ id, email }) => {
          const who = roster.find((m) => m.performerId === id);
          return email && who ? [{ name: who.performerName, email }] : [];
        }),
      );
    });
    return () => {
      cancelled = true;
    };
    // `roster` is read only for names, which do not change while the key holds — so it is not a
    // dependency, and adding it would re-ask for every email on each keystroke in an instrument box.
  }, [hasLead, keptKey]);

  // Adding a member: search the directory, leaving out whoever is already listed.
  useEffect(() => {
    const needle = q.trim();
    if (!needle) {
      setAnswered("");
      return setFound([]);
    }
    let cancelled = false;
    void apiFetch(`/api/performers?q=${encodeURIComponent(needle)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setFound(d.items ?? []);
        setAnswered(needle);
      });
    return () => {
      cancelled = true;
    };
  }, [q]);

  // Unticking the lead takes the lead with it: never a lead who is not a member (FR-023).
  const toggle = (id: string) =>
    setRoster((r) =>
      r.map((m) => (m.performerId === id ? { ...m, kept: !m.kept, isLead: false } : m)),
    );
  const makeLead = (id: string) =>
    setRoster((r) => r.map((m) => ({ ...m, isLead: m.performerId === id })));
  const setInstrument = (id: string, instrument: string) =>
    setRoster((r) =>
      r.map((m) => (m.performerId === id ? { ...m, instrument: instrument || null } : m)),
    );
  const add = (p: { id: string; displayName: string }) => {
    setRoster((r) => [
      ...r,
      {
        performerId: p.id,
        performerName: p.displayName,
        isLead: false,
        instrument: null,
        kept: true,
      },
    ]);
    setQ("");
  };

  const toggleStyle = (s: string) =>
    setStyleTags((t) => (t.includes(s) ? t.filter((x) => x !== s) : [...t, s]));
  const setLink = (i: number, patch: Partial<PromoLink>) =>
    setLinks((l) => l.map((link, idx) => (idx === i ? { ...link, ...patch } : link)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (kept.length === 0) return setError("A band needs at least one member.");
    const body = {
      name,
      bio: bio || (bandId ? null : undefined),
      photoUrl: photoUrl || (bandId ? null : undefined),
      members: kept.map(({ performerId, isLead, instrument }) => ({
        performerId,
        isLead,
        instrument,
      })),
      isPublic,
      styles: styleTags,
      links: links.filter((l) => l.url.trim() !== ""),
    };
    const res = await apiFetch(bandId ? `/api/bands/${bandId}` : "/api/bands", {
      method: bandId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setError(data?.error?.message ?? `The server refused it (${res.status}).`);
    }
    const saved = await res.json().catch(() => null);
    onSaved({ id: saved?.id ?? bandId ?? "", name: saved?.name ?? name });
  }

  async function archive(restore: boolean) {
    setError(null);
    const res = restore
      ? await apiFetch(`/api/bands/${bandId}/restore`, { method: "POST" })
      : await apiFetch(`/api/bands/${bandId}`, { method: "DELETE" });
    if (!res.ok) return setError(`The server refused it (${res.status}).`);
    onSaved();
  }

  const listed = new Set(roster.map((m) => m.performerId));

  return (
    <form id={formId} onSubmit={save} className={styles.roster}>
      <label>
        Band name{" "}
        <input value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} />
      </label>

      <fieldset aria-label="Members">
        <legend>Members</legend>
        {roster.length === 0 && <p>No members yet — search below to add one.</p>}
        {roster.map((m) => (
          <div key={m.performerId} className={styles.member}>
            <label>
              <input
                type="checkbox"
                aria-label={m.performerName}
                checked={m.kept}
                disabled={readOnly}
                onChange={() => toggle(m.performerId)}
              />{" "}
              {m.performerName}
            </label>
            <label>
              <input
                type="radio"
                name="lead"
                aria-label={`Lead: ${m.performerName}`}
                checked={m.kept && m.isLead}
                disabled={readOnly || !m.kept}
                onChange={() => makeLead(m.performerId)}
              />{" "}
              lead
            </label>
            <input
              placeholder="instrument (optional)"
              aria-label={`${m.performerName} instrument`}
              value={m.instrument ?? ""}
              disabled={readOnly || !m.kept}
              onChange={(e) => setInstrument(m.performerId, e.target.value)}
            />
          </div>
        ))}

        {kept.length > 0 && !hasLead && (
          <div className={styles.noLead}>
            <p>This band has no lead.</p>
            {reachable && reachable.length > 0 && (
              <>
                <p>Contact a member instead:</p>
                <ul aria-label="Contact a member">
                  {reachable.map((r) => (
                    <li key={r.email}>
                      <a href={`mailto:${r.email}`}>{r.name}</a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {reachable && reachable.length === 0 && <p>No member has an email address on file.</p>}
          </div>
        )}

        {!readOnly && (
          <div>
            <input
              type="search"
              aria-label="Add a member"
              placeholder="Add a member…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {found.filter((p) => !listed.has(p.id)).length > 0 && (
              <ul className={styles.results}>
                {found
                  .filter((p) => !listed.has(p.id))
                  .map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={styles.link}
                        aria-label={`Add ${p.displayName}`}
                        onClick={() => add(p)}
                      >
                        {p.displayName}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            {/* Feature 091 (Rich, 2026-10-02): someone not yet a performer is made here, with the
                form that makes one from the hub, then joins the band — offered after every answer,
                since the Jane Smith wanted may not be the Jane Smithers found. */}
            {answered && answered === q.trim() && (
              <button type="button" onClick={() => setMaking(answered)}>
                New performer “{answered}”
              </button>
            )}
          </div>
        )}
      </fieldset>

      {making !== null && (
        <Dialog heading="New performer" onClose={() => setMaking(null)}>
          <PerformerForm
            initialName={making}
            onSaved={(created) => {
              setMaking(null);
              if (created) add(created);
            }}
            onClose={() => setMaking(null)}
          />
        </Dialog>
      )}

      <label>
        Biography{" "}
        <textarea value={bio} disabled={readOnly} onChange={(e) => setBio(e.target.value)} />
      </label>
      <label>
        Photo URL{" "}
        <input value={photoUrl} disabled={readOnly} onChange={(e) => setPhotoUrl(e.target.value)} />
      </label>

      <fieldset>
        <legend>Public roster</legend>
        <label>
          <input
            type="checkbox"
            checked={isPublic}
            disabled={readOnly}
            onChange={(e) => setIsPublic(e.target.checked)}
          />{" "}
          Show this band on the public performers page
        </label>
        <div>
          Styles:{" "}
          {STYLE_TAGS.map((s) => (
            <label key={s} className={styles.inline}>
              <input
                type="checkbox"
                checked={styleTags.includes(s)}
                disabled={readOnly}
                onChange={() => toggleStyle(s)}
              />{" "}
              {s}
            </label>
          ))}
        </div>
        <div>
          Promotional links:
          {links.map((l, i) => (
            <div key={i} className={styles.member}>
              <select
                aria-label={`link ${i + 1} type`}
                value={l.type}
                disabled={readOnly}
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
                disabled={readOnly}
                onChange={(e) => setLink(i, { url: e.target.value })}
              />
              {!readOnly && (
                <button type="button" onClick={() => setLinks((x) => x.filter((_, j) => j !== i))}>
                  ×
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <button
              type="button"
              onClick={() => setLinks((l) => [...l, { type: "website", url: "" }])}
            >
              + Add link
            </button>
          )}
        </div>
      </fieldset>

      {error && <p role="alert">{error}</p>}

      {/* Feature 089: in a dialog these join its action bar — Archive before Save, and the bar's Close
          stands for Cancel. The Save stays this form's submit button through its `form` attribute. */}
      <div className={styles.member}>
        {!inDialog && (
          <button type="button" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </button>
        )}
        {bandId && !readOnly && (
          <DialogActions secondary>
            <button type="button" onClick={() => void archive(!!archivedAt)}>
              {archivedAt ? "Restore band" : "Archive band"}
            </button>
          </DialogActions>
        )}
        {!readOnly && (
          <DialogActions>
            <button type="submit" form={formId}>
              {bandId ? "Save band" : "Create band"}
            </button>
          </DialogActions>
        )}
      </div>
      {archivedAt && <p>This band is archived.</p>}
    </form>
  );
}
