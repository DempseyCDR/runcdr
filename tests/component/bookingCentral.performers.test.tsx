// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { row, setWidth, stubHub } from "./fixtures/bookingCentral";

/**
 * Feature 091 US3 (contracts/page.md P1, C4, C5, T2) — one title, and the performers in reach.
 *
 * At every width the title is one line, "Booking Central — {series}". On a phone only the title and a
 * Performers button sit above the cards; the button holds the search and the performers who need a
 * contact. On a computer both stay in view above the table, where the count prompts action.
 */

const ROWS = [row({ eventId: "e1", date: "2026-10-08", label: "Waltz night" })];
const NEEDING = {
  count: 2,
  items: [
    { id: "p1", displayName: "Glenrose Smith", reason: "none" },
    { id: "p2", displayName: "Catherine Sloboda", reason: "archived" },
  ],
};

const title = (name: string) => screen.findByRole("heading", { level: 1, name });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Booking Central — the title (091 US3, P1)", () => {
  it.each(["narrow", "wide"] as const)(
    "is one line naming the viewer's series, with no second series heading, %s",
    async (width) => {
      setWidth(width);
      stubHub({ rows: ROWS });
      render(<BookingCentralPage />);
      expect(await title("Booking Central — Thursday Night Contra")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Thursday Night Contra" })).toBeNull();
    },
  );

  // Rich, 2026-10-01: the page opens scrolled down, so the title and the controls beside it are pinned
  // under the volunteer bar, together — one header (the pinning itself is the stylesheet's).
  it.each([
    ["narrow", "Performers"],
    ["wide", "2 performers need a contact"],
  ] as const)(
    "keeps the title and its controls in one header, %s (FR-017)",
    async (width, control) => {
      setWidth(width);
      stubHub({ rows: ROWS, needingContact: NEEDING });
      render(<BookingCentralPage />);
      const heading = await title("Booking Central — Thursday Night Contra");
      const header = heading.closest("header");
      expect(header).not.toBeNull();
      expect(within(header!).getByRole("button", { name: control })).toBeInTheDocument();
      if (width === "wide") expect(within(header!).getByRole("searchbox")).toBeInTheDocument();
    },
  );

  // Rich, 2026-10-02: Sean books contra and the community dance — he sees those two, not ECD.
  it("shows exactly the series the viewer's roles name, when they name several", async () => {
    const calls = stubHub({ rows: ROWS, mySeriesIds: ["s1", "s3"] });
    render(<BookingCentralPage />);
    expect(
      await title("Booking Central — Thursday Night Contra & Community Dance"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/api/bookings/report"))).toBe(true),
    );
    const asked = calls
      .filter((c) => c.url.includes("/api/bookings/report"))
      .map((c) => new URL(c.url, "http://x").searchParams.get("series"));
    expect(asked.every((s) => s === "tnc,cdob")).toBe(true);
  });

  it("says All series when the viewer's roles name no series (a club-wide grant)", async () => {
    stubHub({ rows: ROWS, mySeriesIds: [] });
    render(<BookingCentralPage />);
    expect(await title("Booking Central — All series")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "All series" })).toBeNull();
  });
});

describe("Booking Central — the Performers button on a phone (091 US3, C4, C5)", () => {
  it("puts only the title and Performers above the cards (C4)", async () => {
    setWidth("narrow");
    stubHub({ rows: ROWS, needingContact: NEEDING });
    render(<BookingCentralPage />);
    const list = await screen.findByRole("list", { name: "Dances" });
    await within(list).findByRole("listitem");

    const before = Array.from(
      document.querySelectorAll<HTMLElement>("main input, main button, main select, main a"),
    ).filter((el) => el.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before.map((el) => el.textContent?.trim())).toEqual(["Performers"]);
  });

  it("opens the search and the performers who need a contact (C5)", async () => {
    setWidth("narrow");
    stubHub({ rows: ROWS, needingContact: NEEDING });
    render(<BookingCentralPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Performers" }));

    const dialog = await screen.findByRole("dialog", { name: "Performers" });
    expect(within(dialog).getByRole("searchbox")).toBeInTheDocument();
    const needing = within(dialog).getByRole("list", { name: "Performers who need a contact" });
    expect(within(needing).getByRole("button", { name: "Glenrose Smith" })).toBeInTheDocument();
    expect(needing).toHaveTextContent("contact archived");
  });

  it("opens a performer on top of it (C5)", async () => {
    setWidth("narrow");
    stubHub({ rows: ROWS, needingContact: NEEDING });
    render(<BookingCentralPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Performers" }));
    const dialog = await screen.findByRole("dialog", { name: "Performers" });

    await userEvent.click(within(dialog).getByRole("button", { name: "Glenrose Smith" }));
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(2));
    expect(screen.getByRole("dialog", { name: "Performers" })).toBeInTheDocument();
  });
});

describe("Booking Central — above the table on a computer (091 US3, T2)", () => {
  it("keeps the search and the count in view, and no Performers button", async () => {
    setWidth("wide");
    stubHub({ rows: ROWS, needingContact: NEEDING });
    render(<BookingCentralPage />);
    expect(
      await screen.findByRole("button", { name: "2 performers need a contact" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Performers" })).toBeNull();
  });
});
