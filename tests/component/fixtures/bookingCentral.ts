import { vi } from "vitest";

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
  venueShortName: string | null;
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
  venueShortName: "GH",
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
            mySeriesIds: ["s1"],
            bookingWrite: opts.bookingWrite ?? true,
            eventWrite: opts.eventWrite ?? true,
            venueWrite: opts.venueWrite ?? true,
            performerWrite: opts.performerWrite ?? true,
          };
        }
        if (url.includes("/api/series")) {
          return { items: [{ id: "s1", key: "tnc", name: "Thursday Night Contra" }] };
        }
        if (url.includes("/api/bookings/report")) return { rows: opts.rows, nextCursor: null };

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
