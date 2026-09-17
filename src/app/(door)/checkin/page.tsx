"use client";
import { apiFetch } from "@/app/apiFetch";
import type { EventRow } from "@/app/EventSelector";
import ContactName from "@/app/_components/ContactName";
import EventConfirm from "@/app/_components/EventConfirm";
import AddContactDialog, { type CheckInResult } from "./AddContactDialog";
import CheckedInDialog from "./CheckedInDialog";
import styles from "./checkin.module.css";

import { useCallback, useEffect, useRef, useState } from "react";

type SeriesRow = { id: string; key: string; name: string };
/** A search result (contract §1). */
type Candidate = {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string | null;
  displayNameOverride: string | null;
  checkedIn?: boolean;
  emails: string[];
  reachedVia: { ownerDisplayName: string; address: string | null } | null;
};
/** Feature 079 (FR-009): the one row of per-check-in extras, applied to whichever check-in comes next. */
type Extras = { children: string; comp: boolean; gift: boolean; openBand: boolean };
const NO_EXTRAS: Extras = { children: "", comp: false, gift: false, openBand: false };

/**
 * Feature 079: the door check-in page, rebuilt for a phone (FR-001–FR-012).
 *
 * One compact region holds what the common dancer needs — the event confirmed, the search, the extras row,
 * Check in anonymously, Add contact and Show checked in — and the results scroll beneath it. The extras are
 * one row rather than a set per result: on a phone a set per result does not fit beside the name, and a
 * dancer's children or comp belong to the check-in, not to a row of the list.
 */
