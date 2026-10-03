import { expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

/**
 * Feature 087 — shared fixtures for Booking Central's component tests (US2 onwards).
 *
 * One stub answers every endpoint the hub and its modals touch, and records each call with its method and
 * body, so a test can assert what was SENT as well as what was shown.
 */

export type Line = {
  bookingId: string;
  performerId: string;
  performer: string;
  type: string;
  status: string;
  note: string | null;
  bandId: string | null;
};

export type Row = {
  eventId: string;
  date: string;
  startTime: string | null;
  label: string | null;
  series: string;
  venueId: string | null;
  venueName: string | null;
  hasSoundTech: boolean;
  caller: string | null;
  instructor: string | null;
  band: string | null;
  bandId: string | null;
  musicians: string[];
  soundTech: string | null;
  cancelled: boolean;
  note: string | null;
  bookings: Line[];
};

export const line = (over: Partial<Line> & Pick<Line, "performer" | "type">): Line => ({
  bookingId: `b-${over.performer}`,
  performerId: `p-${over.performer}`,
  status: "confirmed",
  note: null,
  bandId: null,
  ...over,
});

export const row = (over: Partial<Row> & Pick<Row, "eventId" | "date">): Row => ({
  startTime: "19:30:00",
  label: null,
  series: "Thursday Night Contra",
  venueId: "v1",
  venueName: "German House",
  hasSoundTech: true,
  caller: null,
  instructor: null,
  band: null,
  bandId: null,
  musicians: [],
  soundTech: null,
  cancelled: false,
  note: null,
  bookings: [],
  ...over,
});

/** Newest first: `date desc, start time desc nulls last, id desc` — the hub's order (087). */
const newestFirst = (a: Row, b: Row): number =>
  b.date.localeCompare(a.date) ||
  (a.startTime === b.startTime
    ? 0
    : a.startTime === null
      ? 1
      : b.startTime === null
        ? -1
        : b.startTime.localeCompare(a.startTime)) ||
  b.eventId.localeCompare(a.eventId);

/**
 * Feature 091 (contracts/report-api.md): answer `/api/bookings/report` as the server does. `older` is the
 * dances before `split`, newest first; `newer` is those on or after it, nearest first. The cursor is the
 * offset already served in that direction. With neither `split` nor `direction`, every row, as before.
 */
export function answerReport(rows: Row[], url: string): { rows: Row[]; nextCursor: string | null } {
  const p = new URL(url, "http://x").searchParams;
  const split = p.get("split");
  const direction = p.get("direction");
  if (!split && !direction) return { rows, nextCursor: null };
  const sorted = [...rows].sort(newestFirst);
  const side =
    direction === "newer"
      ? sorted.filter((r) => !split || r.date >= split).reverse()
      : sorted.filter((r) => !split || r.date < split);
  const from = Number(p.get("cursor") ?? 0);
  const limit = Number(p.get("limit") ?? side.length);
  const page = side.slice(from, from + limit);
  return { rows: page, nextCursor: from + limit < side.length ? String(from + limit) : null };
}

/**
 * Feature 091: the screen's width, as `matchMedia("(min-width: 48rem)")` reports it. Without this the page
 * treats the screen as wide (the table), so tests written before 091 are unchanged. Returns a function that
 * changes the width and tells the page, as a real resize would.
 */
export function setWidth(
  width: "narrow" | "wide",
  /** Under 450px tall — a phone on its side (Rich, 2026-10-01). */
  short = false,
): (to: "narrow" | "wide") => void {
  let matches = width === "wide";
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        if (query.includes("max-height")) return short;
        return query.includes("48rem") ? matches : false;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })),
  );
  return (to) => {
    matches = to === "wide";
    listeners.forEach((fn) => fn());
  };
}

/**
 * Feature 091 (Rich, 2026-10-01): the list loads more only by being scrolled to an end — there are no
 * buttons. jsdom has no IntersectionObserver; this stands in, and `reach("later")` / `reach("earlier")`
 * tells the page the Booker has scrolled to the top or the foot of the list.
 */
