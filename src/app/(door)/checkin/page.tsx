"use client";
import { apiFetch } from "@/app/apiFetch";
import type { EventRow } from "@/app/EventSelector";
import ContactName from "@/app/_components/ContactName";
import EventConfirm from "@/app/_components/EventConfirm";
import AddContactDialog, { type CheckInResult } from "./AddContactDialog";
import CheckedInDialog from "./CheckedInDialog";
import SaleOrCheckDialog, {
  type CheckToEdit,
  type SaleToEdit,
} from "@/app/_components/SaleOrCheckDialog";
import { CATEGORY_LABEL } from "../gate/types";
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
/** Feature 082: what the door recorded tonight, from the evening's record. */
type Recorded = { contactId: string; displayName: string } | null;
type MySale = SaleToEdit & { recordedBy: Recorded };
type MyCheck = CheckToEdit & { amount: number; recordedBy: Recorded };
/** What an anonymous sale is called in the door's own list: what was sold. */
const label = (x: SaleToEdit) => CATEGORY_LABEL[x.category] ?? x.category;
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

  // Feature 082 (FR-024–FR-027, research R16): the door records a sale or a check as it is handed over,
  // and may correct what it recorded itself. The evening's money is not shown here — it is the gate's.
  const [me, setMe] = useState<string | null>(null);
  const [doorRecordId, setDoorRecordId] = useState<string | null>(null);
  const [mine, setMine] = useState<{ sales: MySale[]; checks: MyCheck[] } | null>(null);
  const [showingMine, setShowingMine] = useState(false);
  const [recording, setRecording] = useState<{ editing?: SaleToEdit | CheckToEdit } | null>(null);

  const communityDanceSeriesId = series.find((s) => s.key === "community_dance")?.id ?? null;
  const isCommunityDance = !!event && event.seriesId === communityDanceSeriesId;

  useEffect(() => {
    void apiFetch("/api/series")
      .then((r) => r.json())
      .then((d) => setSeries(d.items ?? []));
    void apiFetch("/api/me/capabilities")
      .then((r) => r.json())
      .then((d) => setMe(d.contactId ?? null));
    searchRef.current?.focus();
  }, []);

  // A different evening has its own record.
  useEffect(() => {
    setDoorRecordId(null);
    setMine(null);
    setShowingMine(false);
  }, [eventId]);

  /**
   * Open the evening's record — created if the door is the first to need it — and keep what THIS volunteer
   * recorded, for them to correct. Everyone else's entries stay with the gate (FR-027).
   */
  const loadMine = useCallback(async (): Promise<string | null> => {
    if (!eventId) return null;
    const res = doorRecordId
      ? await apiFetch(`/api/door-records/${doorRecordId}`)
      : await apiFetch(`/api/events/${eventId}/door-record`, { method: "POST" });
    if (!res.ok) {
      setMessage({ text: "Could not open the evening's record.", error: true });
      return null;
    }
    const data = (await res.json()) as {
      doorRecord: { id: string };
      gateSales: MySale[];
      checks: MyCheck[];
    };
    const ours = (r: Recorded) => !!me && r?.contactId === me;
    setDoorRecordId(data.doorRecord.id);
    setMine({
      sales: data.gateSales.filter((x) => ours(x.recordedBy)),
      checks: data.checks.filter((x) => ours(x.recordedBy)),
    });
    return data.doorRecord.id;
  }, [eventId, doorRecordId, me]);

  async function addSale() {
    if (!eventId) return setMessage({ text: "Pick an event first.", error: true });
    if (await loadMine()) setRecording({});
  }

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
          <button
            type="button"
            className={styles.button}
            disabled={!eventId}
            onClick={() => void addSale()}
          >
            Add a sale
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={!eventId}
            aria-expanded={showingMine}
            onClick={() => {
              if (!showingMine) void loadMine();
              setShowingMine((v) => !v);
            }}
          >
            Your sales and checks tonight
          </button>
        </div>

        {showingMine && mine && (
          <ul aria-label="Recorded by you tonight" className={styles.results}>
            {mine.sales.length + mine.checks.length === 0 && (
              <li className={styles.hint}>Nothing recorded by you tonight yet.</li>
            )}
            {mine.sales.map((x) => (
              <li key={x.id} className={styles.result} aria-label={x.contactName ?? label(x)}>
                <div className={styles.resultName}>
                  {x.contactName ?? label(x)} · ${x.amount.toFixed(2)} {x.paymentMethod}
                  {x.quantity ? ` · qty ${x.quantity}` : ""}
                  {x.note && <div className={styles.resultMeta}>{x.note}</div>}
                </div>
                <div className={styles.resultAction}>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => setRecording({ editing: x })}
                  >
                    Edit
                  </button>
                </div>
              </li>
            ))}
            {mine.checks.map((x) => (
              <li key={x.id} className={styles.result} aria-label={`Check from ${x.writer}`}>
                <div className={styles.resultName}>
                  Check from {x.writer} · ${x.amount.toFixed(2)}
                  {x.note && <div className={styles.resultMeta}>{x.note}</div>}
                </div>
                <div className={styles.resultAction}>
                  <button
                    type="button"
                    className={styles.button}
                    onClick={() => setRecording({ editing: x })}
                  >
                    Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

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

      {recording && doorRecordId && (
        <SaleOrCheckDialog
          doorRecordId={doorRecordId}
          canMark={false}
          editing={recording.editing}
          onSaved={() => {
            setRecording(null);
            setMessage({ text: "Recorded.", error: false });
            void loadMine();
          }}
          onClose={() => setRecording(null)}
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
