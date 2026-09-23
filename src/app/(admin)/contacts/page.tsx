"use client";
import { apiFetch } from "@/app/apiFetch";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminPage from "@/app/(admin)/_components/AdminPage";
import TriageList from "@/app/(admin)/_components/TriageList";
import RecordView from "@/app/(admin)/_components/RecordView";
import EmailEditor, { type EmailRow } from "./_components/EmailEditor";
import MessageRecipient, { type MessageRecipientRow } from "./_components/MessageRecipient";
import MembershipAccount, { type MembershipBlock } from "./_components/MembershipAccount";
import MergeHistory from "./_components/MergeHistory";
import DuplicatePair, { type DupPair, type PairPermissions } from "./_components/DuplicatePair";
import MergeCompare from "./_components/MergeCompare";
import HeldMergeChooser, {
  HOLD_REASON_TEXT,
  WAITING_TEXT,
  type HeldAuthority,
  type HeldReason,
} from "./_components/HeldMergeChooser";
import { formatPhone } from "@/server/domain/contacts/phone";
import styles from "./contacts.module.css";

type ContactSummary = {
  id: string;
  displayName: string;
  membershipStatus: string;
  listMember: boolean;
  pronouns: string | null;
  archivedAt: string | null;
  // Feature 069 (FR-001a): needs-review rows only — what the "is this complete?" judgement rests on,
  // plus the server's verdict on whether the row carries that judgement (FR-005).
  phone?: string | null;
  emails?: string[];
  createdAt?: string;
  updatedAt?: string;
  safeToClear?: boolean;
};

// Feature 065: which archive/delete controls this viewer may use (from /api/me/capabilities).
/**
 * Feature 072 (FR-018): what to tell the user the moment a merge stops. Each names the obstacle and the
 * way forward, because "held" on its own leaves them with nothing to do next.
 */
/** Feature 078: the server's reason for refusing an action, for the page to show rather than swallow. */
async function refusal(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.error?.message ? `${fallback} ${body.error.message}` : fallback;
}

const HELD_FALLBACK = "Not merged — the merge was held and is now in the review queue.";
const HELD_MESSAGE: Record<string, string> = {
  two_logins:
    "Not merged: both contacts can sign in. An officer who can assign roles must choose which sign-in " +
    "survives. It is now in the review queue.",
  two_accounts:
    "Not merged: both contacts pay for a membership account. One account must be chosen first. It is " +
    "now in the review queue.",
  role_conflict:
    "Not merged: this would give one person the authority to assign roles, or two offices that must " +
    "stay separate. An officer chooses which roles move. It is now in the review queue.",
  volunteer_status:
    "Not merged: only the contact being retired is a volunteer. An officer must decide whether the kept " +
    "contact becomes one, or its sign-in and roles would stop working. It is now in the review queue.",
  super_user:
    "Not merged: the contact being retired is a super-user and the kept one is not. Super-user can only " +
    "be granted at the command line — grant it to the kept contact there, then merge again.",
};

// Feature 069 (FR-014): a merge held because it cannot complete without a decision (M-R21).
type HeldMerge = {
  id: string;
  reason: HeldReason;
  canonicalId: string;
  canonicalDisplayName: string;
  mergedId: string;
  mergedDisplayName: string;
  // Feature 078 (research R8): the server says who can answer, so the page keeps no copy of the rules.
  answerableBy: HeldAuthority;
  canAnswer: boolean;
};

type Caps = {
  contactWrite: boolean;
  contactDelete: boolean;
  contactDeleteUnrestricted: boolean;
  contactMailingWrite: boolean;
  membershipWrite: boolean; // feature 068 (FR-017): FS/Treasurer/Super-user
  roleAssign: boolean; // feature 069 (FR-012): may choose which sign-in identity survives
  dedupWrite: boolean; // feature 074 (FR-023): may see the merge history and undo a merge
};

// Feature 063 (M-R5..M-R8): the full record behind an opened contact, fed by GET /api/contacts/:id.
type EditorRecord = {
  id: string;
  firstName: string;
  lastName: string | null;
  displayName: string;
  displayNameOverride: string | null;
  pronouns: string | null;
  phone: string | null;
  isVolunteer: boolean;
  membershipStatus: string;
  listMember: boolean;
  needsReview: boolean;
  archivedAt: string | null;
  emails: EmailRow[]; // feature 066
  // Feature 067: the household view — where this contact is reached, and who rides its address.
  messageRecipient?: MessageRecipientRow | null;
  sharedWith?: { contactId: string; displayName: string }[];
  // Feature 068: the MEMBERSHIP household — distinct from the email household above (FR-020).
  membership?: MembershipBlock;
};

