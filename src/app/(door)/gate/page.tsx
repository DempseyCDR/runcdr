"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/app/apiFetch";
import type { EventRow } from "@/app/EventSelector";
import EventConfirm from "@/app/_components/EventConfirm";
import PaymentSummaryView from "@/app/_components/PaymentSummaryView";
import type { AttendanceBreakdown } from "@/server/domain/attendance/breakdownService";
import type { PaymentSummary } from "@/server/domain/payments/paymentSummary";
import CardSection from "./CardSection";
import CashSection from "./CashSection";
import CheckList from "./CheckList";
import CountDialog, { type CashCount } from "./CountDialog";
import DepositList from "./DepositList";
import SaleOrCheckDialog from "@/app/_components/SaleOrCheckDialog";
import DoorCounts from "./DoorCounts";
import MoneyPreview from "./MoneyPreview";
import SaleList from "./SaleList";
import { formFrom, previewMoney } from "./preview";
import { send, toNumber } from "./save";
import {
  CATEGORY_LABEL,
  type DoorRecord,
  type GateCheck,
  type GateSale,
  type MoneyForm,
  type Warning,
} from "./types";
import styles from "./gate.module.css";

type SeriesRow = { id: string; key: string; name: string };
type Loaded = { record: DoorRecord; sales: GateSale[]; checks: GateCheck[] };
type Payload = { doorRecord: DoorRecord; gateSales: GateSale[]; checks: GateCheck[] };

const UNSAVED = "You have entries that are not saved. Leave them?";

/**
 * Feature 082 (MARY-R1, R2, R8, R15, R16, R20; FR-001–FR-009, FR-030): the evening's money, on a phone.
 *
 * The event is confirmed at the top, then what the performers are owed and the money so far — deposit
 * included — then short sections in the order Mary works. The figures follow her typing; anything that
 * looks wrong is pointed out when she saves, never while she types. The Save owns the money figures only:
 * every sale and check is recorded one at a time, so nothing the door records is ever replaced by it
 * (research R16).
 */
