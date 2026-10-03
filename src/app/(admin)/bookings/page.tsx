"use client";
import { apiFetch } from "@/app/apiFetch";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { localToday } from "@/app/localToday";
import AdminPage from "../_components/AdminPage";
import Dialog from "@/app/_components/Dialog";
import { BookingModal } from "../_modals/BookingModal";
import { EventModal } from "../_modals/EventModal";
import VenueForm, { type Venue } from "../venues/VenueForm";
import type {
  BookingsReportBookingLine,
  BookingsReportRow,
} from "@/server/domain/bookings/reportService";
import { HubCard } from "./HubCard";
import DanceView from "./DanceView";
import { NEXT, type RowActions } from "./danceParts";
import HubSearch from "./HubSearch";
import BandRoster from "./BandRoster";
import PerformerCard from "./PerformerCard";
import Lineup from "./Lineup";
import NeedingContactList from "./NeedingContactList";
import type { Performer } from "../_performers/PerformerForm";
import type { PerformerNeedingContact } from "@/server/domain/performers/needContact";
import styles from "./hub.module.css";

/**
 * Feature 087 — Booking Central, the Booker's hub.
 *
 * Sean books the club's dances from a spreadsheet: one row per dance, sorted by date, every performer and
 * every gap visible at once. This is that spreadsheet, made live. It replaces the thin per-event booking
 * editor that lived here before, and absorbs the bookings report, performers and bands.
 *
 * A WORKING surface, not a document: it scrolls back without end and is never printed. The printed
 * document is the organizer report (B59). New dances are made on the events page (FR-013b).
 */

type Series = { id: string; key: string; name: string };
type Caps = {
  bookingWrite: boolean;
  eventWrite: boolean;
  venueWrite: boolean;
  performerWrite: boolean;
};
type FullBooking = {
  id: string;
  performerId: string;
  performerName: string;
  performerType: string;
  payCents: number;
  note: string | null;
  status: string;
  bandId: string | null;
};
type BookingModalState =
  | {
      mode: "create";
      eventId: string;
      eventDate: string;
      role: string;
      /** Picked from the music search, so already chosen. */
      performer?: { id: string; name: string };
      /** Typed into the music search, carried in to make a new performer from. */
      initialQuery?: string;
    }
  | {
      mode: "edit" | "readonly";
      eventId: string;
      eventDate: string;
      booking: {
        id: string;
        performerId: string;
        performer: string;
        type: string;
        payCents: number;
        note: string | null;
        status: string;
      };
    };
type EventModalState = {
  mode: "edit" | "readonly";
  event: {
    id: string;
    seriesKey: string;
    eventDate: string;
    startTime: string | null;
    venueId: string | null;
    rentCents: number | null;
    label: string | null;
    description: string | null;
    note: string | null;
    status: "scheduled" | "cancelled";
  };
};
type Lineup = { row: BookingsReportRow; bookings: FullBooking[] };

/**
 * Rows per page (feature 091, research R3): about ten dances ahead on opening (FR-007), a page behind,
 * and more each time the Booker reaches an end. Small enough to paint quickly.
 */
const FIRST_AHEAD = 10;
const MORE_AHEAD = 20;
const PAGE_BEHIND = 40;
/** The API's ceiling on one page — the most a refresh can re-read in one go. */
const MAX_PAGE = 200;

type Direction = "older" | "newer";
/**
 * The dances held, on each side of the split (feature 091, data-model.md): `newer` nearest first, as the
 * read answers it; `older` newest first. Shown newest first throughout — `newer` reversed, then `older`.
 */
type Sides = {
  newer: BookingsReportRow[];
  newerCursor: string | null;
  older: BookingsReportRow[];
  olderCursor: string | null;
};
const NO_SIDES: Sides = { newer: [], newerCursor: null, older: [], olderCursor: null };

/** The bookings that make up a dance's music. Open-band musicians are not booked, so never listed (FR-007). */
const MUSIC = new Set(["lead_musician", "musician"]);

