"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import RecordView from "@/app/(admin)/_components/RecordView";
import { formatPhone } from "@/server/domain/contacts/phone";
import type { DupContact, DupPair, PairPermissions } from "./DuplicatePair";
import styles from "../contacts.module.css";
import ContactName from "@/app/_components/ContactName";

type EmailRow = { id: string; email: string; status: string };
type FullRecord = { id: string; displayName: string; emails: EmailRow[] };

/**
 * Feature 067 (FR-019), carried across from the retired `/dedup` page by feature 069 (FR-015b).
 *
 * This queue pairs on NAME similarity and knows nothing about addresses, so a pair here is NOT evidence
 * of a household — the near-identical names that reach it (a father and son) are exactly where adopting
 * the wrong address is plausible. So the address being adopted is named, and anything being given up is
 * named, before the write happens.
 */
type PendingShare = {
  referrerId: string;
  referrerName: string;
  ownerName: string;
  emailId: string;
  address: string;
  retireEmailId?: string;
  retireAddress?: string;
};

const activeEmail = (r: FullRecord | undefined): EmailRow | undefined =>
  r?.emails?.find((e) => e.status === "active");

/**
 * Feature 069 (FR-008). A pair opens a COMPARISON of the two records — not an inline field-by-field
 * merge. The row already answered everything it could; what is left is the part that needs the records,
 * so this shows them: every address each contact holds **whatever its status** (FR-009), because a
 * retired or bouncing address is exactly the evidence the row withheld.
 *
 * One question — "are these one person?" — with three answers (FR-015a). Merge is one of them, not the
 * default: it retires a contact, and is styled so it cannot be mistaken for an equal-weight peer of the
 * two reversible answers beside it.
 */