export default function CheckinPage() {
  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [event, setEvent] = useState<EventRow | null>(null);
  const eventId = event?.id ?? "";
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidatesTruncated, setCandidatesTruncated] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [extras, setExtras] = useState<Extras>(NO_EXTRAS);
  const searchRef = useRef<HTMLInputElement>(null);

  const [adding, setAdding] = useState(false);

  const [showingIn, setShowingIn] = useState(false);

  const communityDanceSeriesId = series.find((s) => s.key === "community_dance")?.id ?? null;
  const isCommunityDance = !!event && event.seriesId === communityDanceSeriesId;

  useEffect(() => {
    void apiFetch("/api/series")
      .then((r) => r.json())
      .then((d) => setSeries(d.items ?? []));
    searchRef.current?.focus();
  }, []);

  const search = useCallback(async (query: string, forEvent: string) => {
    if (!query.trim()) {
      setCandidates([]);
      setCandidatesTruncated(false);
      return;
    }
    const params = new URLSearchParams({ q: query, ...(forEvent ? { eventId: forEvent } : {}) });
    const res = await apiFetch(`/api/attendance/search?${params}`);
    const data = await res.json();
    setCandidates(data.items ?? []);
    setCandidatesTruncated(!!data.truncated);
  }, []);

  useEffect(() => {
    void search(q, eventId);
  }, [q, eventId, search]);

  /** The extras row as a check-in body. Open band only at a community dance, and only for a named person. */
  function extrasBody(named: boolean) {
    const children = Number(extras.children) || 0;
    return {
      ...(children > 0 ? { childrenCount: children } : {}),
      ...(extras.comp ? { isComp: true } : {}),
      ...(extras.gift ? { redeemedGiftCard: true } : {}),
      ...(named && isCommunityDance && extras.openBand ? { isOpenBand: true } : {}),
    };
  }

  /** "2 children · comp" — what the extras row will apply, for the Add contact dialog that hides it. */
  const extrasSummary = [
    Number(extras.children) > 0 ? `${Number(extras.children)} children` : null,
    extras.comp ? "comp" : null,
    extras.gift ? "gift card" : null,
    isCommunityDance && extras.openBand ? "open band" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  /**
   * Record one check-in with the extras row applied. On success the extras row resets and the page is ready
   * for the next dancer; on a refusal the extras row is KEPT (research R8), so nothing Meg set is lost to
   * someone else's check-in. The result goes back to the caller, which may have a question to ask about it.
   */
  async function checkIn(
    body: Record<string, unknown>,
    label: string,
    named = true,
  ): Promise<CheckInResult> {
    if (!eventId) return { ok: false, message: "Pick an event first." };
    const res = await apiFetch(`/api/events/${eventId}/attendance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...extrasBody(named) }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      return {
        ok: false,
        code: b?.error?.code,
        message: b?.error?.message ?? "That check-in failed.",
        other: b?.error?.other,
      };
    }
    setMessage({ text: `Checked in: ${label}`, error: false });
    setExtras(NO_EXTRAS);
    setQ("");
    setCandidates([]);
    setCandidatesTruncated(false);
    setAdding(false);
    searchRef.current?.focus();
    return { ok: true };
  }

  /** A check-in made straight from the page: a refusal is shown in the page's status line. */
  async function checkInFromPage(body: Record<string, unknown>, label: string, named = true) {
    const result = await checkIn(body, label, named);
    if (!result.ok) setMessage({ text: result.message, error: true });
  }

  const checkInCandidate = (c: Candidate) => checkInFromPage({ contactId: c.id }, c.displayName);

  return (
    <main className={styles.page}>
      <div className={styles.top}>
        <EventConfirm event={event} series={series} onSelect={setEvent} />

        <input
          ref={searchRef}
          type="search"
          aria-label="Search dancers"
          placeholder="Type a name…"
          className={styles.search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // FR-010: Enter checks in the top result — unless it is already in, or there is none.
            if (e.key !== "Enter") return;
            e.preventDefault();
            const top = candidates[0];
            if (top && !top.checkedIn) void checkInCandidate(top);
          }}
        />

        <fieldset aria-label="Extras for the next check-in" className={styles.extras}>
          <label>
            Children
            <input
              type="number"
              min={0}
              inputMode="numeric"
              className={styles.childrenInput}
              value={extras.children}
              onChange={(e) => setExtras({ ...extras, children: e.target.value })}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={extras.comp}
              onChange={(e) => setExtras({ ...extras, comp: e.target.checked })}
            />
            Comp
          </label>
          <label>
            <input
              type="checkbox"
              checked={extras.gift}
              onChange={(e) => setExtras({ ...extras, gift: e.target.checked })}
            />
            Gift card
          </label>
          {isCommunityDance && (
            <label>
              <input
                type="checkbox"
                checked={extras.openBand}
                onChange={(e) => setExtras({ ...extras, openBand: e.target.checked })}
              />
              Open band
            </label>
          )}
        </fieldset>

        <div className={styles.actions}>
          {/* FR-012: an anonymous dancer has no name, and open band needs one — the server refuses it. */}
          <button
            type="button"
            className={styles.button}
            disabled={isCommunityDance && extras.openBand}
            title={isCommunityDance && extras.openBand ? "Open band needs a name" : undefined}
            onClick={() => void checkInFromPage({ unmatched: true }, "anonymous dancer", false)}
          >
            Check in anonymously
          </button>
          <button type="button" className={styles.button} onClick={() => setAdding(true)}>
            Add contact
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={!eventId}
            onClick={() => setShowingIn(true)}
          >
            Show checked in
          </button>
        </div>

        {message && (
          <p role="status" className={message.error ? styles.error : styles.status}>
            {message.text}
          </p>
        )}
      </div>

      {candidates.length > 0 && (
        <ul aria-label="Search results" className={styles.results}>
          {candidates.map((c) => (
            <li key={c.id} className={styles.result}>
              <div className={styles.resultName}>
                <ContactName c={c} />
                <div className={styles.resultMeta}>
                  {c.emails.length > 0
                    ? c.emails.join(", ")
                    : c.reachedVia
                      ? `reached via ${c.reachedVia.ownerDisplayName}${
                          c.reachedVia.address ? ` (${c.reachedVia.address})` : ""
                        }`
                      : null}
                </div>
              </div>
              <div className={styles.resultAction}>
                {c.checkedIn ? (
                  <span className={styles.checkmark} role="img" aria-label="Already checked in">
                    ✓
                  </span>
                ) : (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => void checkInCandidate(c)}
                  >
                    Check in
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {candidatesTruncated && <p className={styles.hint}>More matches — refine your search.</p>}

      {adding && (
        <AddContactDialog
          eventId={eventId}
          extrasSummary={extrasSummary}
          onCheckIn={(body, label) => checkIn(body, label)}
          onClose={() => {
            setAdding(false);
            searchRef.current?.focus();
          }}
        />
      )}

      {showingIn && (
        <CheckedInDialog
          eventId={eventId}
          isCommunityDance={isCommunityDance}
          onClose={() => {
            setShowingIn(false);
            searchRef.current?.focus();
          }}
        />
      )}
    </main>
  );
}
