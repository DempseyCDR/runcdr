"use client";
import { apiFetch } from "@/app/apiFetch";

import { useCallback, useEffect, useRef, useState } from "react";
import { localToday } from "@/app/localToday";
import AdminPage from "../_components/AdminPage";
import { BookingModal } from "../_modals/BookingModal";
import { EventModal } from "../_modals/EventModal";
import VenueForm, { type Venue } from "../venues/VenueForm";
import type {
  BookingsReportBookingLine,
  BookingsReportRow,
} from "@/server/domain/bookings/reportService";
import { HubRow, NEXT, type RowActions } from "./HubRow";
import HubSearch from "./HubSearch";
import BandRoster from "./BandRoster";
import PerformerCard from "./PerformerCard";
import Lineup from "./Lineup";
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

/** Rows per page. Small enough to paint quickly; the table loads more as the Booker scrolls. */
const PAGE = 40;
/** The API's ceiling on one page — the most a refresh can re-read in one go. */
const MAX_PAGE = 200;

/** Today plus four months, `YYYY-MM-DD` — the default horizon (FR-001). */
function fourMonthsAhead(): string {
  const [y, m, d] = localToday().split("-").map(Number) as [number, number, number];
  return localToday(new Date(y, m - 1 + 4, d));
}

/** How each reason reads in the list — the words the Booker would use. */
const NEED_REASON = { none: "no contact", archived: "contact archived", merged: "contact merged" };

/** The bookings that make up a dance's music. Open-band musicians are not booked, so never listed (FR-007). */
const MUSIC = new Set(["lead_musician", "musician"]);

const COLUMNS = ["Date", "Time", "Dance", "Venue", "Caller", "Music", "Sound"];

/** A panel over the page. Every record the row opens appears here — the Booker never navigates away. */
function Panel({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // A panel that opens on a search box puts the cursor in it, so the Booker can type at once (087
  // walk-through). Only on opening: a panel's content changing must not steal the cursor back.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input[type="search"]')?.focus();
  }, []);
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        {children}
      </div>
    </div>
  );
}

