"use client";
import { useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import Dialog from "@/app/_components/Dialog";
import ContactPicker, { type Person } from "@/app/_components/ContactPicker";
import { MEMBERSHIP_LEVELS, MEMBERSHIP_LEVEL_LABELS } from "@/app/membershipLevels";
import type { MembershipLevel } from "@/server/db/schema/enums";
import styles from "./SaleOrCheckDialog.module.css";

/** A check as the gate page holds it (contracts/gate.md, check view). */
export type CheckToEdit = {
  id: string;
  writerContactId: string;
  writer: string;
  note: string | null;
  depositSeparately: boolean;
  lines: {
    category: string;
    amount: number;
    contactId: string | null;
    contactName: string | null;
    membershipLevel: MembershipLevel | null;
    quantity: number | null;
    note: string | null;
  }[];
};

/** A sale as the gate page holds it (contracts/gate.md, sale view). */
export type SaleToEdit = {
  id: string;
  category: string;
  paymentMethod: "cash" | "card" | "check";
  amount: number;
  contactId: string | null;
  contactName: string | null;
  membershipLevel: MembershipLevel | null;
  quantity: number | null;
  note: string | null;
};

type Method = "cash" | "check" | "card";

const CATEGORIES = [
  ["admission", "Admission"],
  ["membership", "Membership"],
  ["donation", "Donation"],
  ["future_event", "Future event"],
  ["merchandise", "Merchandise"],
  ["gift_card", "Gift cards sold"],
  ["misc_sales", "Other items"],
] as const;
type Category = (typeof CATEGORIES)[number][0];
const NAMED = new Set<string>(["membership", "donation", "future_event"]);
/** Levels that cover the payer alone, as the membership account says (feature 068, FR-003a). */
const SOLO_LEVELS: string[] = ["individual", "student"];

type LineDraft = {
  key: number;
  category: Category | "";
  amount: string;
  quantity: string;
  level: MembershipLevel | "";
  /** Whose donation or future event it is, when not the payer's. */
  forWhom: Person | null;
  choosingFor: boolean;
  /** A membership's members besides the payer, who is always one (the quickstart walk, §3.3). */
  members: Person[];
  addingMember: boolean;
  note: string;
};

let nextKey = 1;
const blankLine = (): LineDraft => ({
  key: nextKey++,
  category: "",
  amount: "",
  quantity: "",
  level: "",
  forWhom: null,
  choosingFor: false,
  members: [],
  addingMember: false,
  note: "",
});

const money = (dollars: number) => `$${dollars.toFixed(2)}`;

/** Write, and answer with the server's own reason on a refusal. */
async function write(url: string, method: string, body: unknown): Promise<string | null> {
  try {
    const res = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.error?.message ?? `The server refused it (${res.status}).`;
  } catch {
    return "Could not reach the server.";
  }
}

type Props = {
  doorRecordId: string;
  /** Whether the caller may record gate money — and so mark a check to be banked on its own. */
  canMark: boolean;
  editing?: CheckToEdit | SaleToEdit;
  onSaved: () => void;
  onClose: () => void;
};

function draftsFor(editing: Props["editing"], payerId: string | null): LineDraft[] {
  if (!editing) return [blankLine()];
  const lines = "lines" in editing ? editing.lines : [editing];
  return lines.map((l) => ({
    ...blankLine(),
    category: l.category as Category,
    amount: String(l.amount),
    quantity: l.quantity ? String(l.quantity) : "",
    level: l.membershipLevel ?? "",
    forWhom:
      l.category !== "membership" && l.contactId && l.contactId !== payerId
        ? { id: l.contactId, displayName: l.contactName ?? "Unknown" }
        : null,
    note: l.note ?? "",
  }));
}

/**
 * Feature 082 (FR-024, FR-025, research R16, R17): the one dialog for a sale, from the door and the gate.
 * Paid by cash or card it is one line; by check it is a line for each thing the check pays for, against
 * the payer who wrote it (FR-015), its amount their sum (FR-017). Admission is offered only on a check —
 * cash and card admission come from the evening's takings (FR-020). Each is saved on its own as soon as it
 * is recorded, so the gate's Save never touches it (FR-023, FR-026).
 */
export default function SaleOrCheckDialog({
  doorRecordId,
  canMark,
  editing,
  onSaved,
  onClose,
}: Props) {
  const editingCheck = editing && "lines" in editing ? editing : undefined;
  const editingSale = editing && !("lines" in editing) ? editing : undefined;
  const initialPayer: Person | null = editingCheck
    ? { id: editingCheck.writerContactId, displayName: editingCheck.writer }
    : editingSale?.contactId
      ? { id: editingSale.contactId, displayName: editingSale.contactName ?? "Unknown" }
      : null;

  const [method, setMethod] = useState<Method>(
    editingCheck ? "check" : editingSale?.paymentMethod === "card" ? "card" : "cash",
  );
  const [payer, setPayer] = useState<Person | null>(initialPayer);
  const [lines, setLines] = useState<LineDraft[]>(() =>
    draftsFor(editing, initialPayer?.id ?? null),
  );
  const [note, setNote] = useState(editingCheck?.note ?? "");
  const [depositSeparately, setDepositSeparately] = useState(
    editingCheck?.depositSeparately ?? false,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isCheck = method === "check";
  const setLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);

  function choose(m: Method) {
    setMethod(m);
    // Admission is a check's alone; leaving the check un-chooses it.
    if (m !== "check") {
      setLines((ls) => ls.map((l) => (l.category === "admission" ? { ...l, category: "" } : l)));
    }
  }

  function problem(): string | null {
    const paying = lines.filter((l) => l.category || Number(l.amount) > 0);
    if (isCheck && paying.length === 0) {
      return "A check needs at least one line — what does it pay for?";
    }
    if (!isCheck && lines.length > 1) return "Record a cash or card sale one line at a time.";
    for (const l of isCheck ? paying : lines) {
      if (!l.category) return "What was sold?";
      if (!(Number(l.amount) > 0)) return "How much was paid?";
      if (l.quantity && !(Number.isInteger(Number(l.quantity)) && Number(l.quantity) > 0)) {
        return "How many? is a whole number.";
      }
      if (l.category === "membership" && !l.level) return "Choose the membership's level.";
      if (l.members.length > 0 && SOLO_LEVELS.includes(l.level)) {
        const level = MEMBERSHIP_LEVEL_LABELS[l.level as MembershipLevel].toLowerCase();
        return `${level === "individual" ? "An" : "A"} ${level} membership covers the payer alone — choose family or supporter to add members.`;
      }
    }
    if (!payer && (isCheck || lines.some((l) => NAMED.has(l.category)))) {
      return "Who is the payer? Find them, or add them as a new contact.";
    }
    return null;
  }

  /** What a line says, whether it is a check's or a sale on its own. */
  function lineBody(l: LineDraft) {
    // A membership is always the payer's; a donation or future event may be someone else's.
    const contact =
      l.category === "membership"
        ? payer
        : NAMED.has(l.category)
          ? (l.forWhom ?? payer)
          : isCheck
            ? null
            : payer;
    return {
      category: l.category,
      amount: Number(l.amount),
      ...(l.quantity ? { quantity: Number(l.quantity) } : {}),
      ...(contact ? { contactId: contact.id } : {}),
      ...(l.category === "membership" ? { membershipLevel: l.level } : {}),
      ...(l.category === "membership" && l.members.length
        ? { memberContactIds: l.members.map((m) => m.id) }
        : {}),
      ...(l.note.trim() ? { note: l.note.trim() } : {}),
    };
  }

  async function record() {
    const refusal = problem();
    setError(refusal);
    if (refusal) return;
    let refused: string | null;
    setSaving(true);
    if (isCheck) {
      const body = {
        writerContactId: payer!.id,
        ...(editingCheck
          ? { note: note.trim() || null }
          : note.trim()
            ? { note: note.trim() }
            : {}),
        ...(canMark && (editingCheck || depositSeparately) ? { depositSeparately } : {}),
        lines: lines.filter((l) => l.category).map(lineBody),
      };
      refused = editingCheck
        ? await write(`/api/gate-checks/${editingCheck.id}`, "PATCH", body)
        : await write(`/api/door-records/${doorRecordId}/checks`, "POST", body);
    } else {
      const { category, contactId, note: lineNote, quantity, ...rest } = lineBody(lines[0]!);
      refused = editingSale
        ? await write(`/api/gate-sales/${editingSale.id}`, "PATCH", {
            amount: rest.amount,
            paymentMethod: method,
            contactId: contactId ?? null,
            ...(rest.membershipLevel ? { membershipLevel: rest.membershipLevel } : {}),
            ...(rest.memberContactIds ? { memberContactIds: rest.memberContactIds } : {}),
            quantity: quantity ?? null,
            note: lineNote ?? null,
          })
        : await write(`/api/door-records/${doorRecordId}/sales`, "POST", {
            category,
            paymentMethod: method,
            ...rest,
            ...(quantity ? { quantity } : {}),
            ...(contactId ? { contactId } : {}),
            ...(lineNote ? { note: lineNote } : {}),
          });
    }
    setSaving(false);
    if (refused) return setError(refused);
    onSaved();
  }

  return (
    <Dialog label={editing ? "Correct a sale" : "Add a sale"} onClose={onClose}>
      <fieldset className={styles.methods}>
        <legend className={styles.legend}>Paid by</legend>
        {(["cash", "check", "card"] as const).map((m) => (
          <label key={m} className={styles.check}>
            <input
              type="radio"
              name="paid-by"
              checked={method === m}
              // Correcting keeps the way it was paid: a check stays a check, a sale is never one.
              disabled={!!editing && (m === "check") !== !!editingCheck}
              onChange={() => choose(m)}
            />
            {m === "cash" ? "Cash" : m === "check" ? "Check" : "Card"}
          </label>
        ))}
      </fieldset>

      <ContactPicker label="Payer" value={payer} onChange={setPayer} />

      {lines.map((l, i) => (
        <fieldset key={l.key} className={isCheck ? styles.line : `${styles.line} ${styles.single}`}>
          <legend className={isCheck ? styles.legend : styles.hidden}>Line {i + 1}</legend>
          <div className={styles.fields}>
            <label className={styles.wide}>
              What was sold
              <select
                className={styles.input}
                value={l.category}
                disabled={!!editingSale}
                onChange={(e) => setLine(l.key, { category: e.target.value as Category })}
              >
                <option value="">Choose…</option>
                {CATEGORIES.filter(([value]) => isCheck || value !== "admission").map(
                  ([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Amount
              <input
                className={styles.input}
                inputMode="decimal"
                value={l.amount}
                onChange={(e) => setLine(l.key, { amount: e.target.value })}
              />
            </label>
            <label>
              How many?
              <input
                className={styles.input}
                inputMode="numeric"
                value={l.quantity}
                onChange={(e) => setLine(l.key, { quantity: e.target.value })}
              />
            </label>
            {l.category === "membership" && (
              <label className={styles.wide}>
                Level
                <select
                  className={styles.input}
                  value={l.level}
                  onChange={(e) =>
                    setLine(l.key, { level: e.target.value as MembershipLevel | "" })
                  }
                >
                  <option value="">Choose…</option>
                  {MEMBERSHIP_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {MEMBERSHIP_LEVEL_LABELS[level]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {l.category === "membership" && (
            <div className={styles.picker}>
              <div className={styles.chosen}>
                <span>
                  Members:{" "}
                  {[payer?.displayName ?? "the payer", ...l.members.map((m) => m.displayName)].join(
                    ", ",
                  )}
                </span>
              </div>
              {l.members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={styles.linkButton}
                  aria-label={`Remove ${m.displayName}`}
                  onClick={() =>
                    setLine(l.key, { members: l.members.filter((x) => x.id !== m.id) })
                  }
                >
                  Remove {m.displayName}
                </button>
              ))}
              {l.addingMember ? (
                <ContactPicker
                  label="Member"
                  value={null}
                  onChange={(p) =>
                    p &&
                    setLine(l.key, {
                      members: l.members.some((m) => m.id === p.id) ? l.members : [...l.members, p],
                      addingMember: false,
                    })
                  }
                />
              ) : (
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => setLine(l.key, { addingMember: true })}
                >
                  Add a member
                </button>
              )}
            </div>
          )}
          {NAMED.has(l.category) &&
            l.category !== "membership" &&
            (l.choosingFor ? (
              <ContactPicker
                label="For"
                value={l.forWhom}
                onChange={(p) => setLine(l.key, { forWhom: p, choosingFor: p === null })}
              />
            ) : (
              <div className={styles.chosen}>
                <span>
                  For <strong>{l.forWhom?.displayName ?? payer?.displayName ?? "the payer"}</strong>
                </span>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() =>
                    l.forWhom
                      ? setLine(l.key, { forWhom: null })
                      : setLine(l.key, { choosingFor: true })
                  }
                >
                  {l.forWhom ? "The payer" : "Someone else"}
                </button>
              </div>
            ))}
          <label className={styles.field}>
            Note
            <input
              className={styles.input}
              value={l.note}
              onChange={(e) => setLine(l.key, { note: e.target.value })}
            />
          </label>
          {lines.length > 1 && (
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
            >
              Remove line
            </button>
          )}
        </fieldset>
      ))}

      {isCheck && (
        <>
          <button
            type="button"
            className={styles.button}
            onClick={() => setLines((ls) => [...ls, blankLine()])}
          >
            Add a line
          </button>
          <p className={styles.total}>Check total {money(total)}</p>
          <label className={styles.field}>
            Note on the check
            <textarea
              className={styles.input}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {canMark && (
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={depositSeparately}
                onChange={(e) => setDepositSeparately(e.target.checked)}
              />
              Deposit separately
            </label>
          )}
        </>
      )}

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.buttons}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={saving}
          onClick={() => void record()}
        >
          Record
        </button>
        <button type="button" className={styles.button} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
