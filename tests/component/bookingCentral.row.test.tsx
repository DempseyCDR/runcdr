// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { line, row, stubHub, type Row } from "./fixtures/bookingCentral";

/**
 * Feature 087 US2 — work the row.
 *
 * From the row in front of him, the Booker opens the dance, the venue or a booking, advances a booking
 * with one click, and fills a gap — without leaving the page.
 */

const DANCE: Row = row({
  eventId: "e1",
  date: "2026-10-01",
  label: "Waltz night",
  caller: "Pat Caller",
  band: "The Trio",
  bandId: "band1",
  bookings: [
    line({ performer: "Pat Caller", type: "caller", status: "proposed" }),
    line({ performer: "Ann Fiddle", type: "lead_musician", bandId: "band1" }),
  ],
});

const EMPTY: Row = row({ eventId: "e2", date: "2026-09-24", label: "Open night" });

const FULL_BOOKINGS = {
  e1: [
    {
      id: "b-Pat Caller",
      performerId: "p-Pat Caller",
      performerName: "Pat Caller",
      performerType: "caller",
      payCents: 15000,
      note: "prefers the long set",
      status: "proposed",
      bandId: null,
    },
    {
      id: "b-Ann Fiddle",
      performerId: "p-Ann Fiddle",
      performerName: "Ann Fiddle",
      performerType: "lead_musician",
      payCents: 10000,
      note: null,
      status: "confirmed",
      bandId: "band1",
    },
  ],
};

const table = () => screen.getByRole("table", { name: /dances/i });
const loaded = () =>
  waitFor(() => expect(within(table()).getAllByRole("row").length).toBeGreaterThan(1));
const rowFor = (text: string) =>
  within(
    within(table())
      .getAllByRole("row")
      .find((r) => r.textContent?.includes(text)) as HTMLElement,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Booking Central — the row's targets (087 US2)", () => {
  it("opens the dance when its label is clicked (T024, FR-008)", async () => {
    const calls = stubHub({ rows: [DANCE] });
    render(<BookingCentralPage />);
    await loaded();

    await userEvent.click(rowFor("Waltz night").getByRole("button", { name: "Waltz night" }));

    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/api/events/e1"))).toBe(true));
    expect(await screen.findByRole("dialog", { name: /event/i })).toBeInTheDocument();
  });

  it("opens the venue when its short code is clicked (T024, FR-008)", async () => {
    const calls = stubHub({ rows: [DANCE] });
    render(<BookingCentralPage />);
    await loaded();

    await userEvent.click(rowFor("Waltz night").getByRole("button", { name: "GH" }));

    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/api/venues/v1"))).toBe(true));
    expect(await screen.findByRole("dialog", { name: /German House/ })).toBeInTheDocument();
  });

  it("opens THAT booking when a caller's name is clicked (T025, FR-009)", async () => {
    stubHub({ rows: [DANCE], eventBookings: FULL_BOOKINGS });
    render(<BookingCentralPage />);
    await loaded();

    await userEvent.click(rowFor("Waltz night").getByRole("button", { name: "Pat Caller" }));

    const dialog = await screen.findByRole("dialog", { name: /^(booking —|book an? )/i });
    expect(within(dialog).getByDisplayValue("prefers the long set")).toBeInTheDocument();
  });

  it("opens that dance's BAND bookings when a band's name is clicked (T025, FR-010)", async () => {
    stubHub({ rows: [DANCE], eventBookings: FULL_BOOKINGS });
    render(<BookingCentralPage />);
    await loaded();

    await userEvent.click(rowFor("Waltz night").getByRole("button", { name: "The Trio" }));

    const lineup = await screen.findByRole("dialog", { name: /The Trio/ });
    expect(within(lineup).getByText("Ann Fiddle")).toBeInTheDocument();
  });
});

