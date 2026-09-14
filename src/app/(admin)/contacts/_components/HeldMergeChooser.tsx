"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import RecordView from "@/app/(admin)/_components/RecordView";
import styles from "../contacts.module.css";

export type HeldReason =
  | "two_logins"
  | "two_accounts"
  | "role_conflict"
  | "volunteer_status"
  | "super_user";
export type HeldAuthority = "dedup.write" | "role.assign" | "command_line";

export type HeldDetail = {
  id: string;
  reason: HeldReason;
  canonical: { id: string; displayName: string };
  merged: { id: string; displayName: string };
  answerableBy: HeldAuthority;
  canAnswer: boolean;
  answered: HeldReason[];
  candidates: unknown;
  stale?: string;
};

/** One contact's sign-in, whole: the address that labels it and the Google account that grants it. */
export type SignInCandidate = {
  contactId: string;
  contactDisplayName: string;
  loginEmailId: string | null;
  loginEmail: string | null;
  identityId: string | null;
  lastSignInAt: string | null;
};

/** One of the merged contact's roles; `conflict` says why it is contested, when it is. */
export type GrantCandidate = {
  grantId: string;
  role: string;
  scope: string;
  conflict: "role_assign" | "exclusive" | null;
};

/** The approval a volunteer carry brings across. */
export type VolunteerCandidate = { approvedAt: string | null; approvedBy: string | null };

/** A membership account on either side of a `two_accounts` hold. */
export type AccountCandidate = {
  accountId: string;
  payerDisplayName: string;
  level: string;
  expiryDate: string | null;
  lastPaymentDate: string | null;
  members: string[];
};

/** A held merge's answer: exactly one kind, for the hold's current reason (the server keeps the rest). */
export type HeldAnswer =
  | { survivingAccountId: string }
  | { survivingIdentityId?: string; survivingLoginEmailId?: string }
  | { keepGrantIds: string[] }
  | { carryVolunteer: true };

/**
 * Feature 078: why each hold stopped, in Mel's words. Shared by the review-queue row and the chooser, so the
 * two never explain the same hold differently.
 */
export const HOLD_REASON_TEXT: Record<HeldReason, string> = {
  two_logins:
    "Both contacts sign in. Someone who can assign roles must choose which sign-in survives before these can be merged.",
  two_accounts:
    "Both contacts pay for a membership account. One account must be chosen before these can be merged.",
  role_conflict:
    "Merging these would give one person the authority to assign roles, or two offices that must stay separate. An officer chooses which of the merged contact's roles move.",
  volunteer_status:
    "Only one of these contacts is a volunteer. Merging them would make the kept contact a volunteer, which lets it sign in — an officer must decide.",
  super_user:
    "One of these contacts is a super-user. Super-user can only be granted at the command line, so this merge cannot be completed here.",
};

/** What each recorded answer decided — for "already decided". */
const DECIDED_TEXT: Record<HeldReason, string> = {
  two_logins: "which sign-in survives",
  two_accounts: "which membership account survives",
  role_conflict: "which roles move",
  volunteer_status: "that volunteer status is carried across",
  super_user: "super-user access",
};

/** Who a hold waits on, when this person cannot answer it. */
export const WAITING_TEXT: Record<HeldAuthority, string> = {
  "dedup.write": "Waiting on the mailing-list manager.",
  "role.assign": "Waiting on an officer who can assign roles.",
  command_line: "Waiting on the command line — no one can answer this in the app.",
};

/**
 * Feature 078 (FR-001 to FR-010): one chooser for every held merge.
 *
 * It asks the hold's actual question, as it stands now, and says who can answer it. Someone who cannot
 * answer still sees what is being decided and can decline. Before this, Resolve only opened a contact
 * record — so the only thing anyone could do with a held merge was decline it, even when the decision was
 * theirs.
 */