export default function BookingCentralPage() {
  const [series, setSeries] = useState<Series[]>([]);
  const [showing, setShowing] = useState<Series | null | "all">(null);
  const [caps, setCaps] = useState<Caps>({
    bookingWrite: false,
    eventWrite: false,
    venueWrite: false,
    performerWrite: false,
  });
  const [venues, setVenues] = useState<{ id: string; name: string; shortName: string | null }[]>(
    [],
  );
  const [horizon, setHorizon] = useState(fourMonthsAhead);
  const [rows, setRows] = useState<BookingsReportRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

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

  const loadNeeding = useCallback(async () => {
    const res = await apiFetch("/api/performers/needing-contact");
    setNeeding(res.ok ? ((await res.json()).items ?? []) : []);
  }, []);
  useEffect(() => {
    void loadNeeding();
  }, [loadNeeding]);

  // Whose series is this? The viewer's own, when their roles name exactly one (the rule feature 086 set
  // for the evening lists). Otherwise every series — and the heading says so, never mixing silently.
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
      const only = mine.length === 1 ? all.find((s) => s.id === mine[0]) : undefined;
      setShowing(only ?? "all");
    })();
  }, []);

  const fetchPage = useCallback(
    async (cursor: string | null, limit: number) => {
      if (showing === null) return null;
      const q = new URLSearchParams({ horizon, limit: String(limit) });
      if (showing !== "all") q.set("series", showing.key);
      if (cursor) q.set("cursor", cursor);
      const res = await apiFetch(`/api/bookings/report?${q.toString()}`);
      if (!res.ok) return null;
      return (await res.json()) as { rows: BookingsReportRow[]; nextCursor: string | null };
    },
    [showing, horizon],
  );

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      setError(null);
      const page = await fetchPage(cursor, PAGE);
      setLoading(false);
      if (!page) {
        if (showing !== null) setError("The dances could not be loaded.");
        return;
      }
      setRows((prev) => (cursor ? [...prev, ...page.rows] : page.rows));
      setNextCursor(page.nextCursor);
    },
    [fetchPage, showing],
  );

  // After an edit, re-read as many rows as are showing, so the Booker keeps his place in the history
  // rather than being thrown back to the top.
  const refresh = useCallback(async () => {
    const page = await fetchPage(null, Math.min(Math.max(rows.length, PAGE), MAX_PAGE));
    if (!page) return;
    setRows(page.rows);
    setNextCursor(page.nextCursor);
  }, [fetchPage, rows.length]);

  // A new series or horizon starts the table again from the top.
  useEffect(() => {
    void load(null);
  }, [load]);

  // Scrolling to the foot loads older dances without a page break (US1 scenario 6). The button below
  // does the same thing, and stays, because an endless scroll is a trap for keyboard and screen-reader
  // users unless there is also something to press.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !nextCursor || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !loading) void load(nextCursor);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [nextCursor, loading, load]);

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
      setRows((prev) =>
        prev.map((r) =>
          r.eventId !== row.eventId
            ? r
            : {
                ...r,
                bookings: r.bookings.map((b) =>
                  b.bookingId === line.bookingId ? { ...b, status: next } : b,
                ),
              },
        ),
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

  const heading = showing === "all" ? "All series" : (showing?.name ?? "");
  // A save anywhere may settle a performer's link, so the count is re-read with the table.
  const saved = () => {
    void refresh();
    void loadNeeding();
  };

  return (
    <AdminPage title="Booking Central" identity wide>
      <div className={styles.head}>
        <h2 className={styles.series}>{heading}</h2>
        <label className={styles.horizon}>
          Showing dances from{" "}
          <input
            type="date"
            aria-label="Showing dances from"
            value={horizon}
            onChange={(e) => e.target.value && setHorizon(e.target.value)}
          />
        </label>
      </div>

      <HubSearch
        onPerformer={(p) => void openPerformer(p.id)}
        onBand={(b) => setBandCard(b)}
        onNewPerformer={caps.performerWrite ? (name) => setPerformerCard({ name }) : undefined}
        onNewBand={caps.performerWrite ? (name) => setBandCard({ name }) : undefined}
        q={searchQ}
        onQ={setSearchQ}
      />

      {/* FR-001c: the fourth and last thing above the table. Absent when there is no such work — a
          notice that never goes away teaches the Booker to stop reading it. */}
      {needing.length > 0 && (
        <p className={styles.horizon}>
          <button type="button" className={styles.link} onClick={() => setNeedingOpen(true)}>
            {needing.length === 1
              ? "1 performer needs a contact"
              : `${needing.length} performers need a contact`}
          </button>
        </p>
      )}

      {error && <p role="alert">{error}</p>}

      <table className={styles.table} aria-label="Dances">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <HubRow key={r.eventId} row={r} columns={COLUMNS.length} actions={actions} />
          ))}
        </tbody>
      </table>

      {!loading && rows.length === 0 && !error && <p>No dances from {horizon} back.</p>}

      <div ref={sentinel} className={styles.more}>
        {nextCursor && (
          <button type="button" onClick={() => void load(nextCursor)} disabled={loading}>
            {loading ? "Loading…" : "Load older dances"}
          </button>
        )}
      </div>

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
        <Panel label={venueOpen.name} onClose={() => setVenueOpen(null)}>
          <h2>{venueOpen.name}</h2>
          <VenueForm
            venue={venueOpen}
            readOnly={!caps.venueWrite}
            onSaved={() => {
              setVenueOpen(null);
              saved();
            }}
            onClose={() => setVenueOpen(null)}
          />
        </Panel>
      )}

      {lineup && (
        <Panel
          label={`${lineup.row.band ?? "Music"} — ${lineup.row.date}`}
          onClose={() => setLineup(null)}
        >
          <h2>
            {lineup.row.band ?? "Music"} — {lineup.row.date}
          </h2>
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
            onClose={() => setLineup(null)}
          />
        </Panel>
      )}

      {needingOpen && (
        <Panel label="Performers needing a contact" onClose={() => setNeedingOpen(false)}>
          <h2>Performers needing a contact</h2>
          <p>Open one to settle it: link a contact, create one, or archive the performer.</p>
          <ul aria-label="Performers who need a contact" className={styles.results}>
            {needing.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => {
                    setNeedingOpen(false);
                    void openPerformer(n.id);
                  }}
                >
                  {n.displayName}
                </button>{" "}
                <span className={styles.kind}>{NEED_REASON[n.reason]}</span>
              </li>
            ))}
          </ul>
          {needing.length === 0 && <p>None — every performer can be reached.</p>}
        </Panel>
      )}

      {performerCard && (
        <Panel
          label={performerCard.performer?.displayName ?? "New performer"}
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
        </Panel>
      )}

      {bandCard && (
        <Panel label={bandCard.id ? bandCard.name : "New band"} onClose={() => setBandCard(null)}>
          <h2>{bandCard.id ? bandCard.name : "New band"}</h2>
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
        </Panel>
      )}

      {callerFor && (
        <Panel
          label={`Caller or instructor for ${callerFor.date}`}
          onClose={() => setCallerFor(null)}
        >
          <h2>Caller or instructor for {callerFor.date}</h2>
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
        </Panel>
      )}

      {musicFor && (
        // 087 walk-through: booking music is ONE search, the hub's own — performers and bands together.
        // A band picked is booked in one act; a performer picked opens their booking, already chosen.
        <Panel
          label={`Book music for ${musicFor.date}`}
          onClose={() => {
            setMusicFor(null);
            setMusicQ("");
          }}
        >
          <h2>Book music for {musicFor.date}</h2>
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
        </Panel>
      )}
    </AdminPage>
  );
}
