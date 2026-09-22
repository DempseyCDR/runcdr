"use client";
import { useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import ArchiveControl from "@/app/(admin)/ArchiveControl";
import LinkQuestion from "./LinkQuestion";
import { PROMO_LINK_TYPES, STYLE_TAGS, type PromoLink } from "@/server/domain/public/promoLinks";

/** A performer as the page holds it, with the linked contact's name for the link out. */
export type Performer = {
  id: string;
  displayName: string;
  bio: string | null;
  photoUrl: string | null;
  isPublic: boolean;
  isCaller: boolean;
  styles: string[];
  links: PromoLink[];
  contactId: string | null;
  contactName?: string | null;
  archivedAt: string | null;
};

type Props = {
  /** Absent when creating. */
  performer?: Performer;
  /** The viewer may read but not change it (no `performer.write`). */
  readOnly?: boolean;
  /** A name typed into the search that matched nobody — carried in rather than retyped (FR-008). */
  initialName?: string;
  onSaved: () => void;
  onClose: () => void;
};

/**
 * Creating a performer also creates the CONTACT behind them (feature 026), so these four belong to the
 * create path alone — afterwards they live on the contact record, which is where they are edited
 * (FR-018). Every *performer* field appears in both modes.
 */
type NewContact = {
  firstName: string;
  lastName: string;
  displayNameOverride: string;
  email: string;
  phone: string;
};

type Draft = {
  displayName: string;
  bio: string;
  photoUrl: string;
  isPublic: boolean;
  isCaller: boolean;
  styles: string[];
  links: PromoLink[];
};

const draftOf = (p?: Performer): Draft => ({
  displayName: p?.displayName ?? "",
  bio: p?.bio ?? "",
  photoUrl: p?.photoUrl ?? "",
  isPublic: p?.isPublic ?? false,
  isCaller: p?.isCaller ?? false,
  styles: p?.styles ?? [],
  links: p?.links ?? [],
});

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Feature 084 US1 (FR-001 to FR-003, FR-018, FR-019, FR-028): the performer form, used to CREATE and to
 * EDIT. The page it replaced collected a name, a biography, an email and a telephone on creation, then
 * let none of them be changed — the bug this feature exists to fix.
 *
 * Email and telephone are NOT here. They belong to the linked contact record, and feature 016 keeps
 * contact email and telephone behind `contact.pii.read`, so showing them on a `base`-readable performer
 * payload would leak PII. The form links to the contact instead — one fact, one place to edit it.
 */
/** "Newt Player" → first "Newt", last "Player"; a single word is a first name. */
function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1
    ? { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1)! }
    : { firstName: parts[0] ?? "", lastName: "" };
}

