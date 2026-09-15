"use client";
import { apiFetch } from "@/app/apiFetch";
import { EventSelector } from "@/app/EventSelector";
import AttendanceBreakdownView from "@/app/_components/AttendanceBreakdownView";
import type { AttendanceBreakdown } from "@/server/domain/attendance/breakdownService";

import { useEffect, useState } from "react";

type Candidate = { id: string; displayName: string };

const ANON_CATEGORIES = ["merchandise", "gift_card", "misc_sales"] as const;
const NAMED_CATEGORIES = ["donation", "future_event", "membership"] as const;
// Feature 031 (P5-R4): the denomination helper's bill faces, largest first.
const BILLS = [100, 50, 20, 10, 5, 1] as const;
type PaymentMethod = "cash" | "card";

type AnonAmounts = Record<string, { cash: string; card: string }>;
const emptyAnon: AnonAmounts = Object.fromEntries(
  ANON_CATEGORIES.map((c) => [c, { cash: "", card: "" }]),
);

type NamedLine = {
  category: (typeof NAMED_CATEGORIES)[number];
  contactId: string;
  contactName: string;
  amount: string;
  paymentMethod: PaymentMethod;
};

export default function GatePage() {
  const [eventId, setEventId] = useState("");
  const [doorRecordId, setDoorRecordId] = useState("");
  const [anon, setAnon] = useState<AnonAmounts>(emptyAnon);
  // Feature 031 (P5-R4): one free-text comment for the whole anonymous-sales section ("3 CDs, 2 shirts").
  const [anonNote, setAnonNote] = useState("");
  const [named, setNamed] = useState<NamedLine[]>([]);
  // Feature 031 (P5-R4): the OPTIONAL, TRANSIENT denomination helper — bill counts + coins + checks → a grand
  // cash total the FS can push into gross cash. Not persisted (Q8); the direct gross-cash entry always exists.
  const [billCounts, setBillCounts] = useState<Record<number, string>>({});
  const [coins, setCoins] = useState("");
  const [checks, setChecks] = useState("");
  const [posTxns, setPosTxns] = useState("");
  const [grossCash, setGrossCash] = useState("");
  const [pcGross, setPcGross] = useState("");
  // Feature 019 US5: initialised empty; pre-filled from the door record's configured seed float on load.
  const [seedFloat, setSeedFloat] = useState("");
  const [cashPaidOut, setCashPaidOut] = useState("");
  const [cashPaidOutReason, setCashPaidOutReason] = useState("");
  const [compCount, setCompCount] = useState("");
  // Feature 017 (B29/B36): counts the Door Attendant captured at check-in; the FS confirms comp/gift
  // (editable) and sees the open-band comp count (read-only).
  const [giftCount, setGiftCount] = useState("");
  const [openBandCount, setOpenBandCount] = useState(0);
  const [deposit, setDeposit] = useState<number | null>(null);
  // Feature 079 (FR-027): the evening's attendance breakdown — the FS wants to see who came.
  const [breakdown, setBreakdown] = useState<AttendanceBreakdown | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // contact search for adding a named line
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [newCategory, setNewCategory] = useState<(typeof NAMED_CATEGORIES)[number]>("membership");

  useEffect(() => {
    if (!search.trim()) return setCandidates([]);
    void apiFetch(`/api/attendance/search?q=${encodeURIComponent(search)}`)
      .then((r) => r.json())
      .then((d) => setCandidates(d.items ?? []));
  }, [search]);

  async function loadBreakdown(forEventId: string) {
    if (!forEventId) return setBreakdown(null);
    const res = await apiFetch(`/api/events/${forEventId}/attendance-breakdown`);
    setBreakdown(res.ok ? ((await res.json()) as AttendanceBreakdown) : null);
  }

  async function openDoorRecord(selectedEventId: string) {
    setEventId(selectedEventId);
    setDoorRecordId("");
    setDeposit(null);
    void loadBreakdown(selectedEventId);
    setMessage(null);
    setAnon(JSON.parse(JSON.stringify(emptyAnon)));
    setAnonNote("");
    setBillCounts({});
    setCoins("");
    setChecks("");
    setNamed([]);
    if (!selectedEventId) return;
    const res = await apiFetch(`/api/events/${selectedEventId}/door-record`, { method: "POST" });
    if (!res.ok) return setMessage("Could not open door record");
    const data = await res.json();
    const dr = data.doorRecord;
    setDoorRecordId(dr.id);
    // Feature 019 US5: the seed float now comes from the door record (seeded from the series parameter,
    // FR-022), not a hard-coded 15. The FS can still override it for this record.
    setSeedFloat(String(dr.seedFloat ?? 15));
    // Pre-fill the counts the Door Attendant captured at check-in, for the FS to confirm (FR-015).
    setCompCount(String(dr.compCount ?? 0));
    setGiftCount(String(dr.giftCardRedemptionCount ?? 0));
    setOpenBandCount(dr.openBandCount ?? 0);
    // D2 (data-loss fix): reload the money the FS already entered — previously these stayed blank on a return
    // visit, and the next Save wrote the blanks (0 / replace-all) over the saved record. Show a stored value,
    // blank when zero/unset so the placeholders stay clean.
    const money = (v: number) => (v ? String(v) : "");
    setGrossCash(money(dr.grossCash ?? 0));
    setPcGross(money(dr.pcGross ?? 0));
    setPosTxns(money(dr.posTransactionCount ?? 0));
    setCashPaidOut(money(dr.cashPaidOut ?? 0));
    setCashPaidOutReason(dr.cashPaidOutReason ?? "");
    // D2: rebuild the anon + named sale lines from the persisted gate sales, so a re-save round-trips them
    // instead of wiping them (putGateSales is replace-all).
    const anonNext: AnonAmounts = JSON.parse(JSON.stringify(emptyAnon));
    const namedNext: NamedLine[] = [];
    let firstAnonNote: string | null = null;
    for (const s of (data.gateSales ?? []) as {
      category: string;
      paymentMethod: PaymentMethod;
      amountCents: number;
      contactId: string | null;
      contactName: string | null;
      note: string | null;
    }[]) {
      const amount = String(s.amountCents / 100);
      if ((ANON_CATEGORIES as readonly string[]).includes(s.category)) {
        anonNext[s.category]![s.paymentMethod] = amount;
        // Feature 031: one comment for the section — take the first anon line that carries one (R3).
        if (firstAnonNote === null && s.note) firstAnonNote = s.note;
      } else if ((NAMED_CATEGORIES as readonly string[]).includes(s.category) && s.contactId) {
        namedNext.push({
          category: s.category as (typeof NAMED_CATEGORIES)[number],
          contactId: s.contactId,
          contactName: s.contactName ?? "(unknown)",
          amount,
          paymentMethod: s.paymentMethod,
        });
      }
    }
    setAnon(anonNext);
    setAnonNote(firstAnonNote ?? "");
    setNamed(namedNext);
  }

  function setAnonAmt(cat: string, method: PaymentMethod, v: string) {
    setAnon((a) => ({ ...a, [cat]: { ...a[cat]!, [method]: v } }));
  }

  function addNamedLine(c: Candidate) {
    setNamed((lines) => [
      ...lines,
      {
        category: newCategory,
        contactId: c.id,
        contactName: c.displayName,
        amount: "",
        paymentMethod: "card",
      },
    ]);
    setSearch("");
    setCandidates([]);
  }

  function setNamedField(i: number, patch: Partial<NamedLine>) {
    setNamed((lines) => lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function save() {
    setMessage(null);
    const note = anonNote.trim();
    const sales = [
      ...ANON_CATEGORIES.flatMap((c) =>
        (["cash", "card"] as const).flatMap((m) => {
          const v = Number(anon[c]![m]);
          // Feature 031: the section comment rides on the anon line(s) (R3).
          return v > 0
            ? [{ category: c, paymentMethod: m, amount: v, ...(note ? { note } : {}) }]
            : [];
        }),
      ),
      ...named.flatMap((l) => {
        const v = Number(l.amount);
        return v > 0
          ? [
              {
                category: l.category,
                paymentMethod: l.paymentMethod,
                amount: v,
                contactId: l.contactId,
              },
            ]
          : [];
      }),
    ];
    const gsRes = await apiFetch(`/api/door-records/${doorRecordId}/gate-sales`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sales }),
    });
    // Gate money is the Financial Secretary's to write (FR-020). A Door Attendant reaches this page and
    // reads it — money is not secret — but a save is refused server-side. Surface that plainly rather
    // than as a generic failure. (Proactively disabling the control belongs with US5's role-aware UI.)
    if (gsRes.status === 403) {
      return setMessage("Only the Financial Secretary may record gate money for this event.");
    }
    if (!gsRes.ok) return setMessage("Gate sales failed");
    // Feature 019 (B31): show which named contacts got a membership created/renewed by this save.
    const gsBody = await gsRes.json().catch(() => null);
    const enrolled: { displayName: string; expiryDate: string }[] = gsBody?.enrolled ?? [];

    const res = await apiFetch(`/api/door-records/${doorRecordId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posTransactionCount: Number(posTxns) || 0,
        grossCash: Number(grossCash) || 0,
        pcGross: Number(pcGross) || 0,
        seedFloat: Number(seedFloat) || 0,
        cashPaidOut: Number(cashPaidOut) || 0,
        compCount: Number(compCount) || 0,
        giftCardRedemptionCount: Number(giftCount) || 0,
        ...(cashPaidOutReason ? { cashPaidOutReason } : {}),
      }),
    });
    if (res.status === 403) {
      return setMessage("Only the Financial Secretary may record gate money for this event.");
    }
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      return setMessage(b?.error?.message ?? "Update failed");
    }
    const body = await res.json();
    setDeposit(body.deposit); // fee intentionally not returned
    void loadBreakdown(eventId); // comps and gift cards may have just changed
    if (enrolled.length > 0) {
      const who = enrolled.map((e) => `${e.displayName} (through ${e.expiryDate})`).join(", ");
      setMessage(`Saved. Membership recorded: ${who}`);
    } else {
      setMessage("Saved");
    }
  }

  // Feature 031 (P5-R4): the denomination helper's grand cash total = Σ(bill count × face) + coins + checks
  // (checks fold into gross cash — Q9). Transient; the FS pushes it into gross cash with the button below.
  const denomTotal =
    BILLS.reduce((a, f) => a + f * (Number(billCounts[f]) || 0), 0) +
    (Number(coins) || 0) +
    (Number(checks) || 0);

  return (
    <main style={{ padding: 24, maxWidth: 680 }}>
      <h1>Gate money</h1>
      <EventSelector value={eventId} onSelect={(e) => void openDoorRecord(e.id)} />
      {doorRecordId && (
        <p style={{ color: "#666" }}>Door record open ({doorRecordId.slice(0, 8)}…)</p>
      )}
      {breakdown && <AttendanceBreakdownView breakdown={breakdown} />}

      <h2>Anonymous gate sales</h2>
      <table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Cash</th>
            <th>Card</th>
          </tr>
        </thead>
        <tbody>
          {ANON_CATEGORIES.map((c) => (
            <tr key={c}>
              <td>{c}</td>
              <td>
                <input
                  value={anon[c]!.cash}
                  onChange={(e) => setAnonAmt(c, "cash", e.target.value)}
                />
              </td>
              <td>
                <input
                  value={anon[c]!.card}
                  onChange={(e) => setAnonAmt(c, "card", e.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label style={{ display: "block", marginTop: 6, maxWidth: 460 }}>
        <small>Comment (what sold, e.g. &quot;3 CDs, 2 shirts&quot;)</small>
        <textarea
          aria-label="Anonymous sales comment"
          value={anonNote}
          onChange={(e) => setAnonNote(e.target.value)}
          rows={2}
          style={{ width: "100%" }}
        />
      </label>

      <h2>Named-customer sales (donation / future event / membership)</h2>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <select
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value as typeof newCategory)}
        >
          {NAMED_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          placeholder="Find contact…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {candidates.length > 0 && (
        <ul>
          {candidates.map((c) => (
            <li key={c.id}>
              {c.displayName} <button onClick={() => addNamedLine(c)}>add</button>
            </li>
          ))}
        </ul>
      )}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {named.map((l, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            {l.category} — {l.contactName}{" "}
            <input
              placeholder="amount"
              value={l.amount}
              onChange={(e) => setNamedField(i, { amount: e.target.value })}
              style={{ width: 80 }}
            />{" "}
            <select
              value={l.paymentMethod}
              onChange={(e) => setNamedField(i, { paymentMethod: e.target.value as PaymentMethod })}
            >
              <option value="cash">cash</option>
              <option value="card">card</option>
            </select>{" "}
            <button onClick={() => setNamed((lines) => lines.filter((_, idx) => idx !== i))}>
              remove
            </button>
          </li>
        ))}
      </ul>

      <h2>Cash &amp; card reconciliation</h2>
      <p style={{ color: "#666" }}>
        Admission is derived: gross cash − seed float − non-admission cash, and Card gross −
        non-admission card.
      </p>
      <details style={{ maxWidth: 360, marginBottom: 8 }}>
        <summary>Count cash by denomination (optional)</summary>
        <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
          {BILLS.map((f) => (
            <label key={f}>
              ${f} bills{" "}
              <input
                aria-label={`$${f} bills`}
                inputMode="numeric"
                value={billCounts[f] ?? ""}
                onChange={(e) => setBillCounts((m) => ({ ...m, [f]: e.target.value }))}
                style={{ width: 60 }}
              />
            </label>
          ))}
          <label>
            Coins ($){" "}
            <input aria-label="Coins" value={coins} onChange={(e) => setCoins(e.target.value)} />
          </label>
          <label>
            Checks ($){" "}
            <input aria-label="Checks" value={checks} onChange={(e) => setChecks(e.target.value)} />
          </label>
          <p style={{ margin: "4px 0" }}>
            Grand cash total: <strong>${denomTotal.toFixed(2)}</strong>
          </p>
          <button type="button" onClick={() => setGrossCash(denomTotal.toFixed(2))}>
            Use as gross cash
          </button>
        </div>
      </details>
      <div style={{ display: "grid", gap: 6, maxWidth: 360 }}>
        <label>
          Gross cash (total counted){" "}
          <input
            aria-label="Gross cash"
            value={grossCash}
            onChange={(e) => setGrossCash(e.target.value)}
          />
        </label>
        <label>
          Card gross (total card){" "}
          <input value={pcGross} onChange={(e) => setPcGross(e.target.value)} />
        </label>
        <label>
          Card transactions <input value={posTxns} onChange={(e) => setPosTxns(e.target.value)} />
        </label>
        <label>
          Seed float <input value={seedFloat} onChange={(e) => setSeedFloat(e.target.value)} />
        </label>
        <label>
          Cash paid out{" "}
          <input value={cashPaidOut} onChange={(e) => setCashPaidOut(e.target.value)} />
        </label>
        <label>
          Payout reason{" "}
          <input value={cashPaidOutReason} onChange={(e) => setCashPaidOutReason(e.target.value)} />
        </label>
        <label>
          Comps (admitted free){" "}
          <input value={compCount} onChange={(e) => setCompCount(e.target.value)} />
        </label>
        <label>
          Gift cards redeemed{" "}
          <input value={giftCount} onChange={(e) => setGiftCount(e.target.value)} />
        </label>
        <p style={{ margin: "4px 0", color: "#555" }}>
          <small>
            Open-band comps (from check-in, read-only): <strong>{openBandCount}</strong> — added to
            comps when deriving paying dancers.
          </small>
        </p>
        <button onClick={save} disabled={!doorRecordId}>
          Save
        </button>
      </div>

      {deposit !== null && (
        <p>
          <strong>Deposit:</strong> ${deposit.toFixed(2)}
        </p>
      )}
      {message && <p>{message}</p>}
    </main>
  );
}
