import { vi } from "vitest";
import { SUMMARY } from "./paymentSummary";

/**
 * Feature 081: a stubbed server for the rebuilt /payments page and its dialogs. Tests override only what they
 * are about; every request is recorded.
 */
export type Call = { url: string; method: string; body: unknown };

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const EVENT = {
  id: "e1",
  eventDate: today(),
  seriesId: "s-tnc",
  startTime: "19:30:00",
  label: null,
};
export const SERIES = [{ id: "s-tnc", key: "tnc", name: "Thursday Night Contra" }];

export type BookingFixture = {
  id: string;
  performerId: string;
  performerName: string;
  performerType: string;
  payCents: number;
  requiresCheck: boolean;
  isDonated: boolean;
  status: string;
};

export const BOOKING = (over: Partial<BookingFixture> & { id: string; performerName: string }) => ({
  performerId: `p-${over.id}`,
  performerType: "musician",
  payCents: 10000,
  requiresCheck: true,
  isDonated: false,
  status: "confirmed",
  ...over,
});

export const LINE = (bookingId: string, amount: number, over: Record<string, unknown> = {}) => ({
  bookingId,
  amount,
  booked: amount,
  eventId: "e1",
  eventDate: EVENT.eventDate,
  performer: "",
  performerType: "musician",
  ...over,
});

export const PAYMENT = (over: Record<string, unknown> & { id: string; lines: unknown[] }) => ({
  eventId: "e1",
  payeePerformerId: "p-x",
  payee: "",
  method: "check",
  amount: 0,
  checkNumber: "9001",
  overrideReason: null,
  voided: false,
  voidReason: null,
  voidedAt: null,
  replacesPaymentId: null,
  replacedByCheckNumber: null,
  ...over,
});

export type Reply = { status: number; body?: unknown };
export type StubOpts = {
  bookings?: unknown[];
  payments?: unknown[];
  list?: Record<string, unknown>;
  canWrite?: boolean;
  /** Replies to writes, by "METHOD path-suffix"; a function may vary per call. */
  writes?: Record<string, Reply | ((body: unknown, n: number) => Reply)>;
  performers?: { id: string; displayName: string; bookedAs?: string | null }[];
  roles?: { performerType: string; rate: number }[];
  unpaid?: unknown[];
  contacts?: unknown[];
  /** The evening being paid, when not today. */
  eventDate?: string;
};

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => (body === undefined ? Promise.reject(new Error("no body")) : body),
});

export function stubPayments(opts: StubOpts = {}): Call[] {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: u, method, body });

      if (method !== "GET") {
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
        return json({ id: "new" }, method === "POST" ? 201 : 200);
      }

      if (u.startsWith("/api/me/capabilities"))
        return json({ performerPaymentWrite: opts.canWrite ?? true });
      if (u.startsWith("/api/series")) return json({ items: SERIES });
      if (u.endsWith("/api/events/e1/bookings"))
        return json({ bookings: opts.bookings ?? [], performerTotal: 0 });
      if (u.endsWith("/api/events/e1/performer-payments"))
        return json({
          payments: opts.payments ?? [],
          voidedByBooking: {},
          paidElsewhere: {},
          summary: SUMMARY(),
          treasurerReportGeneratedAt: null,
          settledByBooking: {},
          reconciliation: { expected: 0, actual: 0, delta: 0 },
          ...opts.list,
        });
      if (u.endsWith("/api/events/e1/roles")) return json({ roles: opts.roles ?? [] });
      if (u.includes("/unpaid-bookings")) return json({ bookings: opts.unpaid ?? [] });
      if (u.startsWith("/api/performers?")) {
        const q = (new URL(u, "http://x").searchParams.get("q") ?? "").toLowerCase();
        return json({
          items: (opts.performers ?? []).filter((p) => p.displayName.toLowerCase().includes(q)),
        });
      }
      if (u.startsWith("/api/attendance/search")) return json({ items: opts.contacts ?? [] });
      if (u.startsWith("/api/events"))
        return json({ items: [{ ...EVENT, eventDate: opts.eventDate ?? EVENT.eventDate }] });
      return json({ items: [] });
    }),
  );
  return calls;
}

export const writesTo = (calls: Call[], method: string, suffix: string) =>
  calls.filter((c) => c.method === method && c.url.endsWith(suffix));
