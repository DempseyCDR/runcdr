// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { line, row, setWidth, stubHub, type Row } from "./fixtures/bookingCentral";

/**
 * Feature 091 US1 (contracts/page.md C1–C3, T1) — the dances as cards on a phone.
 *
 * Below 48rem each dance is one card: date, series, label, caller and band, each name with its state
 * letter as TEXT, and the gap marks. A tap anywhere opens the dance; nothing on the card changes a
 * booking (FR-002a).
 */

const WALTZ: Row = row({
  eventId: "e1",
  date: "2026-10-08",
  label: "Waltz night",
  caller: "Pat Caller",
  band: "The Trio",
  bandId: "band1",
  bookings: [
    line({ performer: "Pat Caller", type: "caller", status: "proposed" }),
    line({ performer: "Ann Fiddle", type: "lead_musician", bandId: "band1", status: "tentative" }),
  ],
});
const BARE: Row = row({ eventId: "e2", date: "2026-09-24", label: null });
const CANCELLED: Row = row({
  eventId: "e3",
  date: "2026-09-17",
  label: "Rained out",
  cancelled: true,
});

const list = () => screen.getByRole("list", { name: "Dances" });
const cards = () => within(list()).getAllByRole("listitem");
const cardFor = (text: string) => cards().find((c) => c.textContent?.includes(text)) as HTMLElement;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Booking Central — cards on a phone (091 US1)", () => {
  it("shows one card per dance, newest first, and no table (C1)", async () => {
    setWidth("narrow");
    stubHub({ rows: [WALTZ, BARE, CANCELLED] });
    render(<BookingCentralPage />);
    await waitFor(() => expect(cards()).toHaveLength(3));

    expect(cards().map((c) => c.textContent)).toEqual([
      expect.stringContaining("2026-10-08"),
      expect.stringContaining("2026-09-24"),
      expect.stringContaining("2026-09-17"),
    ]);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("gives the date, series, label, caller and band, each name with its letter as text (C2)", async () => {
    setWidth("narrow");
    stubHub({ rows: [WALTZ] });
    render(<BookingCentralPage />);
    await waitFor(() => expect(cards()).toHaveLength(1));

    const card = cardFor("Waltz night");
    for (const text of [
      "2026-10-08",
      "Thursday Night Contra",
      "Waltz night",
      "P. Caller",
      "The Trio",
    ]) {
      expect(card).toHaveTextContent(text);
    }
    // The letters are shown, not pressed.
    expect(within(card).getByLabelText("Pat Caller: proposed").tagName).not.toBe("BUTTON");
    expect(within(card).getByLabelText("The Trio: tentative").tagName).not.toBe("BUTTON");
  });

  it("marks what the dance still wants, names it by its series when it has no label, and says Cancelled (C2)", async () => {
    setWidth("narrow");
    stubHub({ rows: [WALTZ, BARE, CANCELLED] });
    render(<BookingCentralPage />);
    await waitFor(() => expect(cards()).toHaveLength(3));

    const bare = cards()[1]!;
    expect(within(bare).getByRole("img", { name: "No caller booked" })).toBeInTheDocument();
    expect(within(bare).getByRole("img", { name: "No music booked" })).toBeInTheDocument();
    expect(within(bare).getByRole("img", { name: "No sound tech booked" })).toBeInTheDocument();
    expect(bare).toHaveTextContent("Thursday Night Contra");
    expect(
      within(cardFor("Waltz night")).getByRole("img", { name: "No sound tech booked" }),
    ).toBeInTheDocument();
    expect(cardFor("Rained out")).toHaveTextContent("Cancelled");
  });

  it("has exactly one control: a button naming the dance (C3)", async () => {
    setWidth("narrow");
    stubHub({ rows: [WALTZ, BARE] });
    render(<BookingCentralPage />);
    await waitFor(() => expect(cards()).toHaveLength(2));

    const buttons = within(cardFor("Waltz night")).getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName("2026-10-08 · Thursday Night Contra · Waltz night");
    // With no label, the series names it once.
    expect(within(cards()[1]!).getByRole("button")).toHaveAccessibleName(
      "2026-09-24 · Thursday Night Contra",
    );
  });

  // Rich, 2026-10-01: Sean must tell Catherine Sloboda from her brother Matt — the row's last names alone
  // cannot. On a card every performer is named by first initial and last name; the letter still says
  // the full name to a screen reader.
  it("names each performer by first initial and last name (FR-002b)", async () => {
    setWidth("narrow");
    stubHub({
      rows: [
        row({
          eventId: "e9",
          date: "2026-10-15",
          label: "Family night",
          bookings: [
            line({ performer: "Ina Rose Caller", type: "caller", status: "confirmed" }),
            line({ performer: "Catherine Sloboda", type: "musician", status: "confirmed" }),
            line({ performer: "Matt Sloboda", type: "musician", status: "requested" }),
            line({ performer: "Fortier", type: "sound_tech", status: "confirmed" }),
          ],
        }),
      ],
    });
    render(<BookingCentralPage />);
    await waitFor(() => expect(cards()).toHaveLength(1));

    const card = cards()[0]!;
    for (const name of ["I. Caller", "C. Sloboda", "M. Sloboda", "Fortier"]) {
      expect(card).toHaveTextContent(name);
    }
    expect(card).not.toHaveTextContent("Catherine");
    expect(within(card).getByLabelText("Matt Sloboda: requested")).toBeInTheDocument();
  });

  // Rich, 2026-10-01: a card is narrow — "<band> featuring <musician>" becomes "<band> feat. <musician>".
  // The table keeps the word (087 walk-through).
  it("joins a band and a musician booked beside it with feat. (FR-002b)", async () => {
    setWidth("narrow");
    stubHub({
      rows: [
        row({
          eventId: "e8",
          date: "2026-10-22",
          label: "Band night",
          band: "The Trio",
          bandId: "band1",
          bookings: [
            line({ performer: "Ann Fiddle", type: "lead_musician", bandId: "band1" }),
            line({ performer: "Catherine Sloboda", type: "musician" }),
          ],
        }),
      ],
    });
    render(<BookingCentralPage />);
    await waitFor(() => expect(cards()).toHaveLength(1));

    const card = cards()[0]!;
    expect(card).toHaveTextContent(/The Trio\s*C?\s*feat\.\s*C\. Sloboda/);
    expect(card).not.toHaveTextContent("featuring");
  });

  it("changes no booking when a letter on a card is tapped (FR-002a)", async () => {
    setWidth("narrow");
    const calls = stubHub({ rows: [WALTZ] });
    render(<BookingCentralPage />);
    await waitFor(() => expect(cards()).toHaveLength(1));

    await userEvent.click(within(cardFor("Waltz night")).getByLabelText("Pat Caller: proposed"));
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  /**
   * Rich, 2026-10-01: the card is the basis at every width — the table is retired. From 48rem the card is
   * live, as the table was, and shows what the table did: the time, the venue and the notes.
   */
  it("is live at 48rem and wider, with the time, venue and notes (T1)", async () => {
    setWidth("wide");
    const calls = stubHub({ rows: [{ ...WALTZ, note: "Bring the long tables" }, BARE] });
    render(<BookingCentralPage />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(screen.queryByRole("table")).toBeNull();

    const card = cardFor("Waltz night");
    expect(card).toHaveTextContent("2026-10-08 · 19:30 · Thursday Night Contra");
    expect(card).toHaveTextContent("Bring the long tables");
    expect(within(card).getByRole("button", { name: "German House" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Waltz night" })).toBeInTheDocument();
    // Its letters advance in place — no card-wide button to open a dance.
    await userEvent.click(within(card).getByRole("button", { name: "Pat Caller: proposed" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(within(card).queryByRole("button", { name: /^2026-10-08 · / })).toBeNull();
  });

  // Rich, 2026-10-01: the + never wraps alone — it stays with the last name before it, so it never
  // looks as if it belonged to the next column.
  it("keeps each + with the last name before it (T1)", async () => {
    setWidth("wide");
    stubHub({
      rows: [
        row({
          eventId: "e7",
          date: "2026-10-22",
          label: "Loose night",
          bookings: [
            line({ performer: "Pat Caller", type: "caller" }),
            line({ performer: "Catherine Sloboda", type: "musician" }),
            line({ performer: "Matt Sloboda", type: "musician" }),
          ],
        }),
      ],
    });
    render(<BookingCentralPage />);
    await waitFor(() => expect(cards()).toHaveLength(1));

    const card = cards()[0]!;
    const addMusic = within(card).getByRole("button", { name: "Add music" });
    const kept = addMusic.closest("[data-keep]");
    expect(kept).not.toBeNull();
    expect(kept).toHaveTextContent("M. Sloboda");
    expect(kept).not.toHaveTextContent("C. Sloboda");
    const addCaller = within(card).getByRole("button", { name: "Add a caller or instructor" });
    expect(addCaller.closest("[data-keep]")).toHaveTextContent("P. Caller");
  });

  // Rich, 2026-10-01: a phone on its side is wide but short — the header is one line, the search and the
  // prompt behind the Performers button at the end of the title's line.
  it("puts Performers on the title's line in a window under 450px tall (FR-018)", async () => {
    setWidth("wide", true);
    stubHub({ rows: [WALTZ] });
    render(<BookingCentralPage />);
    const heading = await screen.findByRole("heading", { level: 1 });
    const header = heading.closest("header")!;
    expect(within(header).getByRole("button", { name: "Performers" })).toBeInTheDocument();
    expect(within(header).queryByRole("searchbox")).toBeNull();
    await waitFor(() => expect(cards()).toHaveLength(1));
    // The cards are still the wide, live ones.
    expect(
      within(cardFor("Waltz night")).getByRole("button", { name: "German House" }),
    ).toBeInTheDocument();
  });
});
