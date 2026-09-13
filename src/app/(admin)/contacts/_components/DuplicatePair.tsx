"use client";

import type {
  MergeSuggestion,
  MergeSuggestionContact,
} from "@/server/domain/dedup/suggestionService";
import { formatPhone } from "@/server/domain/contacts/phone";
import styles from "../contacts.module.css";
import PairContactName from "./PairContactName";

/**
 * The row's shape IS the server's projection — imported, not re-declared. FR-005 makes the row's
 * available actions a function of the fields it displays, so a hand-mirrored copy here could drift out
 * of step with the derivation without anything failing to compile.
 */
export type DupContact = MergeSuggestionContact;
export type DupPair = MergeSuggestion;

const day = (iso: string) => (iso ? String(iso).slice(0, 10) : "—");

/**
 * Feature 069 (M-R18, FR-001). The queue proposes pairs on NAME SIMILARITY ALONE, so most of what
 * separates a real duplicate from two people who happen to share a name is not in the proposal — it is in
 * the records. Showing it here is the whole point of the row: Mel decides from what is in front of her,
 * and only opens a record when the row says the decision depends on something it cannot show (FR-005/006).
 *
 * Record age is the common tell — a contact carried since 2019 beside one created by last month's import
 * is the ordinary duplicate. Shared-household facts run the other way: two people on one membership
 * account, or reached at one address, are evidence AGAINST a merge, and are exactly the pairs a
 * name-similarity queue keeps proposing.
 */
function Side({ c, onOpen }: { c: DupContact; onOpen: () => void }) {
  return (
    <div className={styles.dupSide}>
      <PairContactName c={c}>{c.hasLogin ? " · signs in" : ""}</PairContactName>
      {/* FR-007: the underlying record is reachable from every row, whatever the row's own action is. */}
      <button type="button" className={styles.dupOpen} onClick={onOpen}>
        Open {c.displayName}
      </button>
      <dl className={styles.dupFacts}>
        <div>
          <dt>Email</dt>
          <dd>
            {c.emails.length ? c.emails.join(", ") : null}
            {/* Feature 067: a contact with no address of its own may still be REACHED, through a
                household address it rides. Rendering that as "No email" would read as a sparse record
                when it is in fact evidence of a distinct person. */}
            {c.messageRecipient ? (
              <em>
                {c.emails.length ? " · " : ""}
                reached via {c.messageRecipient.ownerDisplayName}
                {c.messageRecipient.address ? ` (${c.messageRecipient.address})` : ""}
              </em>
            ) : c.emails.length ? null : (
              <em>No email</em>
            )}
            {c.hasUnshownAddress ? <em> (and others not shown)</em> : null}
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
          <dd>{day(c.createdAt)}</dd>
        </div>
        <div>
          <dt>Last changed</dt>
          <dd>{day(c.updatedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function DuplicatePair({
  pair,
  onReject,
  onUndoReject,
  onOpen,
  onCompare,
  onMerge,
}: {
  pair: DupPair;
  onReject: () => void;
  onUndoReject: () => void;
  onOpen: (contactId: string) => void;
  /** FR-006/FR-008: open the two records side by side, where the decision this row cannot make is made. */
  onCompare: () => void;
  onMerge: (canonicalId: string, mergedId: string) => void;
}) {
  const { a, b, sharedHousehold, rejected } = pair;
  return (
    <li className={styles.dupRow} aria-label={`${a.displayName} and ${b.displayName}`}>
      <div className={styles.dupBody}>
        <div className={styles.dupSides}>
          <Side c={a} onOpen={() => onOpen(a.id)} />
          <Side c={b} onOpen={() => onOpen(b.id)} />
        </div>
        {(sharedHousehold.account || sharedHousehold.email) && (
          <p className={styles.dupHousehold}>
            Already one household —{" "}
            {[
              sharedHousehold.account ? "same membership account" : null,
              sharedHousehold.email ? "reached at the same address" : null,
            ]
              .filter(Boolean)
              .join("; ")}
            .
          </p>
        )}
        {rejected && (
          <p className={styles.dupRejected}>
            Marked not duplicates on {day(rejected.at)}
            {rejected.byDisplayName ? ` by ${rejected.byDisplayName}` : ""}.
          </p>
        )}
      </div>
      <span className={styles.dupActions}>
        {rejected ? (
          <button type="button" className={styles.dupButton} onClick={onUndoReject}>
            Undo
          </button>
        ) : (
          <>
            {/* Merging retires a contact and picks winners, so the row offers it only when the row
                itself settles it. A conflict between the records, or a collision the row cannot
                resolve, sends the pair to the comparison instead (FR-006). */}
            {pair.safeToMerge && (
              <>
                <button
                  type="button"
                  className={styles.destructiveButton}
                  onClick={() => onMerge(a.id, b.id)}
                >
                  Keep {a.displayName}
                </button>
                <button
                  type="button"
                  className={styles.destructiveButton}
                  onClick={() => onMerge(b.id, a.id)}
                >
                  Keep {b.displayName}
                </button>
                {/* Feature 074 (FR-029): say the safety net exists BEFORE the merge, not after. Knowing
                    a merge can be taken back is most of what makes it possible to act on a pair at all;
                    discovering it afterwards is worth much less. */}
                <span className={styles.hint}>Either can be undone afterwards.</span>
              </>
            )}
            {/* Rejecting is blocked only by an address the row is not showing — a conflict between the
                records is an argument FOR it, never against. */}
            {pair.safeToReject && (
              <button type="button" className={styles.dupButton} onClick={onReject}>
                Not duplicates
              </button>
            )}
            {!pair.safeToMerge && (
              <button type="button" className={styles.dupButton} onClick={onCompare}>
                Open to resolve
              </button>
            )}
          </>
        )}
      </span>
    </li>
  );
}