describe("Booking Central — the state control (087 US2, FR-011)", () => {
  /**
   * T026 — a PROPERTY, not an example. Clicking four times and expecting "confirmed" would pass while a
   * fifth click declined someone. So click far more times than the cycle is long, and assert what the
   * guarantee actually is: no sequence of ordinary clicks can ever decline a performer.
   */
  it("advances to confirmed and NEVER declines, however many times it is clicked", async () => {
    const calls = stubHub({ rows: [DANCE] });
    render(<BookingCentralPage />);
    await loaded();

    for (let i = 0; i < 20; i++) {
      const button = rowFor("Waltz night").queryByRole("button", { name: /^Pat Caller: / });
      if (button && !(button as HTMLButtonElement).disabled) await userEvent.click(button);
    }

    const sent = calls
      .filter((c) => c.method === "PATCH" && c.url.includes("/api/bookings/"))
      .map((c) => (c.body as { status: string }).status);
    expect(sent).toEqual(["requested", "tentative", "confirmed"]);
    expect(sent).not.toContain("declined");
    expect(rowFor("Waltz night").getByLabelText(/^Pat Caller: confirmed/)).toHaveTextContent("C");
  });

  it("advances a band by its LEAD, and lets the service carry the rest (T034, FR-012)", async () => {
    const bandProposed = row({
      ...DANCE,
      bookings: [
        line({ performer: "Pat Caller", type: "caller" }),
        line({
          performer: "Ann Fiddle",
          type: "lead_musician",
          bandId: "band1",
          status: "requested",
        }),
        line({ performer: "Bo Bass", type: "musician", bandId: "band1", status: "requested" }),
      ],
    });
    const calls = stubHub({ rows: [bandProposed] });
    render(<BookingCentralPage />);
    await loaded();

    await userEvent.click(rowFor("Waltz night").getByRole("button", { name: /^The Trio: / }));

    const patches = calls.filter((c) => c.method === "PATCH");
    // ONE write, to the lead — the cascade is the service's job, never a loop in the browser.
    expect(patches).toHaveLength(1);
    expect(patches[0]!.url).toContain("/api/bookings/b-Ann%20Fiddle");
    expect(patches[0]!.body).toEqual({ status: "tentative" });
  });

  it("offers no state control to someone who may not book (read-only viewer)", async () => {
    stubHub({ rows: [DANCE], bookingWrite: false });
    render(<BookingCentralPage />);
    await loaded();

    expect(rowFor("Waltz night").queryByRole("button", { name: /^Pat Caller: / })).toBeNull();
    expect(rowFor("Waltz night").getByLabelText(/^Pat Caller: proposed/)).toHaveTextContent("P");
  });
});

describe("Booking Central — filling a gap (087 US2, FR-013a)", () => {
  it("begins a caller booking for THAT dance when the empty caller mark is clicked (T027)", async () => {
    stubHub({ rows: [EMPTY] });
    render(<BookingCentralPage />);
    await loaded();

    await userEvent.click(rowFor("Open night").getByRole("button", { name: "No caller booked" }));

    // The booking editor heads a new booking with its role. That it is for THIS dance is the same routing
    // the band case below proves by what it POSTs — the editor does not print the date itself.
    const dialog = await screen.findByRole("dialog", { name: /^(booking —|book an? )/i });
    expect(
      within(dialog).getByRole("heading", { name: "Book a caller for 2026-09-24" }),
    ).toBeInTheDocument();
  });

  // 087 walk-through: one search for performers AND bands — no "band or musician" choice first.
  it("opens one search for a musician or a whole band when the empty music mark is clicked", async () => {
    stubHub({ rows: [EMPTY] });
    render(<BookingCentralPage />);
    await loaded();

    await userEvent.click(rowFor("Open night").getByRole("button", { name: "No music booked" }));

    const finder = await screen.findByRole("dialog", { name: "Book music for 2026-09-24" });
    expect(
      within(finder).getByRole("searchbox", { name: /find a performer or band/i }),
    ).toBeInTheDocument();
  });

  it("books a whole band in one act", async () => {
    const calls = stubHub({ rows: [EMPTY] });
    render(<BookingCentralPage />);
    await loaded();

    await userEvent.click(rowFor("Open night").getByRole("button", { name: "No music booked" }));
    // Booking a whole band lived only on the old per-event page; the hub must not lose it. It is found
    // by the one music search (087 walk-through) and booked by picking it.
    const finder = await screen.findByRole("dialog", { name: /book music for/i });
    await userEvent.type(within(finder).getByRole("searchbox"), "Trio");
    await userEvent.click(await within(finder).findByRole("button", { name: "The Trio" }));

    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "POST" &&
            c.url.endsWith("/api/events/e2/book-band") &&
            (c.body as { bandId: string }).bandId === "band1",
        ),
      ).toBe(true),
    );
  });

  it("offers no way to create a new dance — that is the events page (T036, FR-013b)", async () => {
    stubHub({ rows: [DANCE] });
    render(<BookingCentralPage />);
    await loaded();

    expect(
      screen.queryByRole("button", { name: /new (dance|event)|add (a )?(dance|event)/i }),
    ).toBeNull();
  });
});
