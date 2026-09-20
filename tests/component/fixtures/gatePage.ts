import { vi } from "vitest";
import { SUMMARY } from "./paymentSummary";
import { BREAKDOWN } from "./attendanceBreakdown";
import { SERIES, today, type Call, type Reply } from "./paymentsPage";

/**
 * Feature 082: a stubbed server for the rebuilt /gate page. Tests override only what they are about;
 * every request is recorded. The door record's shape is contracts/gate.md's.
 */
export const EVENT = {
  id: "e1",
  eventDate: today(),
  seriesId: "s-tnc",
  startTime: "19:30:00",
  label: null,
};
export const OTHER_EVENT = { ...EVENT, id: "e2", eventDate: "2026-01-08", label: "Winter" };

export const DOOR_RECORD = (over: Record<string, unknown> = {}) => ({
  id: "dr1",
  eventId: "e1",
  posTransactionCount: 9,
  pcGross: 180,
  grossCash: 500,
  seedFloat: 15,
  cashPaidOut: 0,
  cashPaidOutReason: null,
  deposit: 485,
  giftCardRedemptionCount: 2,
  compCount: 3,
  openBandCount: 4,
  performerCash: [],
  admission: { cash: 485, card: 180, check: 0, total: 665 },
  checksTotal: 0,
  cardFee: 4.93,
  deposits: [
    {
      kind: "main",
      amount: 485,
      makeUp: { countedCash: 500, seedFloat: 15, otherPaidOut: 0, performerCash: 0, checks: 0 },
    },
  ],
  eveningNote: null,
  cashCount: {},
  moneyRecordedBy: null,
  ...over,
});

/** A sale as the payload carries it — anonymous unless a test names someone. */
export const SALE = (over: Record<string, unknown> & { id: string }) => ({
  category: "merchandise",
  paymentMethod: "cash",
  amount: 0,
  contactId: null,
  contactName: null,
  membershipLevel: null,
  note: null,
  quantity: null,
  checkId: null,
  recordedBy: null,
  ...over,
});

/** A check received, with its lines. */
export const CHECK = (over: Record<string, unknown> & { id: string; lines: unknown[] }) => ({
  writerContactId: `c-${over.id}`,
  writer: "Chuck Writer",
  amount: 0,
  note: null,
  depositSeparately: false,
  recordedBy: null,
  ...over,
});

export type GateStubOpts = {
  doorRecord?: Record<string, unknown>;
  gateSales?: unknown[];
  checks?: unknown[];
  gateWrite?: boolean;
  events?: unknown[];
  /** The payment summary the page shows above the money. */
  summary?: Record<string, unknown>;
  /** Contacts the person search finds. */
  contacts?: { id: string; displayName: string; firstName?: string; lastName?: string | null }[];
  /** The payload a reload returns after a sale or check is recorded (defaults to the first one). */
  reloaded?: { doorRecord?: Record<string, unknown>; gateSales?: unknown[]; checks?: unknown[] };
  /** Replies to writes, by "METHOD path-suffix"; a function may vary per call. */
  writes?: Record<string, Reply | ((body: unknown, n: number) => Reply)>;
};

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => (body === undefined ? Promise.reject(new Error("no body")) : body),
});

export function stubGate(opts: GateStubOpts = {}): Call[] {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  const record = DOOR_RECORD(opts.doorRecord);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: u, method, body });

      const key = Object.keys(opts.writes ?? {}).find((k) => {
        const [m, suffix] = k.split(" ");
        return m === method && u.endsWith(suffix!);
      });
      if (key) {
        const n = (counts[key] = (counts[key] ?? 0) + 1);
        const w = opts.writes![key]!;
        const r = typeof w === "function" ? w(body, n) : w;
        return json(r.body, r.status);
      }

      if (u.startsWith("/api/me/capabilities"))
        return json({ gateWrite: opts.gateWrite ?? true, attendanceWrite: true });
      if (u.startsWith("/api/series")) return json({ items: SERIES });
      if (/\/api\/events\/e\d\/door-record$/.test(u) && method === "POST")
        return json({
          doorRecord: record,
          gateSales: opts.gateSales ?? [],
          checks: opts.checks ?? [],
        });
      // A reload after a sale or check is recorded on its own.
      if (u.endsWith("/api/door-records/dr1") && method === "GET")
        return json({
          doorRecord: DOOR_RECORD({ ...opts.doorRecord, ...opts.reloaded?.doorRecord }),
          gateSales: opts.reloaded?.gateSales ?? opts.gateSales ?? [],
          checks: opts.reloaded?.checks ?? opts.checks ?? [],
        });
      if (u.startsWith("/api/attendance/search")) {
        const q = (new URL(u, "http://x").searchParams.get("q") ?? "").toLowerCase();
        return json({
          items: (opts.contacts ?? []).filter((c) => c.displayName.toLowerCase().includes(q)),
        });
      }
      if (u === "/api/contacts" && method === "POST") {
        const b = body as { firstName: string; lastName?: string };
        const displayName = [b.firstName, b.lastName].filter(Boolean).join(" ");
        return json(
          { id: "c-new", displayName, firstName: b.firstName, lastName: b.lastName ?? null },
          201,
        );
      }
      if (method === "POST" && u.endsWith("/checks"))
        return json({ id: "k-new", enrolled: [] }, 201);
      if (method === "POST" && u.endsWith("/sales"))
        return json({ id: "s-new", enrolled: [] }, 201);
      if (method === "DELETE")
        return { ok: true, status: 204, json: async () => Promise.reject(new Error("no body")) };
      if (method === "PATCH" && (u.includes("/api/gate-checks/") || u.includes("/api/gate-sales/")))
        return json({ id: u.split("/").pop(), enrolled: [] });
      if (u.endsWith("/payment-summary")) return json(SUMMARY(opts.summary));
      if (u.endsWith("/attendance-breakdown")) return json(BREAKDOWN({ paying: 40 }));
      if (method === "PATCH" && u.endsWith("/api/door-records/dr1"))
        return json({ ...record, ...(body as object), warnings: [] });
      if (u.startsWith("/api/events")) return json({ items: opts.events ?? [EVENT] });
      return json({ items: [] });
    }),
  );
  return calls;
}

export const writesTo = (calls: Call[], method: string, suffix: string) =>
  calls.filter((c) => c.method === method && c.url.endsWith(suffix));