/**
 * Feature 091 (research R6): the table from the second named width, cards below it — one tree at a time,
 * so no control is in the page twice. With no `matchMedia` (the server, and any browser without it) the
 * page is the table, as it was before 091.
 */
function media(query: string, withoutMatchMedia: boolean) {
  return {
    subscribe: (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    read: () =>
      typeof window.matchMedia !== "function"
        ? withoutMatchMedia
        : window.matchMedia(query).matches,
  };
}
const WIDE = media("(min-width: 48rem)", true);
/**
 * Rich, 2026-10-01: a phone on its side is wide but short. Under 450px tall the pinned header would take
 * too much of the window, so the search and the needs-a-contact prompt collapse into the one Performers
 * button, at the end of the title's line — the header is one line.
 */
const SHORT = media("(max-height: 450px)", false);

export default function BookingCentralPage() {
  const wide = useSyncExternalStore(WIDE.subscribe, WIDE.read, () => true);
  const short = useSyncExternalStore(SHORT.subscribe, SHORT.read, () => false);
  /** The search and the prompt behind one Performers button: on a phone, or in any short window. */
  const compact = !wide || short;
  const [series, setSeries] = useState<Series[]>([]);
  const [showing, setShowing] = useState<Series[] | null | "all">(null);
  const [caps, setCaps] = useState<Caps>({
    bookingWrite: false,
    eventWrite: false,
    venueWrite: false,
    performerWrite: false,
  });
  const [venues, setVenues] = useState<{ id: string; name: string; shortName: string | null }[]>(
    [],
  );
  // Feature 091 (research R1–R3): today on this device, fixed when the page opens — the split the list
  // is read from, both ways.
  const [split] = useState(() => localToday());
  const [sides, setSides] = useState<Sides>(NO_SIDES);
  const [loaded, setLoaded] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const [loading, setLoading] = useState<Direction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  /**
   * The dance at the top of the view, and where it stood, before later dances were added above — so the
   * view can be held still (R3). Not the page's height: new rows can change the table's column widths,
   * and rows below re-wrap, so the page grows by less than what was added above the Booker's place.
   */
  const anchor = useRef<{ id: string; top: number } | null>(null);
  /** The dance last in view, kept as the Booker scrolls, so a change of width can return to it (R6). */
  const lastInView = useRef<string | null>(null);

  const rows = useMemo(() => [...sides.newer].reverse().concat(sides.older), [sides]);
  /** The first dance dated today or later, else the most recent (FR-007, research R2). */
  const defaultDance = sides.newer[0]?.eventId ?? sides.older[0]?.eventId ?? null;
  const setRows = (change: (r: BookingsReportRow) => BookingsReportRow) =>
    setSides((s) => ({ ...s, newer: s.newer.map(change), older: s.older.map(change) }));

  // Feature 091 US1: the dance opened from its card — held by id, so a re-read shows its new state.
  const [openDance, setOpenDance] = useState<string | null>(null);
  const [bookingModal, setBookingModal] = useState<BookingModalState | null>(null);
  const [eventModal, setEventModal] = useState<EventModalState | null>(null);
  const [venueOpen, setVenueOpen] = useState<Venue | null>(null);
  const [lineup, setLineup] = useState<Lineup | null>(null);
  const [musicFor, setMusicFor] = useState<BookingsReportRow | null>(null);
  // 087 walk-through: the caller cell's "+" — a second caller, or an instructor (never gap-marked).
  const [callerFor, setCallerFor] = useState<BookingsReportRow | null>(null);
  // The music search's own text — separate from the hub's, which it must not disturb.
  const [musicQ, setMusicQ] = useState("");
  const [bands, setBands] = useState<{ id: string; name: string }[]>([]);
  // US3: what the search opened — a performer's card, or a band's roster. Each is either a record that
  // exists or a name to make one from.
  const [performerCard, setPerformerCard] = useState<{
    performer?: Performer;
    name?: string;
  } | null>(null);
  // `bookFor`: a band made from the band picker, to be booked for that dance once it exists.
  const [bandCard, setBandCard] = useState<{
    id?: string;
    name: string;
    bookFor?: BookingsReportRow;
  } | null>(null);
  // The hub search's text, held here so a band just saved can be searched for (087 walk-through).
  const [searchQ, setSearchQ] = useState("");
  // US5 (FR-026): the performers the Booker cannot reach — counted above the table, listed on asking.
  const [needing, setNeeding] = useState<PerformerNeedingContact[]>([]);
  const [needingOpen, setNeedingOpen] = useState(false);
  // Feature 091 US3: the phone's Performers dialog — the search and the needing list in one place.
  const [performersOpen, setPerformersOpen] = useState(false);

  const loadNeeding = useCallback(async () => {
    const res = await apiFetch("/api/performers/needing-contact");
    setNeeding(res.ok ? ((await res.json()).items ?? []) : []);
  }, []);
  useEffect(() => {
    void loadNeeding();
  }, [loadNeeding]);

  // Whose series is this? The viewer's own — every series their roles name (Rich, 2026-10-02: a Booker of
  // contra and the community dance sees those two, not ECD). A club-wide role names none: every series,
  // and the heading says so, never mixing silently.
  useEffect(() => {
    void (async () => {
      const [capsRes, seriesRes, venuesRes] = await Promise.all([
        apiFetch("/api/me/capabilities"),
        apiFetch("/api/series"),
        apiFetch("/api/venues"),
      ]);
      const c = capsRes.ok ? await capsRes.json() : {};
      const all: Series[] = seriesRes.ok ? ((await seriesRes.json()).items ?? []) : [];
      setVenues(venuesRes.ok ? ((await venuesRes.json()).items ?? []) : []);
      setSeries(all);
      setCaps({
        bookingWrite: !!c.bookingWrite,
        eventWrite: !!c.eventWrite,
        venueWrite: !!c.venueWrite,
        performerWrite: !!c.performerWrite,
      });
      const mine: string[] = c.mySeriesIds ?? [];
      const own = all.filter((s) => mine.includes(s.id));
      setShowing(own.length > 0 ? own : "all");
    })();
  }, []);

  const fetchPage = useCallback(
    async (direction: Direction, cursor: string | null, limit: number) => {
      if (showing === null) return null;
      const q = new URLSearchParams({ split, direction, limit: String(limit) });
      if (showing !== "all") q.set("series", showing.map((s) => s.key).join(","));
      if (cursor) q.set("cursor", cursor);
      const res = await apiFetch(`/api/bookings/report?${q.toString()}`);
      if (!res.ok) return null;
      return (await res.json()) as { rows: BookingsReportRow[]; nextCursor: string | null };
    },
    [showing, split],
  );

  // Opening, and a new series: the dances from today on and those before today, together (R1, R2).
  useEffect(() => {
    if (showing === null) return;
    let cancelled = false;
    void (async () => {
      setError(null);
      const [ahead, behind] = await Promise.all([
        fetchPage("newer", null, FIRST_AHEAD),
        fetchPage("older", null, PAGE_BEHIND),
      ]);
      if (cancelled) return;
      if (!ahead || !behind) {
        setError("The dances could not be loaded.");
        return;
      }
      setSides({
        newer: ahead.rows,
        newerCursor: ahead.nextCursor,
        older: behind.rows,
        olderCursor: behind.nextCursor,
      });
      setPositioned(false);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [showing, fetchPage]);

  /** The dance whose element is lowest while still starting inside the window (R6). */
  const findLastInView = useCallback(() => {
    let last: string | null = null;
    for (const el of list.current?.querySelectorAll<HTMLElement>("[data-dance]") ?? []) {
      const box = el.getBoundingClientRect();
      if (box.bottom > 0 && box.top < window.innerHeight) last = el.dataset.dance ?? last;
    }
    return last;
  }, []);

  /** Bring a dance's last line to the bottom of the window. Event ids are UUIDs: safe in a selector. */
  const scrollToDance = useCallback(
    (id: string) =>
      list.current?.querySelector(`[data-dance="${id}"]`)?.scrollIntoView({ block: "end" }),
    [],
  );

  // Once both first pages are in the page, put the default dance at the bottom of the window (FR-007).
  useLayoutEffect(() => {
    if (!loaded || positioned) return;
    if (defaultDance) scrollToDance(defaultDance);
    lastInView.current = findLastInView();
    setPositioned(true);
  }, [loaded, positioned, defaultDance, findLastInView, scrollToDance]);

  // Feature 091 (FR-017): the page's header is pinned just under the volunteer bar, whose height varies
  // (one line on a phone, one or two on a computer) — so the bar's height is kept in a variable.
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>("[data-volunteer-bar]");
    const root = document.documentElement;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const set = () => root.style.setProperty("--volunteer-bar-height", `${bar.offsetHeight}px`);
    const observer = new ResizeObserver(set);
    observer.observe(bar);
    set();
    return () => {
      observer.disconnect();
      root.style.removeProperty("--volunteer-bar-height");
    };
  }, []);

  // Keep note of the dance last in view as the Booker scrolls, so a change of width can return to it.
  useEffect(() => {
    const note = () => {
      lastInView.current = findLastInView();
    };
    window.addEventListener("scroll", note, { passive: true });
    return () => window.removeEventListener("scroll", note);
  }, [findLastInView]);

  // Crossing 48rem swaps cards and table; bring back the dance that was last in view (X1).
  const firstWidth = useRef(true);
  useLayoutEffect(() => {
    if (firstWidth.current) {
      firstWidth.current = false;
      return;
    }
    if (lastInView.current) scrollToDance(lastInView.current);
  }, [wide, scrollToDance]);

  const loadMore = useCallback(
    async (direction: Direction) => {
      const cursor = direction === "newer" ? sides.newerCursor : sides.olderCursor;
      if (!cursor || loading) return;
      setLoading(direction);
      const page = await fetchPage(
        direction,
        cursor,
        direction === "newer" ? MORE_AHEAD : PAGE_BEHIND,
      );
      setLoading(null);
      if (!page) return setError("The dances could not be loaded.");
      // Later dances go in ABOVE what the Booker is reading: note where the top dance in view stands,
      // and hold it there (R3).
      if (direction === "newer") {
        const dances = [...(list.current?.querySelectorAll<HTMLElement>("[data-dance]") ?? [])];
        const top = dances.find((el) => el.getBoundingClientRect().bottom > 0) ?? dances[0];
        anchor.current = top?.dataset.dance
          ? { id: top.dataset.dance, top: top.getBoundingClientRect().top }
          : null;
      }
      setSides((s) =>
        direction === "newer"
          ? { ...s, newer: [...s.newer, ...page.rows], newerCursor: page.nextCursor }
          : { ...s, older: [...s.older, ...page.rows], olderCursor: page.nextCursor },
      );
    },
    [sides.newerCursor, sides.olderCursor, loading, fetchPage],
  );

  // After later dances are added above, scroll by however far the noted dance moved, so it is where it was.
  useLayoutEffect(() => {
    const held = anchor.current;
    if (!held) return;
    anchor.current = null;
    const el = list.current?.querySelector(`[data-dance="${held.id}"]`);
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - held.top);
  }, [sides.newer]);

  // After an edit, re-read the same span on each side, so the Booker keeps his place (R9).
  const refresh = useCallback(async () => {
    const span = (n: number) => Math.min(Math.max(n, 1), MAX_PAGE);
    const [ahead, behind] = await Promise.all([
      fetchPage("newer", null, span(sides.newer.length)),
      fetchPage("older", null, span(sides.older.length)),
    ]);
    if (!ahead || !behind) return;
    setSides({
      newer: ahead.rows,
      newerCursor: ahead.nextCursor,
      older: behind.rows,
      olderCursor: behind.nextCursor,
    });
  }, [fetchPage, sides.newer.length, sides.older.length]);

  // Reaching either end loads more that way, once the page has opened on its dance — by scrolling, or
  // with the arrow keys. No buttons (Rich, 2026-10-01: they are not needed); 087's "load older" button
  // is retired with them.
  useEffect(() => {
    if (!positioned || typeof IntersectionObserver === "undefined") return;
    const watch = (el: HTMLElement | null, direction: Direction) => {
      if (!el) return null;
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore(direction);
      });
      observer.observe(el);
      return observer;
    };
    const observers = [watch(top.current, "newer"), watch(foot.current, "older")];
    return () => observers.forEach((o) => o?.disconnect());
  }, [positioned, loadMore]);

  const eventBookings = async (eventId: string): Promise<FullBooking[]> => {
    const res = await apiFetch(`/api/events/${eventId}/bookings`);
    return res.ok ? ((await res.json()).bookings ?? []) : [];
  };

  const toModalBooking = (b: FullBooking) => ({
    id: b.id,
    performerId: b.performerId,
    performer: b.performerName,
    type: b.performerType,
    payCents: b.payCents,
    note: b.note ?? null,
    status: b.status,
  });

  const actions: RowActions = {
    canBook: caps.bookingWrite,

    async openEvent(row) {
      const res = await apiFetch(`/api/events/${row.eventId}`);
      if (!res.ok) return;
      const e = await res.json();
      setEventModal({
        mode: caps.eventWrite ? "edit" : "readonly",
        event: {
          id: e.id,
          seriesKey: series.find((s) => s.id === e.seriesId)?.key ?? "",
          eventDate: e.eventDate,
          startTime: e.startTime ?? null,
          venueId: e.venueId ?? null,
          rentCents: e.rentCents ?? null,
          label: e.label ?? null,
          description: e.description ?? null,
          note: e.note ?? null,
          status: e.status === "cancelled" ? "cancelled" : "scheduled",
        },
      });
    },

    async openVenue(venueId) {
      const res = await apiFetch(`/api/venues/${venueId}`);
      if (res.ok) setVenueOpen(await res.json());
    },

    // FR-009: a name opens THAT booking, in the booking editor that already existed — whose Notes box
    // already satisfies FR-015. The full record is read on opening, so the editor never shows stale pay.
    async openBooking(row, bookingId) {
      const b = (await eventBookings(row.eventId)).find((x) => x.id === bookingId);
      if (!b) return;
      setBookingModal({
        mode: caps.bookingWrite ? "edit" : "readonly",
        eventId: row.eventId,
        eventDate: row.date,
        booking: toModalBooking(b),
      });
    },

    // FR-010: a band opens THAT DANCE's music, not the band's own record — every musician booked for
    // the evening, the band's and anyone beside it, since a substitute is the evening's lineup too (US4).
    async openBand(row) {
      const [all, bandList] = await Promise.all([
        eventBookings(row.eventId),
        caps.bookingWrite ? loadBands() : Promise.resolve([]),
      ]);
      setBands(bandList);
      setLineup({ row, bookings: all.filter((b) => MUSIC.has(b.performerType)) });
    },

    // FR-011, FR-012: one step along the cycle. A band is advanced by its lead alone, and the service's
    // existing cascade carries the rest — never a loop of writes from the browser.
    async advance(row, line: BookingsReportBookingLine) {
      const next = NEXT[line.status];
      if (!next) return;
      const res = await apiFetch(`/api/bookings/${encodeURIComponent(line.bookingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setError("That booking could not be updated.");
        return;
      }
      setRows((r) =>
        r.eventId !== row.eventId
          ? r
          : {
              ...r,
              bookings: r.bookings.map((b) =>
                b.bookingId === line.bookingId ? { ...b, status: next } : b,
              ),
            },
      );
    },

    // FR-013a: the gap and the way to fill it are the same object.
    fill(row, role) {
      if (role === "music") setMusicFor(row);
      else setBookingModal({ mode: "create", eventId: row.eventId, eventDate: row.date, role });
    },

    // Another into a filled slot: the same choices the gap offers, plus the instructor.
    add(row, cell) {
      if (cell === "music") setMusicFor(row);
      else if (cell === "caller") setCallerFor(row);
      else {
        setBookingModal({
          mode: "create",
          eventId: row.eventId,
          eventDate: row.date,
          role: "sound_tech",
        });
      }
    },
  };

  async function loadBands(): Promise<{ id: string; name: string }[]> {
    const res = await apiFetch("/api/bands");
    return res.ok ? ((await res.json()).items ?? []) : [];
  }

  /** Re-read an open lineup, so a member's booking saved over it shows its new pay and state. */
  const refreshLineup = async (eventId: string) => {
    const all = await eventBookings(eventId);
    setLineup((cur) =>
      cur && cur.row.eventId === eventId
        ? { ...cur, bookings: all.filter((b) => MUSIC.has(b.performerType)) }
        : cur,
    );
  };

  // Booking a whole band in one act. It lived only on the per-event page this hub replaces, and has no
  // home in the booking editor — so without this the club would have lost it.
  const bookBand = async (row: BookingsReportRow, bandId: string) => {
    const res = await apiFetch(`/api/events/${row.eventId}/book-band`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bandId }),
    });
    if (!res.ok) {
      setError("That band could not be booked.");
      return;
    }
    await refresh();
  };

  /**
   * Open the card on the WHOLE record, never the search row. The search answers with summaries — id and
   * name — so a row carries no contact and no archived flag; opening the form on one made every performer
   * look unlinked and archived (found in feature 084's browser walk).
   */
  const openPerformer = async (id: string) => {
    const res = await apiFetch(`/api/performers/${id}`);
    if (!res.ok) return setError("Could not open that performer.");
    setPerformerCard({ performer: (await res.json()) as Performer });
  };

  const heading = showing === "all" ? "All series" : (showing ?? []).map((s) => s.name).join(" & ");
  const openRow = openDance ? rows.find((r) => r.eventId === openDance) : undefined;
  // The performer-and-band search: above the table on a computer, in the Performers dialog on a phone.
  const search = (
    <HubSearch
      onPerformer={(p) => void openPerformer(p.id)}
      onBand={(b) => setBandCard(b)}
      onNewPerformer={caps.performerWrite ? (name) => setPerformerCard({ name }) : undefined}
      onNewBand={caps.performerWrite ? (name) => setBandCard({ name }) : undefined}
      q={searchQ}
      onQ={setSearchQ}
    />
  );
  // A save anywhere may settle a performer's link, so the count is re-read with the table.
  const saved = () => {
    void refresh();
    void loadNeeding();
  };

  const head = !compact ? (
    <>
      {search}

      {/* FR-001c: the last thing above the table. Absent when there is no such work — a notice that
          never goes away teaches the Booker to stop reading it. */}
      {needing.length > 0 && (
        <p className={styles.prompt}>
          <button type="button" className={styles.link} onClick={() => setNeedingOpen(true)}>
            {needing.length === 1
              ? "1 performer needs a contact"
              : `${needing.length} performers need a contact`}
          </button>
        </p>
      )}
    </>
  ) : (
    // Feature 091 (FR-012, FR-018): on a phone, or in a window under 450px tall (a phone on its side),
    // one button holds the search and the performers who need a contact.
    <button type="button" className={styles.performers} onClick={() => setPerformersOpen(true)}>
      Performers
    </button>
  );

  return (
    // Feature 091 (FR-011, FR-017): one line at every width — the series is named in the title — pinned
    // with the controls beside it under the volunteer bar, since the page opens scrolled down.
    <AdminPage
      title={heading ? `Booking Central — ${heading}` : "Booking Central"}
      wide
      head={head}
      pinned
      headBeside={short}
    >
      {error && <p role="alert">{error}</p>}

      {/* Feature 091 (FR-008, FR-009): reaching the top loads later dances, the foot older ones; each end
          says "Loading…" while it does, and says so when there are no more. */}
      <div ref={top} className={styles.end} data-end="later">
        {loading === "newer" && <p>Loading…</p>}
        {!sides.newerCursor && loaded && rows.length > 0 && <p>No later dances</p>}
      </div>

      {/* One card per dance at every width (Rich, 2026-10-01): a phone's opens the dance; from 48rem the
          card is live and spreads across the page. The table is retired. */}
      <ul
        ref={(el) => {
          list.current = el;
        }}
        className={wide ? `${styles.cards} ${styles.wideCards}` : styles.cards}
        aria-label="Dances"
      >
        {rows.map((r) => (
          <HubCard
            key={r.eventId}
            row={r}
            wide={wide}
            actions={actions}
            onOpen={() => setOpenDance(r.eventId)}
          />
        ))}
      </ul>

      {loaded && rows.length === 0 && !error && <p>No dances.</p>}

      <div ref={foot} className={styles.end} data-end="earlier">
        {loading === "older" && <p>Loading…</p>}
        {!sides.olderCursor && loaded && rows.length > 0 && <p>No earlier dances</p>}
      </div>

      {/* Before every editor it opens, so they stack on top of it (feature 089's dialog order). */}
      {/* Feature 091 (FR-012): the phone's Performers — before the dialogs it opens, so they stack on top. */}
      {performersOpen && compact && (
        <Dialog heading="Performers" onClose={() => setPerformersOpen(false)}>
          {search}
          {needing.length > 0 && (
            <NeedingContactList needing={needing} onOpen={(id) => void openPerformer(id)} />
          )}
        </Dialog>
      )}

      {openRow && (
        <DanceView
          row={openRow}
          actions={actions}
          canEditDance={caps.eventWrite}
          onClose={() => setOpenDance(null)}
        />
      )}

      {bookingModal && (
        <BookingModal
          {...bookingModal}
          onClose={() => setBookingModal(null)}
          onSaved={() => {
            saved();
            // Opened over a band's lineup: the lineup stays, re-read, for the next member (087).
            if (lineup) void refreshLineup(lineup.row.eventId);
          }}
        />
      )}

      {eventModal && (
        <EventModal
          mode={eventModal.mode}
          event={eventModal.event}
          venues={venues}
          withNote
          withStatus
          onClose={() => setEventModal(null)}
          onSaved={saved}
        />
      )}

      {venueOpen && (
        <Dialog heading={venueOpen.name} onClose={() => setVenueOpen(null)}>
          <VenueForm
            venue={venueOpen}
            readOnly={!caps.venueWrite}
            onSaved={() => {
              setVenueOpen(null);
              saved();
            }}
            onClose={() => setVenueOpen(null)}
          />
        </Dialog>
      )}

      {lineup && (
        <Dialog
          heading={`${lineup.row.band ?? "Music"} — ${lineup.row.date}`}
          onClose={() => setLineup(null)}
        >
          <Lineup
            eventId={lineup.row.eventId}
            band={lineup.row.band}
            bandId={lineup.row.bandId}
            bookings={lineup.bookings}
            bands={bands}
            canBook={caps.bookingWrite}
            onOpenBooking={(b) => {
              const full = lineup.bookings.find((x) => x.id === b.id)!;
              // The lineup stays open beneath: saving or closing the booking returns to it (087).
              setBookingModal({
                mode: caps.bookingWrite ? "edit" : "readonly",
                eventId: lineup.row.eventId,
                eventDate: lineup.row.date,
                booking: toModalBooking(full),
              });
            }}
            onAddMusician={() => {
              setBookingModal({
                mode: "create",
                eventId: lineup.row.eventId,
                eventDate: lineup.row.date,
                role: "musician",
              });
            }}
            onRepointed={() => {
              setLineup(null);
              saved();
            }}
            onChanged={() => {
              saved();
              void refreshLineup(lineup.row.eventId);
            }}
          />
        </Dialog>
      )}

      {needingOpen && (
        <Dialog heading="Performers needing a contact" onClose={() => setNeedingOpen(false)}>
          <NeedingContactList
            needing={needing}
            onOpen={(id) => {
              setNeedingOpen(false);
              void openPerformer(id);
            }}
          />
        </Dialog>
      )}

      {performerCard && (
        <Dialog
          heading={performerCard.performer?.displayName ?? "New performer"}
          onClose={() => setPerformerCard(null)}
        >
          <PerformerCard
            performer={performerCard.performer}
            initialName={performerCard.name}
            readOnly={!caps.performerWrite}
            onSaved={() => {
              setPerformerCard(null);
              saved();
            }}
            onClose={() => setPerformerCard(null)}
            onOpenBand={(b) => {
              setPerformerCard(null);
              setBandCard(b);
            }}
          />
        </Dialog>
      )}

      {bandCard && (
        <Dialog
          heading={bandCard.id ? bandCard.name : "New band"}
          onClose={() => setBandCard(null)}
        >
          <BandRoster
            bandId={bandCard.id}
            initialName={bandCard.id ? undefined : bandCard.name}
            readOnly={!caps.performerWrite}
            onSaved={(band) => {
              const bookFor = bandCard.bookFor;
              setBandCard(null);
              // Made from the band picker: book it for the dance it was made for.
              if (bookFor && band?.id) return void bookBand(bookFor, band.id);
              // Otherwise show it: the hub searches for the band just saved, by name.
              if (band?.name) setSearchQ(band.name);
              saved();
            }}
            onClose={() => setBandCard(null)}
          />
        </Dialog>
      )}

      {callerFor && (
        <Dialog
          heading={`Caller or instructor for ${callerFor.date}`}
          onClose={() => setCallerFor(null)}
        >
          <div className={styles.choices}>
            {(["caller", "instructor"] as const).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => {
                  setBookingModal({
                    mode: "create",
                    eventId: callerFor.eventId,
                    eventDate: callerFor.date,
                    role,
                  });
                  setCallerFor(null);
                }}
              >
                {role === "caller" ? "Book a caller" : "Book an instructor"}
              </button>
            ))}
          </div>
        </Dialog>
      )}

      {musicFor && (
        // 087 walk-through: booking music is ONE search, the hub's own — performers and bands together.
        // A band picked is booked in one act; a performer picked opens their booking, already chosen.
        <Dialog
          heading={`Book music for ${musicFor.date}`}
          onClose={() => {
            setMusicFor(null);
            setMusicQ("");
          }}
        >
          <HubSearch
            q={musicQ}
            onQ={setMusicQ}
            withArchived={false}
            onPerformer={(p) => {
              setBookingModal({
                mode: "create",
                eventId: musicFor.eventId,
                eventDate: musicFor.date,
                role: "musician",
                performer: p,
              });
              setMusicFor(null);
              setMusicQ("");
            }}
            onBand={(b) => {
              setMusicFor(null);
              setMusicQ("");
              void bookBand(musicFor, b.id);
            }}
            onNewPerformer={
              caps.performerWrite
                ? (name) => {
                    setBookingModal({
                      mode: "create",
                      eventId: musicFor.eventId,
                      eventDate: musicFor.date,
                      role: "musician",
                      initialQuery: name,
                    });
                    setMusicFor(null);
                    setMusicQ("");
                  }
                : undefined
            }
            onNewBand={
              caps.performerWrite
                ? (name) => {
                    setBandCard({ name, bookFor: musicFor });
                    setMusicFor(null);
                    setMusicQ("");
                  }
                : undefined
            }
          />
        </Dialog>
      )}
    </AdminPage>
  );
}