export default function PerformerForm({
  performer,
  readOnly = false,
  initialName,
  onSaved,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Draft>(draftOf(performer));
  const [fresh, setFresh] = useState<NewContact>({
    ...splitName(initialName ?? ""),
    displayNameOverride: "",
    email: "",
    phone: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // FR-021/FR-024: an existing performer with no contact settles that before the rest of the form opens.
  const [linked, setLinked] = useState<{ id: string; displayName: string } | null>(null);
  const unsettled = !!performer && !performer.contactId && !linked;

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  /** FR-027: the contact's spelling, offered for the performer's name — and declinable (a stage name). */
  async function adoptContactSpelling(name: string) {
    setError(null);
    const res = await apiFetch(`/api/performers/${performer!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: name }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setError(data?.error?.message ?? "Could not change the name.");
    }
    set({ displayName: name });
    setLinked(null);
    onSaved();
  }
  const toggleStyle = (style: string) =>
    set({
      styles: draft.styles.includes(style)
        ? draft.styles.filter((s) => s !== style)
        : [...draft.styles, style],
    });

  /** What changed — the body of a PATCH — or everything filled in, for a POST. */
  function body(): Record<string, unknown> {
    const all: Record<string, unknown> = {
      displayName: draft.displayName.trim(),
      bio: draft.bio.trim() || null,
      photoUrl: draft.photoUrl.trim() || null,
      isPublic: draft.isPublic,
      isCaller: draft.isCaller,
      styles: draft.styles,
      links: draft.links.filter((l) => l.url.trim() !== ""),
    };
    if (!performer) {
      // Creating: the contact's structured name and details, plus whatever performer fields were filled.
      return {
        firstName: fresh.firstName.trim(),
        ...(fresh.lastName.trim() ? { lastName: fresh.lastName.trim() } : {}),
        ...(fresh.displayNameOverride.trim()
          ? { displayNameOverride: fresh.displayNameOverride.trim() }
          : {}),
        ...(fresh.email.trim() ? { email: fresh.email.trim() } : {}),
        ...(fresh.phone.trim() ? { phone: fresh.phone.trim() } : {}),
        ...(draft.bio.trim() ? { bio: draft.bio.trim() } : {}),
        ...(draft.isPublic ? { isPublic: true } : {}),
        ...(draft.isCaller ? { isCaller: true } : {}),
        ...(draft.styles.length ? { styles: draft.styles } : {}),
        ...(draft.links.filter((l) => l.url.trim() !== "").length
          ? { links: draft.links.filter((l) => l.url.trim() !== "") }
          : {}),
      };
    }
    const before = draftOf(performer);
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(all) as (keyof Draft)[]) {
      if (!same(draft[key], before[key])) changed[key] = all[key];
    }
    return changed;
  }

  async function save() {
    setError(null);
    if (!performer && !fresh.firstName.trim()) return setError("A performer needs a first name.");
    if (performer && !draft.displayName.trim()) {
      return setError("A performer needs a display name.");
    }
    const changed = body();
    if (performer && Object.keys(changed).length === 0) return onClose();

    setSaving(true);
    const res = await apiFetch(performer ? `/api/performers/${performer.id}` : "/api/performers", {
      method: performer ? "PATCH" : "POST",
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

  if (unsettled) {
    return (
      <LinkQuestion
        performerId={performer!.id}
        displayName={performer!.displayName}
        archived={performer!.archivedAt !== null}
        onLinked={(contact) => setLinked(contact)}
        onArchived={onSaved}
      />
    );
  }

  return (
    <div>
      {/* FR-027: the two names differ — offer the contact's spelling, and take no for an answer, because
          a performer's name is a stage name as often as it is a misspelling. */}
      {linked && linked.displayName !== draft.displayName && (
        <div role="status">
          <p>
            The contact is called <strong>{linked.displayName}</strong>, this performer{" "}
            <strong>{draft.displayName}</strong>.
          </p>
          <button type="button" onClick={() => void adoptContactSpelling(linked.displayName)}>
            Use the contact&apos;s spelling
          </button>
          <button type="button" onClick={() => setLinked(null)}>
            Keep the performer&apos;s
          </button>
        </div>
      )}

      {performer ? (
        <label>
          Display name
          <input
            value={draft.displayName}
            disabled={readOnly}
            onChange={(e) => set({ displayName: e.target.value })}
          />
        </label>
      ) : (
        <>
          <label>
            First name
            <input
              value={fresh.firstName}
              onChange={(e) => setFresh((f) => ({ ...f, firstName: e.target.value }))}
            />
          </label>
          <label>
            Last name
            <input
              value={fresh.lastName}
              onChange={(e) => setFresh((f) => ({ ...f, lastName: e.target.value }))}
            />
          </label>
          <label>
            Display name
            <input
              placeholder="Optional — a stage name"
              value={fresh.displayNameOverride}
              onChange={(e) => setFresh((f) => ({ ...f, displayNameOverride: e.target.value }))}
            />
          </label>
          <label>
            Email
            <input
              value={fresh.email}
              onChange={(e) => setFresh((f) => ({ ...f, email: e.target.value }))}
            />
          </label>
          <label>
            Telephone
            <input
              value={fresh.phone}
              onChange={(e) => setFresh((f) => ({ ...f, phone: e.target.value }))}
            />
          </label>
        </>
      )}

      {/* FR-018: the contact owns the person's email and telephone; this form never edits them. */}
      {performer?.contactId && (
        <p>
          <a href={`/contacts?contactId=${performer.contactId}`}>
            {performer.contactName ?? "the linked contact"}
          </a>{" "}
          holds this performer&apos;s email and telephone — change them on that contact record.
        </p>
      )}

      <label>
        Biography
        <textarea
          rows={3}
          value={draft.bio}
          disabled={readOnly}
          onChange={(e) => set({ bio: e.target.value })}
        />
      </label>
      <label>
        Photo URL
        <input
          value={draft.photoUrl}
          disabled={readOnly}
          placeholder="https://…"
          onChange={(e) => set({ photoUrl: e.target.value })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={draft.isPublic}
          disabled={readOnly}
          onChange={(e) => set({ isPublic: e.target.checked })}
        />
        Shown on the public site
      </label>
      <label>
        <input
          type="checkbox"
          checked={draft.isCaller}
          disabled={readOnly}
          onChange={(e) => set({ isCaller: e.target.checked })}
        />
        Calls
      </label>

      <fieldset>
        <legend>Styles</legend>
        {STYLE_TAGS.map((style) => (
          <label key={style}>
            <input
              type="checkbox"
              checked={draft.styles.includes(style)}
              disabled={readOnly}
              onChange={() => toggleStyle(style)}
            />
            {style}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Promo links</legend>
        {draft.links.map((link, i) => (
          <div key={i}>
            <select
              aria-label={`link ${i + 1} type`}
              value={link.type}
              disabled={readOnly}
              onChange={(e) =>
                set({
                  links: draft.links.map((l, j) =>
                    j === i ? { ...l, type: e.target.value as PromoLink["type"] } : l,
                  ),
                })
              }
            >
              {PROMO_LINK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              aria-label={`link ${i + 1} url`}
              value={link.url}
              disabled={readOnly}
              placeholder="https://…"
              onChange={(e) =>
                set({
                  links: draft.links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)),
                })
              }
            />
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            onClick={() =>
              set({ links: [...draft.links, { type: PROMO_LINK_TYPES[0]!, url: "" }] })
            }
          >
            Add a link
          </button>
        )}
      </fieldset>

      {/* FR-010: a caller who has stopped calling leaves the roster and the public site. */}
      {performer && !readOnly && (
        <ArchiveControl
          base={`/api/performers/${performer.id}`}
          what={performer.displayName}
          archived={performer.archivedAt !== null}
          onChanged={onSaved}
        />
      )}

      {error && <p role="alert">{error}</p>}
      <div>
        {!readOnly && (
          <button type="button" disabled={saving} onClick={() => void save()}>
            {performer ? "Save" : "Create"}
          </button>
        )}
        <button type="button" onClick={onClose}>
          {readOnly ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
