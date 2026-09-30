"use client";
import { apiFetch } from "@/app/apiFetch";
import Dialog from "@/app/_components/Dialog";

import { useCallback, useEffect, useRef, useState } from "react";

// Feature 020 US2 (FR-007..FR-013): the booking modal — create / edit / read-only shells over the existing
// booking API. One Save commits all fields (no save-on-close); Cancel discards; a non-Booker gets Close
// only. Performer selection is a typeahead; an unknown person is added by linking an existing contact.

type BookingLite = {
  id: string;
  performerId: string;
  performer: string;
  type: string;
  payCents: number;
  note: string | null;
  status: string;
};

type Props = {
  mode: "create" | "edit" | "readonly";
  eventId: string;
  eventDate: string;
  role?: string; // create: the slot's performer type
  booking?: BookingLite;
  /** Create: a performer already chosen — picked from the hub's music search (087 walk-through). */
  performer?: { id: string; name: string };
  /** Create: text already typed into a search elsewhere, carried in and searched for at once. */
  initialQuery?: string;
  onClose: () => void;
  onSaved?: () => void;
};

const STATUSES = ["proposed", "requested", "tentative", "confirmed", "declined"] as const;
const MONTHS =
  "January February March April May June July August September October November December".split(
    " ",
  );

/** "Book a caller for 2026-10-01", "Book an instructor for …" — the create title (087 walk-through). */
function bookTitle(role: string | undefined, date: string): string {
  const what = (role ?? "booking").replace(/_/g, " ");
  return `Book ${/^[aeiou]/i.test(what) ? "an" : "a"} ${what} for ${date}`;
}

function friendlyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function BookingModal({
  mode,
  eventId,
  eventDate,
  role,
  booking,
  performer,
  initialQuery,
  onClose,
  onSaved,
}: Props) {
  const readOnly = mode === "readonly";
  const [performerId, setPerformerId] = useState(booking?.performerId ?? performer?.id ?? "");
  const [performerName, setPerformerName] = useState(booking?.performer ?? performer?.name ?? "");
  const [pay, setPay] = useState(booking ? String(booking.payCents / 100) : "");
  const [note, setNote] = useState(booking?.note ?? "");
  const [status, setStatus] = useState(booking?.status ?? "proposed");
  const [error, setError] = useState<string | null>(null);

  // Performer typeahead + add-performer hand-off
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; displayName: string }[]>([]);
  // What the search last answered for — "New performer" is offered after an answer, as on the hub.
  const [answered, setAnswered] = useState("");

  // Feature 024 US3: substitute a performer on an existing booking. The server branches on the written-check
  // discriminator (unpaid → clean re-point; live-paid → keep the no-show + add a fresh booking).
  const [subQ, setSubQ] = useState("");
  const [subHits, setSubHits] = useState<{ id: string; displayName: string }[]>([]);
  const [addingContactQ, setAddingContactQ] = useState<string | null>(null);
  const [contactHits, setContactHits] = useState<{ id: string; displayName: string }[]>([]);
  const [newEmail, setNewEmail] = useState(""); // optional email for a brand-new performer's contact
  // 087 walk-through: "none of these — a new person" chosen, when the directory offered a match.
  const [newChosen, setNewChosen] = useState(false);
  // 087 walk-through: what the last link or create MADE, said plainly — never done without a word.
  const [made, setMade] = useState<string | null>(null);
  // Feature 026: structured names for a brand-new performer (seeded by splitting the typed query).
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");

  // mailto (edit/readonly): PII, fetched from a contact.pii.read endpoint
  const [mailto, setMailto] = useState<string | null>(null);
  useEffect(() => {
    if (!booking?.performerId) return;
    void apiFetch(`/api/performers/${booking.performerId}/mailto`)
      .then((r) => r.json())
      .then((d) => setMailto(d.email ?? null))
      .catch(() => setMailto(null));
  }, [booking?.performerId]);

  const search = useCallback(async (value: string) => {
    setQ(value);
    setAddingContactQ(null);
    if (value.trim().length < 1) {
      setAnswered("");
      return setHits([]);
    }
    const res = await apiFetch(`/api/performers?q=${encodeURIComponent(value)}`);
    setHits((await res.json()).items ?? []);
    setAnswered(value.trim());
  }, []);

  // A search typed elsewhere (the hub's music search) carries in, already answered.
  const carried = useRef(false);
  useEffect(() => {
    if (carried.current || mode !== "create" || !initialQuery?.trim()) return;
    carried.current = true;
    void search(initialQuery);
  }, [mode, initialQuery, search]);

  function pick(id: string, name: string) {
    setPerformerId(id);
    setPerformerName(name);
    setHits([]);
    setQ("");
  }

  async function searchContacts(value: string) {
    setAddingContactQ(value);
    setNewChosen(false);
    if (value.trim().length < 2) return setContactHits([]);
    const res = await apiFetch(`/api/contacts?q=${encodeURIComponent(value)}`);
    setContactHits((await res.json()).items ?? []);
  }

  /** Split a typed name into first/last on the last space (a convenience seed; the fields stay editable). */
  function seedNames(name: string) {
    const trimmed = name.trim();
    const i = trimmed.lastIndexOf(" ");
    setNewFirst(i === -1 ? trimmed : trimmed.slice(0, i));
    setNewLast(i === -1 ? "" : trimmed.slice(i + 1));
  }

  // Add-performer hand-off (FR-013): link an EXISTING contact to a new performer, then select it. Feature 026:
  // no name is captured — the performer's display comes from the linked contact.
  async function addPerformer(contactId: string) {
    const res = await apiFetch("/api/performers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId }),
    });
    if (!res.ok) return setError("Could not add performer");
    const created = await res.json();
    pick(created.id, created.displayName);
    setAddingContactQ(null);
    setMade(
      `Linked ${created.displayName} — a new performer for the contact already in the directory.`,
    );
  }

  // Feature 020 + 026: the person isn't a contact yet → create a brand-new contact + performer inline, with
  // STRUCTURED first/last (+ optional email labeled 'booking'). Names are seeded from the typed query but the
  // FS can correct the split before creating.
  async function createNewPerformer(): Promise<string | null> {
    const firstName = newFirst.trim();
    if (!firstName) {
      setError("A first name is required");
      return null;
    }
    const res = await apiFetch("/api/performers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName,
        ...(newLast.trim() ? { lastName: newLast.trim() } : {}),
        ...(newEmail.trim() ? { email: newEmail.trim(), emailPurpose: "booking" } : {}),
      }),
    });
    if (!res.ok) {
      setError("Could not create performer");
      return null;
    }
    const created = await res.json();
    pick(created.id, created.displayName);
    setAddingContactQ(null);
    setNewFirst("");
    setNewLast("");
    setNewEmail("");
    setNewChosen(false);
    setMade(`Created ${created.displayName} — a new performer and contact.`);
    return created.id as string;
  }

  /** The new-person fields: when nobody in the directory matches, or the Booker has said "a new person". */
  const newPersonShown =
    addingContactQ !== null &&
    (newChosen || (addingContactQ.trim().length >= 2 && contactHits.length === 0));

  async function searchSub(value: string) {
    setSubQ(value);
    if (value.trim().length < 1) return setSubHits([]);
    const res = await apiFetch(`/api/performers?q=${encodeURIComponent(value)}`);
    setSubHits((await res.json()).items ?? []);
  }

  // Feature 024 US3: POST the substitute. The server does the right thing per the discriminator; either way
  // the substitute ends up with their own booking (a clean re-point, or a fresh booking beside the no-show).
  async function substitute(newPerformerId: string) {
    if (!booking) return;
    setError(null);
    const res = await apiFetch(`/api/bookings/${booking.id}/substitute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPerformerId }),
    });
    if (res.status === 403) return setError("Only the Booker may substitute a performer.");
    if (!res.ok) return setError("Could not substitute performer");
    onSaved?.();
    onClose();
  }

  async function save() {
    setError(null);
    if (mode === "create") {
      // Feature 087 walk-through: a new person filled in but not yet created is created by Save itself —
      // Save means "book this", and the Booker should not have to find a second button first.
      let id: string | null = performerId || null;
      // 087 walk-through: a match was offered and not yet answered — never guess. Creating a contact the
      // Booker did not ask for is how the directory fills with duplicates.
      if (!id && addingContactQ !== null && contactHits.length > 0 && !newChosen) {
        return setError("Link one of the contacts listed, or create a new contact.");
      }
      if (!id && newPersonShown && newFirst.trim()) {
        id = await createNewPerformer();
        if (!id) return; // createNewPerformer has said why
      }
      if (!id) return setError("Choose a performer");
      const res = await apiFetch(`/api/events/${eventId}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          performerId: id,
          performerType: role,
          ...(pay ? { pay: Number(pay) } : {}),
          // Feature 087 walk-through: the note typed while booking was never sent on create.
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      if (res.status === 403) return setError("Only the Booker may create bookings.");
      if (!res.ok) return setError("Could not create booking");
    } else if (booking) {
      const res = await apiFetch(`/api/bookings/${booking.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          performerId, // may be a substitute → server re-points + resets to proposed
          pay: Number(pay) || 0,
          note,
          status,
        }),
      });
      if (res.status === 403) return setError("Only the Booker may edit bookings.");
      if (!res.ok) {
        // Feature 024 (FR-005): a re-point of a booking settled by a live check is refused (422) with a
        // message that names the cause and points at the substitute action; surface it inline.
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        return setError(body?.error?.message ?? "Could not save booking");
      }
    }
    onSaved?.();
    onClose();
  }

  return (
    <Dialog
      heading={mode === "create" ? bookTitle(role, eventDate) : `Booking — ${performerName}`}
      onClose={onClose}
      message={
        // Feature 087 walk-through: the reason Save refused sits beside Save. At the top of a dialog
        // scrolled to its foot it was never seen, and the page looked frozen.
        error && (
          <p role="alert" style={{ color: "#b00020" }}>
            {error}
          </p>
        )
      }
      actions={
        !readOnly && (
          <button type="button" onClick={() => void save()}>
            Save
          </button>
        )
      }
    >
      {mode === "create" && (
        <div>
          {/* 087 walk-through: the same pattern as the hub's own search — type, pick a result, or make a new
              performer from what was typed. The new one is offered after every answer, not only an empty
              one: the Jane Smith you want may not be the Jane Smithers the search found. */}
          <input
            type="search"
            aria-label="Find a performer"
            placeholder="Find a performer…"
            value={q}
            onChange={(e) => void search(e.target.value)}
          />
          {hits.length > 0 && (
            <ul aria-label="Search results">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => pick(h.id, h.displayName)}>
                    {h.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {answered && answered === q.trim() && (
            <div>
              <button
                type="button"
                onClick={() => {
                  seedNames(q);
                  void searchContacts(q);
                }}
              >
                New performer “{answered}”
              </button>
              {addingContactQ !== null && (
                <>
                  <input
                    aria-label="Search contact"
                    value={addingContactQ}
                    onChange={(e) => void searchContacts(e.target.value)}
                  />
                  {contactHits.length > 0 && !newChosen && (
                    <div role="group" aria-label="Already in the directory?">
                      <p style={{ margin: "4px 0" }}>
                        Is “{q.trim() || addingContactQ}” already in the directory? Link them — or,
                        if none of these is the person, create a new contact.
                      </p>
                      <ul>
                        {contactHits.map((c) => (
                          <li key={c.id}>
                            <button type="button" onClick={() => void addPerformer(c.id)}>
                              Link {c.displayName}
                            </button>
                          </li>
                        ))}
                      </ul>
                      <button type="button" onClick={() => setNewChosen(true)}>
                        No — create a new contact
                      </button>
                    </div>
                  )}
                  {newPersonShown && (
                    <div style={{ marginTop: 6 }}>
                      <p style={{ margin: "4px 0", color: "#555" }}>
                        {newChosen
                          ? "A new performer and contact:"
                          : "No contact found — create a new performer and contact:"}
                      </p>
                      <input
                        aria-label="New performer first name"
                        placeholder="First name"
                        value={newFirst}
                        onChange={(e) => setNewFirst(e.target.value)}
                      />{" "}
                      <input
                        aria-label="New performer last name"
                        placeholder="Last name (optional)"
                        value={newLast}
                        onChange={(e) => setNewLast(e.target.value)}
                      />{" "}
                      <input
                        aria-label="New performer email"
                        type="email"
                        placeholder="Email (optional)"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                      />{" "}
                      <button
                        type="button"
                        disabled={!newFirst.trim()}
                        onClick={() => void createNewPerformer()}
                      >
                        Create performer
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {made && <p role="status">{made}</p>}
          {performerName && <p>Selected: {performerName}</p>}
        </div>
      )}

      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        <label>
          Pay{" "}
          <input
            value={pay}
            onChange={(e) => setPay(e.target.value)}
            disabled={readOnly}
            inputMode="decimal"
          />
        </label>
        <label>
          Notes{" "}
          <input
            aria-label="Notes"
            value={note ?? ""}
            onChange={(e) => setNote(e.target.value)}
            disabled={readOnly}
          />
        </label>
        {mode !== "create" && (
          <label>
            Status{" "}
            <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={readOnly}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        {mailto && (
          <a
            href={`mailto:${mailto}?subject=${encodeURIComponent(`Rochester Dance ${friendlyDate(eventDate)}`)}`}
          >
            Email {performerName}
          </a>
        )}
      </div>

      {mode === "edit" && booking && (
        <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 8 }}>
          <label>
            Substitute performer{" "}
            <input
              aria-label="Substitute performer"
              value={subQ}
              onChange={(e) => void searchSub(e.target.value)}
            />
          </label>
          <p style={{ margin: "4px 0", color: "#555" }}>
            <small>
              A paid booking is kept as a no-show and the substitute is added as a new booking.
            </small>
          </p>
          <ul>
            {subHits.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => void substitute(h.id)}>
                  Substitute in {h.displayName}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
