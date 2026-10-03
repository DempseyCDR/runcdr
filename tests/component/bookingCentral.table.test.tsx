// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import {
  answerReport,
  danceCard,
  dancesList,
  dancesLoaded,
  slotOf,
  stubScrolling,
} from "./fixtures/bookingCentral";

/**
 * Feature 087 US1 — the season on one page.
 *
 * Sean's spreadsheet, made live: one row per dance, newest first, the gaps as loud as the bookings. These
 * cases drive the table only; clicking anything on it is US2.
 */

type Line = {
  bookingId: string;
  performerId: string;
  performer: string;
  type: string;
  status: string;
  note: string | null;
  bandId: string | null;
};
type Row = {
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

const line = (over: Partial<Line> & Pick<Line, "performer" | "type">): Line => ({
  bookingId: `b-${over.performer}`,
  performerId: `p-${over.performer}`,
  status: "confirmed",
  note: null,
  bandId: null,
  ...over,
});

const row = (over: Partial<Row> & Pick<Row, "eventId" | "date">): Row => ({
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

/** A dance with everyone booked. */
const FULL = row({
  eventId: "e-full",
  date: "2026-10-01",
  label: "Waltz night",
  caller: "Pat Caller",
  band: "The Trio",
  bandId: "band1",
  soundTech: "Sam Sound",
  bookings: [
    line({ performer: "Pat Caller", type: "caller", status: "tentative" }),
    line({ performer: "Ann Fiddle", type: "lead_musician", bandId: "band1" }),
    line({ performer: "Sam Sound", type: "sound_tech", status: "requested" }),
  ],
});

/** A dance with nobody booked at all. */
const EMPTY = row({ eventId: "e-empty", date: "2026-09-24" });

type Opts = { rows?: Row[]; nextCursor?: string | null; mySeriesIds?: string[] };
type Call = { url: string };

function stub(opts: Opts = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push({ url });
      const json = async () => {
        if (url.includes("/api/me/capabilities")) {
          return { mySeriesIds: opts.mySeriesIds ?? ["s1"], bookingWrite: true };
        }
        if (url.includes("/api/series")) {
          return {
            items: [
              { id: "s1", key: "tnc", name: "Thursday Night Contra" },
              { id: "s2", key: "ecd", name: "Sunday English Country Dance" },
            ],
          };
        }
        if (url.includes("/api/bookings/report")) {
          // Feature 091: answered by direction, as the server does; `nextCursor` stands for more older
          // dances behind the first page.
          const page = answerReport(opts.rows ?? [FULL, EMPTY], url);
          const firstOlder = !url.includes("direction=newer") && !url.includes("cursor=");
          return firstOlder && opts.nextCursor ? { ...page, nextCursor: opts.nextCursor } : page;
        }
        return { items: [] };
      };
      return { ok: true, status: 200, json };
    }),
  );
  return calls;
}

// Feature 091: one card per dance at every width — 087's table and its rows are retired.
const table = dancesList;
const loaded = () => dancesLoaded();
const rowFor = danceCard;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Booking Central — the season on one page (087 US1)", () => {
  it("shows one row per dance, newest first, with date, time, label and venue (T013)", async () => {
    stub();
    render(<BookingCentralPage />);
    await loaded();

    const text = table().textContent ?? "";
    expect(text.indexOf("2026-10-01")).toBeLessThan(text.indexOf("2026-09-24")); // newest first
    // Feature 091: a wide card's heading line — date · time · label · venue.
    const full = rowFor("Waltz night");
    expect(full).toHaveTextContent("2026-10-01 · 19:30");
    expect(within(full).getByText("German House")).toBeInTheDocument();
  });

  // Feature 091 (FR-011): the series is named in the page's one-line title, not a second heading.
  it("names the series in the page's title (T013, FR-006, 091 FR-011)", async () => {
    stub();
    render(<BookingCentralPage />);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Booking Central — Thursday Night Contra",
      }),
    ).toBeInTheDocument();
  });

  // Feature 091 (FR-010) retired the four-months horizon (087 FR-001a); the series rule (FR-001) stands.
  it("asks for the Booker's own series (FR-001)", async () => {
    const calls = stub();
    render(<BookingCentralPage />);
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/bookings/report"))).toBe(true),
    );

    const report = calls.find((c) => c.url.includes("/api/bookings/report"))!.url;
    expect(report).toContain("series=tnc");
  });

  it("carries no retired filter above the table (FR-001b, FR-001c)", async () => {
    stub();
    render(<BookingCentralPage />);
    await loaded();

    // The caller, musician and band filters and the sort toggle are deliberately gone.
    expect(screen.queryByRole("combobox", { name: /caller/i })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /musician/i })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /band/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /sort/i })).toBeNull();
  });
});