export function stubScrolling(): (end: "later" | "earlier") => void {
  const observers = new Set<{ callback: IntersectionObserverCallback; targets: Set<Element> }>();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private entry: { callback: IntersectionObserverCallback; targets: Set<Element> };
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback, targets: new Set() };
        observers.add(this.entry);
      }
      observe(el: Element) {
        this.entry.targets.add(el);
      }
      disconnect() {
        observers.delete(this.entry);
      }
    },
  );
  return (end) => {
    const el = document.querySelector(`[data-end="${end}"]`);
    if (!el) throw new Error(`no ${end} end in the page`);
    for (const o of [...observers]) {
      if (o.targets.has(el)) {
        o.callback(
          [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      }
    }
  };
}

/**
 * Feature 091 (Rich, 2026-10-01): one card per dance at every width — the table is retired. These find
 * the list of dances and a dance's card, in place of 087's table and its rows.
 */
export const dancesList = () => screen.getByRole("list", { name: "Dances" });
/** Wait for the DATA, not the list: the list renders empty at once, before the dances arrive. */
export const dancesLoaded = (atLeast = 1) =>
  waitFor(() =>
    expect(within(dancesList()).getAllByRole("listitem").length).toBeGreaterThanOrEqual(atLeast),
  );
/** A dance's card, by any text on it. */
export const danceCard = (text: string) =>
  within(dancesList())
    .getAllByRole("listitem")
    .find((li) => li.textContent?.includes(text)) as HTMLElement;
/** One kind of performer on a card — Caller, Music or Sound — its names and marks. */
export const slotOf = (card: HTMLElement, term: "Caller" | "Music" | "Sound") => {
  const dt = within(card)
    .getAllByRole("term")
    .find((t) => t.textContent === term);
  if (!dt?.nextElementSibling) throw new Error(`no ${term} on the card`);
  return dt.nextElementSibling as HTMLElement;
};

export type Call = { url: string; method: string; body: unknown };

export type HubStub = {
  rows: Row[];
  /** Each booking's full record, as `GET /api/events/{id}/bookings` answers it. */
  eventBookings?: Record<string, unknown[]>;
  bookingWrite?: boolean;
  eventWrite?: boolean;
  venueWrite?: boolean;
  performerWrite?: boolean;
  /** US3: what the performer search answers. */
  performers?: { id: string; displayName: string }[];
  /** US3: what the band search answers (and the band picker's roster). */
  bands?: { id: string; name: string }[];
  truncated?: boolean;
  /** US3: a performer's full record, dances and bands, by performer id. */
  performer?: Record<string, unknown>;
  history?: unknown[];
  performerBands?: unknown[];
  /** US5: the performers needing a contact, as `GET /api/performers/needing-contact` answers. */
  needingContact?: { count: number; items: unknown[] };
  /** US3: a band's full record, as `GET /api/bands/{id}` answers it. */
  band?: Record<string, unknown>;
  /** Feature 091: the series the viewer's roles name; one is the Booker's own (the default, TNC). */
  mySeriesIds?: string[];
};

/** A performer's full record, as `GET /api/performers/{id}` answers it. */
export const performerRecord = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  displayName: "Glenrose Smith",
  bio: null,
  photoUrl: null,
  isPublic: false,
  isCaller: true,
  styles: [],
  links: [],
  contactId: "c1",
  contactName: "Glenrose Smith",
  archivedAt: null,
  ...over,
});