export default function GatePage() {
  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [form, setForm] = useState<MoneyForm | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [payments, setPayments] = useState<PaymentSummary | null>(null);
  const [breakdown, setBreakdown] = useState<AttendanceBreakdown | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Feature 082 (FR-012): the count in progress. Kept on the server as Mary moves through it, not part
  // of the form — it is scratch work, and the saved gross cash is the record.
  const [count, setCount] = useState<CashCount>({});
  const [counting, setCounting] = useState(false);
  // Feature 082 (FR-023, FR-026): a sale or a check is recorded, corrected and removed on its own, in the
  // shared dialog.
  const [dialog, setDialog] = useState<{ editing?: GateCheck | GateSale } | null>(null);

  useEffect(() => {
    void apiFetch("/api/series")
      .then((r) => r.json())
      .then((d) => setSeries(d.items ?? []));
    void apiFetch("/api/me/capabilities")
      .then((r) => r.json())
      .then((d) => setCanWrite(d.gateWrite === true));
  }, []);

  const dirty = form !== null && JSON.stringify(form) !== baseline;

  // FR-008: leaving with unsaved entries asks first.
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  const refreshSummaries = useCallback(async (eventId: string) => {
    const [p, b] = await Promise.all([
      apiFetch(`/api/events/${eventId}/payment-summary`),
      apiFetch(`/api/events/${eventId}/attendance-breakdown`),
    ]);
    setPayments(p.ok ? ((await p.json()) as PaymentSummary) : null);
    setBreakdown(b.ok ? ((await b.json()) as AttendanceBreakdown) : null);
  }, []);

  const show = useCallback((data: Payload) => {
    const next = formFrom(data.doorRecord);
    setLoaded({ record: data.doorRecord, sales: data.gateSales, checks: data.checks });
    setCount(data.doorRecord.cashCount ?? {});
    setForm(next);
    setBaseline(JSON.stringify(next));
  }, []);

  /**
   * After a sale or check is written on its own, bring back what was recorded — the sales, the checks, the
   * performers' cash — WITHOUT touching the form: whatever Mary has typed but not saved stays typed.
   */
  const reload = useCallback(async (recordId: string) => {
    const res = await apiFetch(`/api/door-records/${recordId}`);
    if (!res.ok) return;
    const data = (await res.json()) as Payload;
    setLoaded({ record: data.doorRecord, sales: data.gateSales, checks: data.checks });
  }, []);

  async function removeSale(sale: GateSale) {
    if (!loaded) return;
    const what = `${CATEGORY_LABEL[sale.category] ?? sale.category}${sale.contactName ? ` to ${sale.contactName}` : ""}`;
    if (!window.confirm(`Remove the sale of ${what} for $${sale.amount.toFixed(2)}?`)) return;
    const done = await send(`/api/gate-sales/${sale.id}`, "DELETE");
    if (!done.ok) return setStatus(`The sale was not removed: ${done.message}`);
    await reload(loaded.record.id);
  }

  async function removeCheck(check: GateCheck) {
    if (!loaded) return;
    if (!window.confirm(`Remove the check from ${check.writer} for $${check.amount.toFixed(2)}?`))
      return;
    const done = await send(`/api/gate-checks/${check.id}`, "DELETE");
    if (!done.ok) return setStatus(`The check was not removed: ${done.message}`);
    await reload(loaded.record.id);
  }

  const open = useCallback(
    async (next: EventRow) => {
      setEvent(next);
      setLoaded(null);
      setForm(null);
      setWarnings([]);
      setStatus(null);
      void refreshSummaries(next.id);
      const res = await apiFetch(`/api/events/${next.id}/door-record`, { method: "POST" });
      if (!res.ok) return setStatus("Could not open the evening's record.");
      show(await res.json());
    },
    [refreshSummaries, show],
  );

  // FR-008: changing the event with unsaved entries asks first; declining keeps everything as it was.
  const choose = useCallback(
    (next: EventRow) => {
      if (next.id === event?.id) return;
      if (dirty && !window.confirm(UNSAVED)) return;
      void open(next);
    },
    [dirty, event?.id, open],
  );

  const change = (patch: Partial<MoneyForm>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setStatus(null);
  };

  const figures = useMemo(
    () => (form && loaded ? previewMoney(form, loaded.record, loaded.sales, loaded.checks) : null),
    [form, loaded],
  );

  function keepCount(next: CashCount) {
    setCount(next);
    if (loaded) void send(`/api/door-records/${loaded.record.id}`, "PATCH", { cashCount: next });
  }

  async function save() {
    if (!form || !loaded) return;
    setSaving(true);
    setStatus(null);
    setWarnings([]);
    const saved = await send<DoorRecord & { warnings: Warning[] }>(
      `/api/door-records/${loaded.record.id}`,
      "PATCH",
      {
        grossCash: toNumber(form.grossCash),
        seedFloat: toNumber(form.seedFloat),
        cashPaidOut: toNumber(form.cashPaidOut),
        // An emptied box clears a reason saved earlier (null), rather than leaving it in place.
        cashPaidOutReason: form.cashPaidOutReason.trim() || null,
        pcGross: toNumber(form.pcGross),
        posTransactionCount: toNumber(form.posTransactionCount),
        compCount: toNumber(form.compCount),
        giftCardRedemptionCount: toNumber(form.giftCardRedemptionCount),
        eveningNote: form.eveningNote,
      },
    );
    setSaving(false);
    if (!saved.ok) return setStatus(`Nothing was saved: ${saved.message}`);

    const { warnings: found, ...record } = saved.data;
    setCount(record.cashCount ?? {}); // the Save drops the count (FR-012)
    // The form now matches what was kept, so nothing is unsaved — even where the server tidied a figure.
    setLoaded((l) => (l ? { ...l, record } : l));
    setBaseline(JSON.stringify(form));
    setWarnings(found ?? []);
    setStatus("Saved");
    if (event) void refreshSummaries(event.id);
  }

  return (
    <main className={styles.page}>
      <EventConfirm event={event} series={series} onSelect={choose} defaultToMySeries />
      {payments && <PaymentSummaryView summary={payments} />}
      {figures && <MoneyPreview figures={figures} showFee={canWrite} />}

      {form && loaded && (
        <>
          <DoorCounts
            form={form}
            record={loaded.record}
            breakdown={breakdown}
            disabled={!canWrite}
            onChange={change}
          />
          <CashSection
            form={form}
            record={loaded.record}
            disabled={!canWrite}
            onChange={change}
            countButton={
              canWrite && (
                <button type="button" className={styles.button} onClick={() => setCounting(true)}>
                  Count
                </button>
              )
            }
          />
          {counting && (
            <CountDialog
              initial={count}
              onKeep={keepCount}
              onUse={(total) => {
                change({ grossCash: total.toFixed(2) });
                setCounting(false);
              }}
              onClose={() => setCounting(false)}
            />
          )}
          <CardSection
            form={form}
            feeCents={canWrite && figures ? figures.cardFeeCents : null}
            disabled={!canWrite}
            onChange={change}
          />
          <section aria-labelledby="gate-sales" className={styles.section}>
            <h2 id="gate-sales" className={styles.sectionHeading}>
              Sales
            </h2>
            <SaleList
              sales={loaded.sales}
              actions={
                canWrite
                  ? (sale) => (
                      <div className={styles.buttons}>
                        <button
                          type="button"
                          className={styles.button}
                          onClick={() => setDialog({ editing: sale })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={styles.button}
                          onClick={() => void removeSale(sale)}
                        >
                          Remove
                        </button>
                      </div>
                    )
                  : undefined
              }
            />
            {canWrite && (
              <button type="button" className={styles.button} onClick={() => setDialog({})}>
                Add a sale
              </button>
            )}
          </section>

          <section aria-labelledby="gate-checks" className={styles.section}>
            <h2 id="gate-checks" className={styles.sectionHeading}>
              Checks
            </h2>
            <CheckList
              checks={loaded.checks}
              actions={
                canWrite
                  ? (c) => (
                      <div className={styles.buttons}>
                        <button
                          type="button"
                          className={styles.button}
                          onClick={() => setDialog({ editing: c })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={styles.button}
                          onClick={() => void removeCheck(c)}
                        >
                          Remove
                        </button>
                      </div>
                    )
                  : undefined
              }
            />
          </section>

          {figures && (
            <DepositList
              figures={figures}
              form={form}
              performerCash={loaded.record.performerCash.reduce((a, p) => a + p.amount, 0)}
              checks={loaded.checks}
            />
          )}
          {dialog && (
            <SaleOrCheckDialog
              doorRecordId={loaded.record.id}
              canMark={canWrite}
              editing={dialog.editing}
              onSaved={() => {
                setDialog(null);
                void reload(loaded.record.id);
              }}
              onClose={() => setDialog(null)}
            />
          )}

          <section aria-labelledby="gate-note" className={styles.section}>
            <h2 id="gate-note" className={styles.sectionHeading}>
              Notes
            </h2>
            <label className={styles.field}>
              The evening&apos;s note
              <textarea
                className={styles.input}
                rows={3}
                value={form.eveningNote}
                disabled={!canWrite}
                onChange={(e) => change({ eveningNote: e.target.value })}
              />
            </label>
          </section>

          <div className={styles.save}>
            {canWrite && (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void save()}
                disabled={saving}
              >
                Save
              </button>
            )}
            {warnings.length > 0 && (
              <ul aria-label="Warnings" className={styles.warnings}>
                {warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            )}
            <p role="status" className={styles.quiet}>
              {status}
            </p>
          </div>
        </>
      )}
    </main>
  );
}