describe("Booking Central — the gaps (087 US1, FR-004, FR-004a)", () => {
  it("marks an unbooked caller and unbooked music as needing attention (T014)", async () => {
    stub({ rows: [EMPTY] });
    render(<BookingCentralPage />);
    await loaded();

    const r = within(rowFor("2026-09-24"));
    expect(r.getByLabelText("No caller booked")).toBeInTheDocument();
    expect(r.getByLabelText("No music booked")).toBeInTheDocument();
  });

  it("marks a missing sound tech ONLY where the series uses one (T014)", async () => {
    stub({
      rows: [
        row({ eventId: "e-tnc", date: "2026-09-25", label: "With sound", hasSoundTech: true }),
        row({ eventId: "e-ecd", date: "2026-09-26", label: "Without sound", hasSoundTech: false }),
      ],
    });
    render(<BookingCentralPage />);
    await loaded();

    expect(within(rowFor("With sound")).getByLabelText("No sound tech booked")).toBeInTheDocument();
    // A series with no sound tech never shows the mark — a permanent warning is one nobody reads.
    expect(within(rowFor("Without sound")).queryByLabelText("No sound tech booked")).toBeNull();
  });

  it("never marks a gap for an instructor, and an instructor does not fill the caller's (T014)", async () => {
    stub({
      rows: [
        row({
          eventId: "e-ws",
          date: "2026-09-27",
          label: "Workshop",
          instructor: "Ina Instructor",
          bookings: [line({ performer: "Ina Instructor", type: "instructor" })],
        }),
      ],
    });
    render(<BookingCentralPage />);
    await loaded();

    const r = within(rowFor("Workshop"));
    expect(r.queryByLabelText(/no instructor/i)).toBeNull();
    // A workshop does not excuse a dance from having someone to call it (spec edge case).
    expect(r.getByLabelText("No caller booked")).toBeInTheDocument();
  });

  it("does not mark anything for a dance where everyone is booked", async () => {
    stub({ rows: [FULL] });
    render(<BookingCentralPage />);
    await loaded();

    expect(within(rowFor("Waltz night")).queryByLabelText(/^No .* booked$/)).toBeNull();
  });
});

describe("Booking Central — what a row says (087 US1)", () => {
  // Feature 091 (FR-002b): on a card, loose musicians are first initial and last name.
  it("names a band by its name and loose musicians by first initial and last name (FR-003, 091 FR-002b)", async () => {
    stub({
      rows: [
        FULL,
        row({
          eventId: "e-loose",
          date: "2026-09-28",
          label: "Loose",
          musicians: ["Jim Scanlon", "Jo Fortier"],
          bookings: [
            line({ performer: "Jim Scanlon", type: "musician" }),
            line({ performer: "Jo Fortier", type: "musician" }),
          ],
        }),
      ],
    });
    render(<BookingCentralPage />);
    await loaded();

    expect(within(rowFor("Waltz night")).getByText("The Trio")).toBeInTheDocument();
    const loose = within(rowFor("Loose"));
    expect(loose.getByText("J. Scanlon")).toBeInTheDocument();
    expect(loose.getByText("J. Fortier")).toBeInTheDocument();
  });

  it("shows each booking's state as its letter (FR-002)", async () => {
    stub({ rows: [FULL] });
    render(<BookingCentralPage />);
    await loaded();

    const r = within(rowFor("Waltz night"));
    expect(r.getByLabelText("Pat Caller: tentative")).toHaveTextContent("T");
    expect(r.getByLabelText("Sam Sound: requested")).toHaveTextContent("R");
  });

  it("says a cancelled dance is cancelled IN WORDS, not by colour alone (T015, FR-005)", async () => {
    stub({
      rows: [row({ eventId: "e-c", date: "2026-09-29", label: "Snowed out", cancelled: true })],
    });
    render(<BookingCentralPage />);
    await loaded();

    expect(within(rowFor("Snowed out")).getByText(/cancelled/i)).toBeInTheDocument();
  });

  it("shows the dance's note beneath its row (T015, FR-014)", async () => {
    stub({
      rows: [row({ eventId: "e-n", date: "2026-09-30", label: "Noted", note: "ask Dave first" })],
    });
    render(<BookingCentralPage />);
    await loaded();

    expect(within(table()).getByText("ask Dave first")).toBeInTheDocument();
  });

  it("names an instructor in the caller's cell, caller first when both (T016, FR-003a)", async () => {
    stub({
      rows: [
        row({
          eventId: "e-both",
          date: "2026-10-02",
          label: "Both",
          caller: "Pat Caller",
          instructor: "Ina Instructor",
          bookings: [
            line({ performer: "Ina Instructor", type: "instructor" }),
            line({ performer: "Pat Caller", type: "caller" }),
          ],
        }),
      ],
    });
    render(<BookingCentralPage />);
    await loaded();

    const text = slotOf(rowFor("Both"), "Caller").textContent ?? "";
    expect(text).toContain("I. Instructor");
    expect(text.indexOf("P. Caller")).toBeLessThan(text.indexOf("I. Instructor"));
  });
});

describe("Booking Central — reaching further (087 US1)", () => {
  // Feature 091 (Rich, 2026-10-01): reaching the foot loads older dances; there is no button.
  it("loads older dances when the Booker reaches the foot (T020)", async () => {
    const reach = stubScrolling();
    const calls = stub({ rows: [FULL], nextCursor: "cur1" });
    render(<BookingCentralPage />);
    await loaded();

    await waitFor(() => reach("earlier"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/bookings/report") && c.url.includes("cursor=cur1")),
      ).toBe(true),
    );
  });

  it("says so when the history is exhausted", async () => {
    stub({ rows: [FULL], nextCursor: null });
    render(<BookingCentralPage />);
    await loaded();

    expect(await screen.findByText("No earlier dances")).toBeInTheDocument();
  });

  // Feature 091 (FR-010): the horizon control — "Showing dances from" (087 T019) — is retired.
  it("has no Showing dances from control", async () => {
    stub();
    render(<BookingCentralPage />);
    await loaded();
    expect(screen.queryByLabelText(/showing dances from/i)).toBeNull();
  });
});