export default function MergeCompare({
  pair,
  onClose,
  onMerged,
  onRejected,
  onOpenHold,
  permissions,
}: {
  pair: DupPair;
  /** Feature 078: the answers offered are the ones this person may give; the rest is view-only. */
  permissions: PairPermissions;
  onOpenHold: (heldMergeId: string) => void;
  onClose: () => void;
  onMerged: (canonicalId: string, mergedId: string) => void | Promise<void>;
  onRejected: () => void | Promise<void>;
}) {
  const [records, setRecords] = useState<Record<string, FullRecord>>({});
  const [pending, setPending] = useState<PendingShare | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { a, b } = pair;

  const load = useCallback(async () => {
    const [ra, rb] = await Promise.all(
      [a.id, b.id].map((id) => apiFetch(`/api/contacts/${id}`).then((r) => r.json())),
    );
    setRecords({ [a.id]: ra as FullRecord, [b.id]: rb as FullRecord });
  }, [a.id, b.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Stage a share: read from the loaded records so the confirmation names the real addresses. */
  function proposeShare(owner: DupContact, referrer: DupContact) {
    setMessage(null);
    const target = activeEmail(records[owner.id]);
    if (!target) {
      setMessage(`${owner.displayName} has no active address to share.`);
      return;
    }
    const own = activeEmail(records[referrer.id]);
    setPending({
      referrerId: referrer.id,
      referrerName: referrer.displayName,
      ownerName: owner.displayName,
      emailId: target.id,
      address: target.email,
      ...(own ? { retireEmailId: own.id, retireAddress: own.email } : {}),
    });
  }

  async function confirmShare() {
    if (!pending) return;
    const res = await apiFetch(`/api/contacts/${pending.referrerId}/message-recipient`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emailId: pending.emailId,
        ...(pending.retireEmailId ? { retireEmailId: pending.retireEmailId } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setMessage(body?.error?.message ?? "Could not link the shared email");
      return;
    }
    setPending(null);
    onClose();
  }

  function Column({ c }: { c: DupContact }) {
    const rec = records[c.id];
    return (
      <div className={styles.dupSide}>
        <ContactName c={c}>{c.hasLogin ? " · signs in" : ""}</ContactName>
        <dl className={styles.dupFacts}>
          <div>
            <dt>Addresses</dt>
            <dd>
              {rec?.emails?.length ? (
                <ul className={styles.plainList}>
                  {rec.emails.map((e) => (
                    <li key={e.id}>
                      {e.email} <em>({e.status})</em>
                    </li>
                  ))}
                </ul>
              ) : (
                <em>No email</em>
              )}
            </dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{c.phone ? formatPhone(c.phone) : <em>No phone</em>}</dd>
          </div>
          <div>
            <dt>Membership</dt>
            <dd>
              {c.membershipStatus}
              {c.membershipLevel ? ` · ${c.membershipLevel}` : ""}
            </dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{c.createdAt.slice(0, 10)}</dd>
          </div>
          <div>
            <dt>Last changed</dt>
            <dd>{c.updatedAt.slice(0, 10)}</dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <div className={styles.backdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Compare ${a.displayName} and ${b.displayName}`}
        className={styles.modalPanel}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        {/* `modalPanel` only SIZES the panel — the surface comes from RecordView, the shell the record
            modal uses. Without it the content sits straight on the backdrop scrim and is unreadable. */}
        <RecordView title="Are these one person?">
          {message && <p className={styles.empty}>{message}</p>}
          <div className={styles.dupSides}>
            <Column c={a} />
            <Column c={b} />
          </div>

          {pair.heldMergeId ? (
            // Feature 078: merging a held pair again would only stop at the same question. The way forward
            // is the hold, answered by whoever its question belongs to.
            <div className={styles.dupActions}>
              <p className={styles.mergeNote}>
                Their merge is held, waiting on a decision. It is answered in the held merge, not
                here.
              </p>
              {permissions.seeHolds && (
                <button
                  type="button"
                  className={styles.dupButton}
                  onClick={() => onOpenHold(pair.heldMergeId!)}
                >
                  Open held merge
                </button>
              )}
            </div>
          ) : permissions.merge ? (
            <>
              <p className={styles.mergeNote}>
                Merging keeps one contact and retires the other. The one you keep inherits every
                address shown above — active, transitioning or retired — along with the other&apos;s
                phone, membership and history. It can be undone afterwards from the kept
                contact&apos;s merge history.
              </p>

              <div className={styles.dupActions}>
                <button
                  type="button"
                  className={styles.destructiveButton}
                  onClick={() => void onMerged(a.id, b.id)}
                >
                  Keep {a.displayName}, retire {b.displayName}
                </button>
                <button
                  type="button"
                  className={styles.destructiveButton}
                  onClick={() => void onMerged(b.id, a.id)}
                >
                  Keep {b.displayName}, retire {a.displayName}
                </button>
              </div>
            </>
          ) : (
            <p className={styles.mergeNote}>
              You cannot merge or separate these contacts — that is for the mailing-list manager or
              an officer who manages duplicates. You can still compare them here.
            </p>
          )}

          {/* The two reversible answers. Feature 067 (M-R26): different people, one household address. */}
          <div className={styles.dupActions}>
            {permissions.share && (
              <>
                <button
                  type="button"
                  className={styles.dupButton}
                  onClick={() => proposeShare(a, b)}
                >{`Share ${a.displayName}'s email`}</button>
                <button
                  type="button"
                  className={styles.dupButton}
                  onClick={() => proposeShare(b, a)}
                >{`Share ${b.displayName}'s email`}</button>
              </>
            )}
            {permissions.merge && (
              <button type="button" className={styles.dupButton} onClick={() => void onRejected()}>
                Not duplicates
              </button>
            )}
            <button type="button" className={styles.dupButton} onClick={onClose}>
              Cancel
            </button>
          </div>

          {pending && (
            <div
              role="region"
              aria-label="Shared email confirmation"
              className={styles.confirmRegion}
            >
              <p>
                {pending.referrerName} will be reached at <strong>{pending.address}</strong> (
                {pending.ownerName}&apos;s address). They stay separate contacts.
              </p>
              {pending.retireAddress && (
                <p>
                  This retires {pending.referrerName}&apos;s own address{" "}
                  <strong>{pending.retireAddress}</strong>.
                </p>
              )}
              <div className={styles.dupActions}>
                <button
                  type="button"
                  className={styles.dupButton}
                  onClick={() => void confirmShare()}
                >
                  Confirm shared email
                </button>
                <button type="button" className={styles.dupButton} onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </RecordView>
      </div>
    </div>
  );
}