export default function HeldMergeChooser({
  holdId,
  onClose,
  onDone,
}: {
  holdId: string;
  onClose: () => void;
  /** The hold is finished — merged, or declined. The message says which, for the page to show. */
  onDone: (message: string) => void | Promise<void>;
}) {
  const [detail, setDetail] = useState<HeldDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The page passes a fresh `onDone` on every render; holding it in a ref keeps `load` stable, so a page
  // re-render never re-fetches the hold.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/dedup/held/${holdId}`);
    if (!res.ok) {
      // The hold was answered, declined or closed itself since the queue was loaded.
      await onDoneRef.current("That held merge is no longer waiting.");
      return;
    }
    setDetail((await res.json()) as HeldDetail);
  }, [holdId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function answer(body: HeldAnswer) {
    if (!detail) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch(`/api/dedup/held/${holdId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        // FR-010: a stale answer is dropped server-side; show why and ask the question again as it now is.
        setMessage(payload?.error?.message ?? "That answer could not be applied.");
        await load();
        return;
      }
      if (payload?.outcome === "completed") {
        await onDoneRef.current(
          `Merged: kept ${detail.canonical.displayName}, retired ${detail.merged.displayName}.`,
        );
        return;
      }
      // FR-008: held for the next decision — the same hold, now asking its next question.
      setMessage("Answer recorded. This merge needs one more decision before it can complete.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/dedup/held/${holdId}`, { method: "DELETE" });
      if (res.ok) await onDoneRef.current("Not merged — the held merge was withdrawn.");
    } finally {
      setBusy(false);
    }
  }

  const label = detail
    ? `Held merge: ${detail.canonical.displayName} and ${detail.merged.displayName}`
    : "Held merge";

  return (
    <div className={styles.backdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={styles.modalPanel}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <RecordView title="Held merge">
          {!detail ? (
            <p className={styles.rowMeta}>Loading…</p>
          ) : (
            <>
              <p className={styles.dupName}>
                Keep {detail.canonical.displayName}, retire {detail.merged.displayName}
              </p>
              <p className={styles.dupHousehold}>{HOLD_REASON_TEXT[detail.reason]}</p>

              {detail.answered.length > 0 && (
                <p className={styles.rowMeta}>
                  Already decided: {detail.answered.map((r) => DECIDED_TEXT[r]).join("; ")}.
                </p>
              )}

              {message && <p className={styles.warning}>{message}</p>}

              {/* FR-006: someone who cannot answer still sees what is being decided — read-only. */}
              <AnswerPanel
                detail={detail}
                busy={busy}
                readOnly={!detail.canAnswer}
                onAnswer={answer}
              />
              {!detail.canAnswer && (
                <p className={styles.hint}>
                  <em>{WAITING_TEXT[detail.answerableBy]}</em>
                </p>
              )}

              {/* FR-007: say the safety net exists BEFORE the decision, as the queue row already does. */}
              <p className={styles.hint}>
                Whatever is decided, the merge can be undone afterwards from the kept contact&apos;s
                merge history.
              </p>
            </>
          )}

          <div className={styles.dupActions}>
            <button
              type="button"
              className={styles.dupButton}
              disabled={busy}
              onClick={() => void decline()}
            >
              Don&apos;t merge
            </button>
            <button type="button" className={styles.dupButton} onClick={onClose}>
              Close
            </button>
          </div>
        </RecordView>
      </div>
    </div>
  );
}

type PanelProps = {
  busy: boolean;
  /** FR-006: shown to someone who cannot answer — every control disabled, no confirm button. */
  readOnly: boolean;
  onAnswer: (answer: HeldAnswer) => void | Promise<void>;
};

/** The answer controls for the hold's reason. */
function AnswerPanel({ detail, ...props }: PanelProps & { detail: HeldDetail }) {
  switch (detail.reason) {
    case "super_user":
      // FR-015: no answer control for anyone. The instruction is the way forward; Don't merge the way out.
      return (
        <p className={styles.warning}>
          {(detail.candidates as { instruction: string }).instruction}
        </p>
      );
    case "volunteer_status":
      return (
        <VolunteerPanel
          keptName={detail.canonical.displayName}
          volunteer={detail.candidates as VolunteerCandidate}
          {...props}
        />
      );
    case "two_accounts":
      return <AccountsPanel accounts={detail.candidates as AccountCandidate[]} {...props} />;
    case "two_logins":
      return <SignInsPanel signIns={detail.candidates as SignInCandidate[]} {...props} />;
    case "role_conflict":
      return <RolesPanel grants={detail.candidates as GrantCandidate[]} {...props} />;
  }
}

/**
 * FR-011: whether the merge may make the kept contact a volunteer. It is a yes-or-decline question: the
 * only other answer is not to merge, which **Don't merge** already gives.
 */
function VolunteerPanel({
  keptName,
  volunteer,
  busy,
  readOnly,
  onAnswer,
}: PanelProps & { keptName: string; volunteer: VolunteerCandidate }) {
  return (
    <>
      <p className={styles.rowMeta}>
        {volunteer.approvedAt
          ? `Volunteer approval carried across: ${volunteer.approvedAt.slice(0, 10)}${
              volunteer.approvedBy ? `, by ${volunteer.approvedBy}` : ""
            }.`
          : "The merged contact's volunteer status has not been approved yet."}
      </p>
      <p className={styles.hint}>
        {`Completing this merge makes ${keptName} a volunteer, so the sign-in and roles moving to it keep working.`}
      </p>
      {!readOnly && (
        <div className={styles.dupActions}>
          <button
            type="button"
            className={styles.dupButton}
            disabled={busy}
            onClick={() => void onAnswer({ carryVolunteer: true })}
          >
            Carry volunteer status and merge
          </button>
        </div>
      )}
    </>
  );
}

function ConfirmButton({
  busy,
  disabled,
  onClick,
}: {
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className={styles.dupActions}>
      <button
        type="button"
        className={styles.dupButton}
        disabled={busy || disabled}
        onClick={onClick}
      >
        Confirm and merge
      </button>
    </div>
  );
}

const WHY_CONFLICTS: Record<NonNullable<GrantCandidate["conflict"]>, string> = {
  role_assign: "would give the kept contact the authority to assign roles",
  exclusive: "would put two offices that must stay separate on one person",
};

