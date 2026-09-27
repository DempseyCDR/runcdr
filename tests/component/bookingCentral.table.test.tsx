// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";

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
          return { rows: opts.rows ?? [FULL, EMPTY], nextCursor: opts.nextCursor ?? null };
        }
        return { items: [] };
      };
      return { ok: true, status: 200, json };
    }),
  );
  return calls;
}

const table = () => screen.getByRole("table", { name: /dances/i });

/** Wait for the DATA, not the table: the table renders empty at once, before the rows arrive. */
const loaded = () =>
  waitFor(() => expect(within(table()).getAllByRole("row").length).toBeGreaterThan(1));
const rowFor = (label: string) =>
  within(table())
    .getAllByRole("row")
    .find((r) => r.textContent?.includes(label)) as HTMLElement;

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
    const full = within(rowFor("Waltz night"));
    expect(full.getByText("2026-10-01")).toBeInTheDocument();
    expect(full.getByText("19:30")).toBeInTheDocument();
    expect(full.getByText("GH")).toBeInTheDocument();
  });

  it("names the series at the head of the table (T013, FR-006)", async () => {
    stub();
    render(<BookingCentralPage />);
    expect(
      await screen.findByRole("heading", { name: /Thursday Night Contra/ }),
    ).toBeInTheDocument();
  });

  it("asks for the Booker's own series, up to four months ahead (FR-001, FR-001a)", async () => {
    const calls = stub();
    render(<BookingCentralPage />);
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/bookings/report"))).toBe(true),
    );

    const report = calls.find((c) => c.url.includes("/api/bookings/report"))!.url;
    expect(report).toContain("series=tnc");
    const horizon = new URL(report, "http://x").searchParams.get("horizon")!;
    const months = (new Date(horizon).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30.4);
    expect(months).toBeGreaterThan(3.8);
    expect(months).toBeLessThan(4.2);
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
  it("names a band by its name and loose musicians by their last names (FR-003)", async () => {
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
    expect(loose.getByText("Scanlon")).toBeInTheDocument();
    expect(loose.getByText("Fortier")).toBeInTheDocument();
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

    const cell = within(rowFor("Both")).getByRole("cell", { name: /Pat Caller/ });
    const text = cell.textContent ?? "";
    expect(text).toContain("Ina Instructor");
    expect(text.indexOf("Pat Caller")).toBeLessThan(text.indexOf("Ina Instructor"));
  });
});

describe("Booking Central — reaching further (087 US1)", () => {
  it("loads older dances when the Booker reaches the foot (T020)", async () => {
    const calls = stub({ rows: [FULL], nextCursor: "cur1" });
    render(<BookingCentralPage />);
    await loaded();

    await userEvent.click(screen.getByRole("button", { name: /older dances/i }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/bookings/report") && c.url.includes("cursor=cur1")),
      ).toBe(true),
    );
  });

  it("offers no 'older' control when the history is exhausted", async () => {
    stub({ rows: [FULL], nextCursor: null });
    render(<BookingCentralPage />);
    await loaded();

    expect(screen.queryByRole("button", { name: /older dances/i })).toBeNull();
  });

  it("lets the Booker push the horizon further out (T019, FR-001a)", async () => {
    const calls = stub();
    render(<BookingCentralPage />);
    await loaded();

    // A direct change event: typing into a date input is unreliable in jsdom.
    fireEvent.change(screen.getByLabelText(/showing dances from/i), {
      target: { value: "2027-09-01" },
    });
    await waitFor(() => expect(calls.some((c) => c.url.includes("horizon=2027-09-01"))).toBe(true));
  });
});