export function stubHub(opts: HubStub): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });

      const json = async (): Promise<unknown> => {
        if (url.includes("/api/me/capabilities")) {
          return {
            mySeriesIds: opts.mySeriesIds ?? ["s1"],
            bookingWrite: opts.bookingWrite ?? true,
            eventWrite: opts.eventWrite ?? true,
            venueWrite: opts.venueWrite ?? true,
            performerWrite: opts.performerWrite ?? true,
          };
        }
        if (url.includes("/api/series")) {
          return {
            items: [
              { id: "s1", key: "tnc", name: "Thursday Night Contra" },
              { id: "s2", key: "ecd", name: "Sunday English Country Dance" },
              { id: "s3", key: "cdob", name: "Community Dance" },
            ],
          };
        }
        if (url.includes("/api/bookings/report")) return answerReport(opts.rows, url);

        // A status change answers with the booking as saved.
        const patchBooking = /\/api\/bookings\/([^/?]+)$/.exec(url);
        if (patchBooking && method === "PATCH") {
          return { id: patchBooking[1], ...(body as object) };
        }

        const evBookings = /\/api\/events\/([^/?]+)\/bookings/.exec(url);
        if (evBookings) return { bookings: opts.eventBookings?.[evBookings[1]!] ?? [] };

        if (url.includes("/api/events/rent-preview")) return { rentCents: 0 };
        if (url.includes("/api/events/prior-defaults")) return {};

        const ev = /\/api\/events\/([^/?]+)$/.exec(url);
        if (ev) {
          const r = opts.rows.find((x) => x.eventId === ev[1]);
          return {
            id: ev[1],
            seriesId: "s1",
            eventDate: r?.date ?? "2026-10-01",
            startTime: r?.startTime ?? null,
            venueId: r?.venueId ?? null,
            rentCents: null,
            label: r?.label ?? null,
            description: "A public blurb",
            note: r?.note ?? null,
            status: r?.cancelled ? "cancelled" : "scheduled",
            ...(method === "PATCH" ? (body as object) : {}),
          };
        }

        const venue = /\/api\/venues\/([^/?]+)$/.exec(url);
        if (venue) {
          return {
            id: venue[1],
            name: "German House",
            shortName: "GH",
            address: "1 Main",
            landlordContactId: null,
            landlordName: null,
            archivedAt: null,
          };
        }
        if (url.includes("/api/venues")) {
          return { items: [{ id: "v1", name: "German House", shortName: "GH" }] };
        }
        // US5 — before the record route below, which would otherwise take "needing-contact" for an id.
        if (url.includes("/api/performers/needing-contact")) {
          return opts.needingContact ?? { count: 0, items: [] };
        }
        // US3 — performers: their dances, their email, their record, the search, and a create.
        if (/\/api\/performers\/[^/?]+\/history/.test(url)) return { items: opts.history ?? [] };
        if (/\/api\/performers\/[^/?]+\/mailto/.test(url)) return { email: null };
        const perf = /\/api\/performers\/([^/?]+)$/.exec(url);
        if (perf) return performerRecord({ id: perf[1], ...opts.performer });
        if (url.includes("/api/performers") && method === "POST") {
          return performerRecord({ id: "p-new", ...(body as object) });
        }
        if (url.includes("/api/performers")) {
          return { items: opts.performers ?? [], truncated: opts.truncated ?? false };
        }

        // US3 — bands: one performer's bands, one band's record, the search, and a create.
        if (url.includes("/api/bands?performer=")) return { items: opts.performerBands ?? [] };
        const band = /\/api\/bands\/([^/?]+)$/.exec(url);
        if (band) {
          return {
            id: band[1],
            name: "The Trio",
            bio: null,
            photoUrl: null,
            isPublic: false,
            styles: [],
            links: [],
            archivedAt: null,
            members: [],
            ...opts.band,
          };
        }
        if (url.includes("/api/bands") && method === "POST")
          return { id: "band-new", ...(body as object) };
        if (url.includes("/api/bands")) {
          return { items: opts.bands ?? [{ id: "band1", name: "The Trio" }], truncated: false };
        }
        return { items: [] };
      };
      return { ok: true, status: method === "POST" ? 201 : 200, json };
    }),
  );
  return calls;
}