/**
 * FR-003: which sign-in survives. A sign-in is chosen WHOLE — one contact's address and Google account
 * together — because pairing one contact's address with the other's account is exactly the half-answer
 * feature 069 gave, which left the unchosen account still granting access.
 */
function SignInsPanel({
  signIns,
  busy,
  readOnly,
  onAnswer,
}: PanelProps & { signIns: SignInCandidate[] }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const pick = signIns.find((c) => c.contactId === chosen);
  return (
    <>
      <fieldset className={styles.fieldset} disabled={readOnly}>
        <legend>Which sign-in survives?</legend>
        {signIns.map((c) => (
          <div key={c.contactId}>
            <label>
              <input
                type="radio"
                name="survivingSignIn"
                value={c.contactId}
                checked={chosen === c.contactId}
                aria-describedby={`signin-${c.contactId}`}
                onChange={() => setChosen(c.contactId)}
              />{" "}
              {`${c.contactDisplayName}'s sign-in`}
            </label>
            <p id={`signin-${c.contactId}`} className={styles.rowMeta}>
              {c.loginEmail ?? "No sign-in address"}
              <br />
              {c.identityId
                ? `Google account bound · last signed in ${c.lastSignInAt ? c.lastSignInAt.slice(0, 10) : "never"}`
                : "No Google account bound yet"}
            </p>
          </div>
        ))}
      </fieldset>
      <p className={styles.hint}>
        The sign-in not chosen is discarded: its Google account can no longer sign in to this
        contact.
      </p>
      {!readOnly && (
        <ConfirmButton
          busy={busy}
          disabled={!pick}
          onClick={() =>
            pick &&
            void onAnswer({
              ...(pick.loginEmailId ? { survivingLoginEmailId: pick.loginEmailId } : {}),
              ...(pick.identityId ? { survivingIdentityId: pick.identityId } : {}),
            })
          }
        />
      )}
    </>
  );
}

/**
 * FR-004: which of the merged contact's roles move. Every role is listed; an uncontested one starts ticked,
 * because the answer names every role that moves and an unticked one is dropped. A contested one starts
 * unticked — moving it is the decision the hold exists for.
 */
function RolesPanel({
  grants,
  busy,
  readOnly,
  onAnswer,
}: PanelProps & { grants: GrantCandidate[] }) {
  const [keep, setKeep] = useState<Set<string>>(
    () => new Set(grants.filter((g) => g.conflict === null).map((g) => g.grantId)),
  );
  const toggle = (id: string) =>
    setKeep((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <>
      <fieldset className={styles.fieldset} disabled={readOnly}>
        <legend>Which of the merged contact&apos;s roles move to the kept contact?</legend>
        <ul>
          {grants.map((g) => (
            <li key={g.grantId}>
              <label>
                <input
                  type="checkbox"
                  checked={keep.has(g.grantId)}
                  onChange={() => toggle(g.grantId)}
                />{" "}
                {`${g.role.replace(/_/g, " ")} (${g.scope})`}
              </label>
              {g.conflict && (
                <span className={styles.warning}>{` — ${WHY_CONFLICTS[g.conflict]}`}</span>
              )}
            </li>
          ))}
        </ul>
      </fieldset>
      <p className={styles.hint}>
        Roles not ticked stay behind and end with the merged contact. Moving none is allowed.
      </p>
      {!readOnly && (
        <ConfirmButton busy={busy} onClick={() => void onAnswer({ keepGrantIds: [...keep] })} />
      )}
    </>
  );
}

/**
 * FR-002: which membership account survives. Each account is shown in full — level, dates, who is on it —
 * because two accounts for one person usually differ only there, and the choice deletes the other.
 */
function AccountsPanel({
  accounts,
  busy,
  readOnly,
  onAnswer,
}: PanelProps & { accounts: AccountCandidate[] }) {
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <>
      <fieldset className={styles.fieldset} disabled={readOnly}>
        <legend>Which membership account survives?</legend>
        {accounts.map((a) => (
          <div key={a.accountId}>
            <label>
              <input
                type="radio"
                name="survivingAccount"
                value={a.accountId}
                checked={chosen === a.accountId}
                aria-describedby={`account-${a.accountId}`}
                onChange={() => setChosen(a.accountId)}
              />{" "}
              {`${a.payerDisplayName}'s account`}
            </label>
            <p id={`account-${a.accountId}`} className={styles.rowMeta}>
              {`${a.level} · expires ${a.expiryDate ?? "—"} · last paid ${a.lastPaymentDate ?? "never"}`}
              <br />
              {`Members: ${a.members.length > 0 ? a.members.join(", ") : "none"}`}
            </p>
          </div>
        ))}
      </fieldset>
      <p className={styles.hint}>
        The account not chosen is deleted; everyone on it moves to the chosen account.
      </p>
      {!readOnly && (
        <ConfirmButton
          busy={busy}
          disabled={!chosen}
          onClick={() => chosen && void onAnswer({ survivingAccountId: chosen })}
        />
      )}
    </>
  );
}