// Feature 062 (M-R4): a likely-duplicate pair from the dedup engine (shape of MergeSuggestion).
// Feature 069: the row's shape moved to DuplicatePair, which is what renders it.

// Feature 064: which task is active. `none` = the uncluttered launcher (header + search + buttons only).
type View = "none" | "search" | "review" | "duplicates";

const PURPOSES = ["personal", "booking", "public_profile", "other"] as const;
const TOPICS = [
  "contra",
  "english",
  "openband",
  "special_events",
  "jane_austen_ball",
  "contact_tracing",
  "do_not_contact",
] as const;

export default function ContactsPage() {
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("none");
  const [items, setItems] = useState<ContactSummary[]>([]);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [dupPairs, setDupPairs] = useState<DupPair[]>([]);
  // Feature 069 (FR-004a): rejected pairs are revealable from the queue itself — where their absence
  // would be noticed — rather than only from somewhere Mel would have to know to look.
  const [showRejected, setShowRejected] = useState(false);
  // Feature 069 (FR-008): the pair a comparison is open on. The row answers what it can; this answers
  // the rest, and is where the retired /dedup page's link-as-shared now lives (FR-015b).
  const [comparing, setComparing] = useState<DupPair | null>(null);
  // How many pairs a rejection is hiding from the CURRENT list (FR-004a) — so the queue can say so
  // rather than silently omitting them, including when it would otherwise render as simply empty.
  const [suppressed, setSuppressed] = useState(0);
  const [dupTruncated, setDupTruncated] = useState(false);
  // Feature 069 (FR-014): the review queue renders TWO kinds of task. A held merge is not a flagged
  // contact — it is a question about a pair that someone has to answer, and often not this someone.
  const [held, setHeld] = useState<HeldMerge[]>([]);
  // Feature 078: the held merge whose chooser is open.
  const [choosing, setChoosing] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ needsReview: number; duplicates: number }>({
    needsReview: 0,
    duplicates: 0,
  });
  const [caps, setCaps] = useState<Caps>({
    contactWrite: false,
    contactDelete: false,
    contactDeleteUnrestricted: false,
    contactMailingWrite: false,
    membershipWrite: false,
    roleAssign: false,
    dedupWrite: false,
  });
  const [includeArchived, setIncludeArchived] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false); // second-step guard for the destructive action
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** Feature 086 (FR-004): a contact was named in the address and could not be opened. */
  const [arrivalError, setArrivalError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Feature 063: the opened record editor. `eOverride === ""` means Automatic (no custom name).
  const [record, setRecord] = useState<EditorRecord | null>(null);
  const [eFirst, setEFirst] = useState("");
  const [eLast, setELast] = useState("");
  const [eOverride, setEOverride] = useState("");
  const [ePronouns, setEPronouns] = useState("");
  const [ePhone, setEPhone] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  // Feature 064: the Add-contact create modal + its form state.
  const [showCreate, setShowCreate] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayNameOverride, setDisplayNameOverride] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [purposes, setPurposes] = useState<string[]>(["personal"]);
  const [topics, setTopics] = useState<string[]>(["contact_tracing"]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  // Feature 072 (FR-018): the outcome of a merge attempt, shown in the main flow — `warning`
  // above renders only inside the create-contact form, so it cannot carry this.
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);

  // Feature 064 (F1): one shared refresh so the button counts stay correct after ANY mutation, whatever
  // view triggered it.
  const refreshCounts = useCallback(async () => {
    const res = await apiFetch("/api/contacts/launcher-counts");
    if (res.ok) {
      const c = await res.json();
      setCounts({ needsReview: c.needsReview ?? 0, duplicates: c.duplicates ?? 0 });
    }
  }, []);

  const runSearch = useCallback(async (query: string, archived: boolean, withRejected = false) => {
    // Feature 065: the "+ archived" toggle includes archived contacts (marked) in the results.
    const res = await apiFetch(
      `/api/contacts?q=${encodeURIComponent(query)}${archived ? "&archived=1" : ""}`,
    );
    const data = await res.json();
    setItems(data.items ?? []);
    setSearchTruncated(!!data.truncated);
    // Feature 062 (M-R4): query-scoped duplicate pairs alongside the results (the near-dup heads-up).
    // Feature 069: the scoped list is the same queue, narrowed — so a rejection hides pairs here too, and
    // the reveal has to work here too (FR-004a).
    const dres = await apiFetch(
      `/api/dedup/suggestions?q=${encodeURIComponent(query)}${withRejected ? "&includeRejected=1" : ""}`,
    );
    const ddata = await dres.json();
    setDupPairs(ddata.pairs ?? []);
    setSuppressed(ddata.suppressed ?? 0);
    setDupTruncated(!!ddata.truncated);
  }, []);

  // Typing drives the search view; clearing the box with no active task returns to the launcher (FR-007).
  useEffect(() => {
    if (q.trim()) {
      setView("search");
      void runSearch(q, includeArchived);
    } else {
      setView((v) => (v === "search" ? "none" : v));
      setItems([]);
      setDupPairs([]);
    }
  }, [q, includeArchived, runSearch]);

  // Feature 062 (M-R3): focus-to-search on load. Feature 064: fetch only the counts on mount (no lists).
  // Feature 065: also learn which archive/delete controls to offer.
  useEffect(() => {
    searchRef.current?.focus();
    void refreshCounts();
    void (async () => {
      const res = await apiFetch("/api/me/capabilities");
      if (res.ok) {
        const c = await res.json();
        setCaps({
          contactWrite: !!c.contactWrite,
          contactDelete: !!c.contactDelete,
          contactDeleteUnrestricted: !!c.contactDeleteUnrestricted,
          contactMailingWrite: !!c.contactMailingWrite,
          membershipWrite: !!c.membershipWrite,
          roleAssign: !!c.roleAssign,
          dedupWrite: !!c.dedupWrite,
        });
      }
    })();
  }, [refreshCounts]);

  /**
   * Feature 086 (FR-003, research R1): a contact named in the address opens on arrival.
   *
   * Read straight from the address rather than through `useSearchParams` — this page is already a
   * client component that fetches everything itself, no page in the app uses that hook, and it would
   * oblige a Suspense boundary for one string. Arriving by link then converges immediately on
   * `openRecord`, the same path a clicked row takes, so an archived contact opens and shows its state
   * exactly as it does from the list.
   */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("contactId");
    if (!id) return;
    void (async () => {
      const res = await apiFetch(`/api/contacts/${id}`);
      if (!res.ok) {
        // Never the silent unfiltered list: say the request could not be met, and stay usable.
        setArrivalError("That contact could not be opened — it may have been merged or removed.");
        return;
      }
      await openRecord(id);
    })();
    // Deliberately once, on arrival, with an empty dependency list: re-running would reopen the record
    // after the viewer had closed it.
  }, []);

  // Feature 063 (FR-020): move focus into the record modal when it opens.
  useEffect(() => {
    if (record) firstFieldRef.current?.focus();
  }, [record]);

  async function openReviewQueue() {
    setQ("");
    const res = await apiFetch("/api/contacts?needsReview=1");
    const data = await res.json();
    setItems(data.items ?? []);
    setSearchTruncated(!!data.truncated);
    setDupPairs([]);
    // Held merges ride the same queue (FR-014). `dedup.write` gates the read, so a volunteer without it
    // simply sees the flagged contacts — not an error.
    const hres = await apiFetch("/api/dedup/held");
    setHeld(hres.ok ? ((await hres.json()).held ?? []) : []);
    setView("review");
  }

  async function openDuplicates(withRejected = showRejected) {
    setQ("");
    const res = await apiFetch(`/api/dedup/suggestions${withRejected ? "?includeRejected=1" : ""}`);
    const data = await res.json();
    setDupPairs(data.pairs ?? []);
    setSuppressed(data.suppressed ?? 0);
    setDupTruncated(!!data.truncated);
    setItems([]);
    setView("duplicates");
  }

  // Re-fetch whichever list is showing, so an action's effect (a cleared flag, a merged pair) is visible.
  const refreshView = useCallback(async () => {
    if (view === "search") await runSearch(q, includeArchived, showRejected);
    else if (view === "review") await openReviewQueue();
    else if (view === "duplicates") await openDuplicates();
  }, [view, q, includeArchived, showRejected, runSearch]);

  async function openRecord(id: string) {
    const res = await apiFetch(`/api/contacts/${id}`);
    if (!res.ok) return;
    const r = (await res.json()) as EditorRecord;
    setRecord(r);
    setEFirst(r.firstName);
    setELast(r.lastName ?? "");
    setEOverride(r.displayNameOverride ?? "");
    setEPronouns(r.pronouns ?? "");
    // Feature 063 (FR-019): show the human-readable phone; Save re-canonicalizes via normalizePhone.
    setEPhone(r.phone ? formatPhone(r.phone) : "");
    setSaveError(null);
    setConfirmDelete(false);
    setDeleteError(null);
  }

  // Feature 065: archive / restore / delete, all closing the editor and refreshing the view + counts.
  async function archiveOrRestore(path: "archive" | "restore") {
    if (!record) return;
    const res = await apiFetch(`/api/contacts/${record.id}/${path}`, { method: "POST" });
    if (!res.ok) return;
    setRecord(null);
    await refreshView();
    await refreshCounts();
    searchRef.current?.focus();
  }

  async function deleteRecord(force: boolean) {
    if (!record) return;
    setDeleteError(null);
    const res = await apiFetch(`/api/contacts/${record.id}${force ? "?force=1" : ""}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setDeleteError(b?.error?.message ?? "Could not delete contact.");
      setConfirmDelete(false);
      return; // refusal (e.g. has references) — the reason is shown; the record stays open
    }
    setRecord(null);
    await refreshView();
    await refreshCounts();
    searchRef.current?.focus();
  }

  function closeRecord() {
    setRecord(null);
    searchRef.current?.focus();
  }

  async function saveRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!record) return;
    setSaveError(null);
    if (!eFirst.trim()) {
      setSaveError("First name is required.");
      return;
    }
    const body: Record<string, unknown> = {
      firstName: eFirst.trim(),
      lastName: eLast.trim() ? eLast.trim() : null,
      displayNameOverride: eOverride.trim() ? eOverride.trim() : null,
      pronouns: ePronouns.trim() ? ePronouns.trim() : null,
      phone: ePhone.trim() ? ePhone.trim() : null,
    };
    // is_volunteer is NOT edited here (M-R7); the endpoint guards it. `needs_review` may auto-clear
    // server-side when the record now has contact data (feature 064 / FR-012).
    const res = await apiFetch(`/api/contacts/${record.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setSaveError(b?.error?.message ?? "Failed to save contact");
      return;
    }
    setRecord(null);
    await refreshView(); // reflect an auto-cleared review flag (F2) etc.
    await refreshCounts(); // F1
    searchRef.current?.focus();
  }

  async function markReviewed() {
    if (!record) return;
    const res = await apiFetch(`/api/contacts/${record.id}/reviewed`, { method: "POST" });
    if (!res.ok) return;
    setRecord(null);
    await refreshView(); // the contact leaves the review queue (F2)
    await refreshCounts(); // F1
    searchRef.current?.focus();
  }

  // Feature 069 (FR-005): the same action `markReviewed` performs from inside the record, taken from the
  // row — offered only when the server says the row already shows what the judgement rests on.
  async function clearReview(id: string) {
    const res = await apiFetch(`/api/contacts/${id}/reviewed`, { method: "POST" });
    if (!res.ok) return;
    await refreshView();
    await refreshCounts();
  }

  // Feature 078: what the person may do with a suggested pair — the server's own rules, as capabilities.
  const pairPermissions: PairPermissions = {
    merge: caps.dedupWrite,
    share: caps.contactMailingWrite,
    seeHolds: caps.dedupWrite || caps.roleAssign,
  };

  async function merge(canonicalId: string, mergedId: string) {
    setComparing(null);
    setMergeNotice(null);
    const res = await apiFetch("/api/dedup/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canonicalId, mergedId }),
    });
    // Feature 078: a refused merge used to return here with nothing on screen — found when a President's
    // merge was refused and the page simply did nothing.
    if (!res.ok) return void setMergeNotice(await refusal(res, "Not merged."));
    // Feature 072 (FR-018): a HELD merge is a 200 carrying `outcome: "held"`. Treating every 200 as
    // success meant the list silently refreshed and the user saw nothing — they learned the merge had
    // stopped only by later noticing an item in the review queue. Say so at the moment it happens.
    const body = await res.json().catch(() => null);
    if (body?.outcome === "held") {
      setMergeNotice(HELD_MESSAGE[String(body.reason)] ?? HELD_FALLBACK);
    }
    await refreshView(); // the pair leaves the current list
    await refreshCounts(); // F1 — from search OR duplicates view
    searchRef.current?.focus();
  }

  // Feature 072 (FR-017): withdraw a held merge. Not the same as deciding the pair are different people
  // — that is "not duplicates", with its own record. This just says "leave them alone for now", changes
  // nothing, and is available to whoever could attempt the merge.
  async function abandonHeld(id: string) {
    const res = await apiFetch(`/api/dedup/held/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setMergeNotice(null);
    await refreshView();
    await refreshCounts();
  }

  // Feature 069 (M-R18). "Not duplicates" is a decision, not a dismissal: it is recorded with the two
  // names as they stand, and lapses on its own when either changes (FR-003a) — so the pair returns if the
  // reason it was rejected stops holding.
  async function rejectPair(contactAId: string, contactBId: string, undo = false) {
    const res = await apiFetch("/api/dedup/rejections", {
      method: undo ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactAId, contactBId }),
    });
    if (!res.ok) return void setMergeNotice(await refusal(res, "Could not change that pair."));
    await refreshView();
    await refreshCounts();
  }

  async function toggleRejected() {
    const next = !showRejected;
    setShowRejected(next);
    // The reveal belongs to whichever list is on screen — the scoped one is the same queue, narrowed.
    if (view === "search") await runSearch(q, includeArchived, next);
    else await openDuplicates(next);
  }

  async function createContact(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWarning(null);
    const hasContactInfo = address.trim() || phone.trim();
    const res = await apiFetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName,
        ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
        ...(displayNameOverride.trim() ? { displayNameOverride: displayNameOverride.trim() } : {}),
        ...(pronouns.trim() ? { pronouns: pronouns.trim() } : {}),
        ...(address.trim() ? { email: { address, purposes, consentTopics: topics } } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to create contact");
      return;
    }
    if (!hasContactInfo) {
      setWarning("Contact created with no email or phone on file — flagged for follow-up.");
    }
    setFirstName("");
    setLastName("");
    setDisplayNameOverride("");
    setPronouns("");
    setAddress("");
    setPhone("");
    setPurposes(["personal"]);
    setTopics(["contact_tracing"]);
    setShowCreate(false);
    await refreshView(); // FR-008
    await refreshCounts(); // F1 — a no-info contact raises the needs-review count
  }

  function toggle(list: string[], value: string, set: (v: string[]) => void) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  const showList = view === "search" || view === "review";
  // Search shows pairs only when there are some (a quiet heads-up); the duplicates task always shows the
  // section (with an empty state) since that IS the task.
  const showPairs =
    view === "duplicates" || (view === "search" && (dupPairs.length > 0 || suppressed > 0));

  return (
    <AdminPage title="Contacts">
      {/* Launcher: search + a row of task buttons with live counts. Nothing else until Mel chooses. */}
      <section className={styles.section}>
        <input
          ref={searchRef}
          className={styles.search}
          placeholder="Search by name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {arrivalError && <p role="status">{arrivalError}</p>}
        <div className={styles.taskRow}>
          <button type="button" className={styles.button} onClick={() => setShowCreate(true)}>
            Add contact
          </button>
          <button type="button" className={styles.taskButton} onClick={openReviewQueue}>
            Review queue ({counts.needsReview})
          </button>
          <button
            type="button"
            className={styles.taskButton}
            onClick={() => {
              setShowRejected(false);
              void openDuplicates(false);
            }}
          >
            Review duplicates ({counts.duplicates})
          </button>
          {/* Feature 065: compact toggle to include archived contacts in the search results. */}
          <button
            type="button"
            className={styles.taskButton}
            aria-pressed={includeArchived}
            onClick={() => setIncludeArchived((v) => !v)}
          >
            + archived
          </button>
        </div>
      </section>

      {/* Single-contact list — the search results or the needs-review queue. Rows open the editor. */}
      {showList && (
        <section className={styles.section}>
          <TriageList
            items={items}
            getKey={(c) => c.id}
            rowLabel={(c) => c.displayName}
            onOpen={(c) => void openRecord(c.id)}
            renderRow={(c) => (
              <span className={styles.rowText}>
                <span className={styles.rowName}>
                  {c.displayName}
                  {c.pronouns ? ` (${c.pronouns})` : ""}
                </span>
                <span className={styles.rowMeta}>
                  {c.membershipStatus}
                  {c.archivedAt ? " · archived" : ""}
                </span>
                {/* Feature 069 (FR-001a): the review queue shows what the decision depends on. */}
                {view === "review" && (
                  <span className={styles.rowMeta}>
                    {c.emails?.length ? c.emails.join(", ") : "no email"} ·{" "}
                    {c.phone ? formatPhone(c.phone) : "no phone"} · created{" "}
                    {(c.createdAt ?? "").slice(0, 10)}
                  </span>
                )}
              </span>
            )}
            rowActions={
              view === "review"
                ? (c) =>
                    c.safeToClear ? (
                      <button
                        type="button"
                        className={styles.dupButton}
                        onClick={() => void clearReview(c.id)}
                      >
                        Clear
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.dupButton}
                        onClick={() => void openRecord(c.id)}
                      >
                        Open to resolve
                      </button>
                    )
                : undefined
            }
            emptyState={
              <span className={styles.empty}>
                {view === "review" ? "No contacts need review" : "No contacts"}
              </span>
            }
          />
          {/* Feature 069 (FR-014): held merges, visibly NOT ordinary clean-up. Mel can see one, and can
              see it is not hers to finish — the resolve action appears only for whoever may act. */}
          {view === "review" && held.length > 0 && (
            <ul className={styles.dupList}>
              {held.map((h) => (
                <li
                  key={h.id}
                  className={styles.heldRow}
                  aria-label={`Held merge: ${h.canonicalDisplayName} and ${h.mergedDisplayName}`}
                >
                  <div className={styles.dupBody}>
                    <div className={styles.dupName}>
                      Merge held — {h.canonicalDisplayName} and {h.mergedDisplayName}
                    </div>
                    {/* Feature 078: one explanation per reason, shared with the chooser. */}
                    <p className={styles.dupHousehold}>{HOLD_REASON_TEXT[h.reason]}</p>
                  </div>
                  <span className={styles.dupActions}>
                    {/* Feature 078 (FR-001, FR-006): every hold opens its chooser. Whoever can answer
                        gets Resolve; anyone else can still View what is being decided. */}
                    {h.canAnswer ? (
                      <button
                        type="button"
                        className={styles.dupButton}
                        onClick={() => setChoosing(h.id)}
                      >
                        Resolve
                      </button>
                    ) : (
                      <>
                        <em className={styles.dupHousehold}>{WAITING_TEXT[h.answerableBy]}</em>
                        <button
                          type="button"
                          className={styles.dupButton}
                          onClick={() => setChoosing(h.id)}
                        >
                          View
                        </button>
                      </>
                    )}
                    {/* FR-017: always available to whoever could attempt the merge — otherwise the queue
                        fills with items the person working it has no way to clear. */}
                    <button
                      type="button"
                      className={styles.dupButton}
                      onClick={() => void abandonHeld(h.id)}
                    >
                      Don&apos;t merge
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {searchTruncated && (
            <p className={styles.hint}>More matches — refine your search to narrow the list.</p>
          )}
        </section>
      )}

      {/* Feature 072 (FR-018): why a merge did not complete, said at the moment it happens. */}
      {choosing && (
        <HeldMergeChooser
          holdId={choosing}
          onClose={() => setChoosing(null)}
          onDone={async (message) => {
            setChoosing(null);
            setMergeNotice(message);
            await refreshView();
            await refreshCounts();
          }}
        />
      )}
      {mergeNotice && (
        <p role="status" className={styles.warning}>
          {mergeNotice}
        </p>
      )}

      {/* Potential duplicates — query-scoped alongside search, or the global queue via the button. */}
      {showPairs && (
        <section className={styles.section}>
          <h2 className={styles.h2}>Potential duplicates</h2>
          {(suppressed > 0 || showRejected) && (
            <button type="button" className={styles.dupButton} onClick={toggleRejected}>
              {showRejected ? "Hide rejected" : `Show rejected (${suppressed})`}
            </button>
          )}
          {dupTruncated && (
            <p className={styles.empty}>
              Showing the {dupPairs.length} closest matches — narrow with a search to see the rest.
            </p>
          )}
          {dupPairs.length === 0 ? (
            <p className={styles.empty}>No potential duplicates</p>
          ) : (
            <ul className={styles.dupList}>
              {dupPairs.map((p) => (
                <DuplicatePair
                  key={`${p.a.id}-${p.b.id}`}
                  pair={p}
                  onReject={() => rejectPair(p.a.id, p.b.id)}
                  onUndoReject={() => rejectPair(p.a.id, p.b.id, true)}
                  onOpen={(id) => void openRecord(id)}
                  onCompare={() => setComparing(p)}
                  onMerge={(canonicalId, mergedId) => void merge(canonicalId, mergedId)}
                  onOpenHold={setChoosing}
                  permissions={pairPermissions}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Feature 069 (FR-008): the comparison a pair opens — the three answers to one question. */}
      {comparing && (
        <MergeCompare
          pair={comparing}
          onClose={() => setComparing(null)}
          onMerged={(canonicalId, mergedId) => merge(canonicalId, mergedId)}
          permissions={pairPermissions}
          onOpenHold={(id) => {
            setComparing(null);
            setChoosing(id);
          }}
          onRejected={async () => {
            const p = comparing;
            setComparing(null);
            await rejectPair(p.a.id, p.b.id);
          }}
        />
      )}

      {/* Record editor modal (feature 063) — opened from a result/queue row. */}
      {record && (
        <div className={styles.backdrop}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={record.displayName}
            className={styles.modalPanel}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeRecord();
            }}
          >
            <RecordView
              title={
                /* Feature 086 (FR-003): an archived record says so on its face. Until now the only
                   sign was the Restore button, which is gated on `contact.write` — so a viewer who
                   could not restore could not tell. The state is a fact, not a control. */
                record.archivedAt ? `${record.displayName} · archived` : record.displayName
              }
              actions={
                <>
                  {record.needsReview && (
                    <button type="button" className={styles.button} onClick={markReviewed}>
                      Mark reviewed
                    </button>
                  )}
                  {/* Feature 065: archive/restore (reversible) and delete (confirmed, gated). */}
                  {caps.contactWrite &&
                    (record.archivedAt ? (
                      <button
                        type="button"
                        className={styles.button}
                        onClick={() => archiveOrRestore("restore")}
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.button}
                        onClick={() => archiveOrRestore("archive")}
                      >
                        Archive
                      </button>
                    ))}
                  {caps.contactDelete &&
                    (confirmDelete ? (
                      <button
                        type="button"
                        className={styles.dangerButton}
                        onClick={() => deleteRecord(false)}
                      >
                        Confirm delete
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.dangerButton}
                        onClick={() => setConfirmDelete(true)}
                      >
                        Delete
                      </button>
                    ))}
                  <button type="button" className={styles.button} onClick={closeRecord}>
                    Cancel
                  </button>
                </>
              }
            >
              {/* Feature 065: a refused safe delete explains why (references) and, for a super-user,
                  offers the unrestricted override. Rendered FIRST, directly under the action row — it
                  used to sit below the read-only context list, i.e. below the fold on a scrolling
                  modal, so Mel pressed Confirm delete and appeared to get no response at all. */}
              {deleteError && (
                <div className={styles.error}>
                  <p>{deleteError}</p>
                  {caps.contactDeleteUnrestricted && (
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => deleteRecord(true)}
                    >
                      Force delete (super-user)
                    </button>
                  )}
                </div>
              )}
              <form onSubmit={saveRecord} className={styles.form}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>First name</span>
                  <input
                    ref={firstFieldRef}
                    className={styles.input}
                    value={eFirst}
                    onChange={(e) => setEFirst(e.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Last name</span>
                  <input
                    className={styles.input}
                    value={eLast}
                    onChange={(e) => setELast(e.target.value)}
                  />
                </label>
                {(() => {
                  const isCustom = eOverride.trim() !== "";
                  const autoName = `${eFirst.trim()} ${eLast.trim()}`.trim();
                  return (
                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor="edit-display-name">
                        Display name
                      </label>
                      <div className={styles.nameControl}>
                        <input
                          id="edit-display-name"
                          className={styles.input}
                          value={isCustom ? eOverride : autoName}
                          readOnly={!isCustom}
                          onChange={(e) => setEOverride(e.target.value)}
                        />
                        <button
                          type="button"
                          className={styles.button}
                          onClick={() => setEOverride(isCustom ? "" : autoName)}
                        >
                          {isCustom ? "Reset to automatic" : "Set custom name"}
                        </button>
                      </div>
                    </div>
                  );
                })()}
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Pronouns</span>
                  <input
                    className={styles.input}
                    value={ePronouns}
                    onChange={(e) => setEPronouns(e.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Phone</span>
                  <input
                    className={styles.input}
                    value={ePhone}
                    onChange={(e) => setEPhone(e.target.value)}
                  />
                </label>
                <button type="submit" className={styles.button}>
                  Save
                </button>
                {saveError && <p className={styles.error}>{saveError}</p>}
              </form>
              <div className={styles.flags}>
                <span className={styles.flag}>
                  Volunteer: <strong>{record.isVolunteer ? "Yes" : "No"}</strong>
                </span>
                <span className={styles.flag}>
                  On mailing list: <strong>{record.listMember ? "Yes" : "No"}</strong>
                </span>
                <span className={styles.flag}>
                  Needs review: <strong>{record.needsReview ? "Yes" : "No"}</strong>
                </span>
              </div>
              <dl className={styles.context}>
                <div>
                  <dt>Membership</dt>
                  <dd>{record.membershipStatus}</dd>
                </div>
              </dl>
              {/* Feature 066: the contact's emails, editable below the scalar fields. */}
              {caps.contactMailingWrite && (
                <EmailEditor
                  key={record.id}
                  contactId={record.id}
                  emails={record.emails ?? []}
                  canDeleteUnrestricted={caps.contactDeleteUnrestricted}
                  onChanged={() => openRecord(record.id)}
                />
              )}
              {/* Feature 068 (FR-018/FR-019/FR-020): the MEMBERSHIP household. Rendered as its own block,
                  labelled and styled apart from the shared-email block below — they overlap often and are
                  different facts. Write controls need membership authority (FR-017), which Mel lacks. */}
              {record.membership && (
                <MembershipAccount
                  key={`ma-${record.id}`}
                  contactId={record.id}
                  membership={record.membership}
                  canWrite={caps.membershipWrite}
                  onChanged={() => openRecord(record.id)}
                />
              )}
              {/* Feature 074 (FR-026): the merges that produced this record, each with an honest
                  verdict on whether it can still be undone. Only shown to a duplicate-management
                  holder, since that is who may act on it. */}
              {caps.dedupWrite && (
                <MergeHistory
                  key={`mh-${record.id}`}
                  contactId={record.id}
                  onChanged={() => openRecord(record.id)}
                />
              )}
              {(record.messageRecipient || (record.sharedWith ?? []).length > 0) && (
                <MessageRecipient
                  key={`mr-${record.id}`}
                  contactId={record.id}
                  messageRecipient={record.messageRecipient ?? null}
                  sharedWith={record.sharedWith ?? []}
                  hasOwnActiveEmail={(record.emails ?? []).some((e) => e.status === "active")}
                  canWrite={caps.contactMailingWrite}
                  onChanged={() => openRecord(record.id)}
                />
              )}
            </RecordView>
          </div>
        </div>
      )}

      {/* Add-contact modal (feature 064) — the create form, no longer always-visible. */}
      {showCreate && (
        <div className={styles.backdrop}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add contact"
            className={styles.modalPanel}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowCreate(false);
            }}
          >
            <RecordView
              title="Add contact"
              actions={
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </button>
              }
            >
              <form onSubmit={createContact} className={styles.form}>
                <input
                  className={styles.input}
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
                <input
                  className={styles.input}
                  placeholder="Last name (optional)"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
                <input
                  className={styles.input}
                  placeholder="Display name override (optional)"
                  value={displayNameOverride}
                  onChange={(e) => setDisplayNameOverride(e.target.value)}
                />
                <input
                  className={styles.input}
                  placeholder="Pronouns (optional)"
                  value={pronouns}
                  onChange={(e) => setPronouns(e.target.value)}
                />
                <input
                  className={styles.input}
                  placeholder="Email address (optional)"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
                <input
                  className={styles.input}
                  placeholder="Phone (optional)"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <fieldset className={styles.fieldset}>
                  <legend>Purposes</legend>
                  {PURPOSES.map((p) => (
                    <label key={p} className={styles.check}>
                      <input
                        type="checkbox"
                        checked={purposes.includes(p)}
                        onChange={() => toggle(purposes, p, setPurposes)}
                      />{" "}
                      {p}
                    </label>
                  ))}
                </fieldset>
                <fieldset className={styles.fieldset}>
                  <legend>Consent topics</legend>
                  {TOPICS.map((t) => (
                    <label key={t} className={styles.check}>
                      <input
                        type="checkbox"
                        checked={topics.includes(t)}
                        onChange={() => toggle(topics, t, setTopics)}
                      />{" "}
                      {t}
                    </label>
                  ))}
                </fieldset>
                <button type="submit" className={styles.button}>
                  Create
                </button>
                {error && <p className={styles.error}>{error}</p>}
                {warning && <p className={styles.warning}>{warning}</p>}
              </form>
            </RecordView>
          </div>
        </div>
      )}
    </AdminPage>
  );
}
