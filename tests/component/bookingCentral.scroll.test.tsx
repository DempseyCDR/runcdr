// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { row, setWidth, stubHub, stubScrolling, type Row } from "./fixtures/bookingCentral";

/**
 * Feature 091 US2 (contracts/page.md P2–P7, X1) — opening on the next dance, and scrolling both ways.
 *
 * Today is 1 October 2026 here. The page asks for the dances from today on and those before today, opens
 * with the first dance dated today or later at the bottom of the window, and loads more at either end.
 */

const TODAY = "2026-10-01";
const dance = (eventId: string, date: string, label: string): Row => row({ eventId, date, label });

const SEASON: Row[] = [
  dance("f2", "2026-10-15", "Far ahead"),
  dance("f1", "2026-10-08", "Next week"),
  dance("t0", TODAY, "Tonight"),
  dance("p1", "2026-09-24", "Last week"),
  dance("p2", "2026-09-17", "Before that"),
];

/** Many dances to come, so the first `newer` page of ten leaves more to load. */
const AHEAD: Row[] = Array.from({ length: 12 }, (_, i) =>
  dance(`a${i}`, `2026-1${i < 9 ? "0" : "1"}-${String(10 + i).padStart(2, "0")}`, `Ahead ${i}`),
);

const reportCalls = (calls: { url: string }[]) =>
  calls
    .filter((c) => c.url.includes("/api/bookings/report"))
    .map((c) => new URL(c.url, "http://x"));

/** The element each scrollIntoView was called on, and how. */
function spyScroll() {
  const spy = vi.spyOn(Element.prototype, "scrollIntoView");
  return () =>
    spy.mock.calls.map((args, i) => ({
      dance: (spy.mock.contexts[i] as Element).getAttribute("data-dance"),
      options: args[0],
    }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 1, 12, 0, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Booking Central — where it opens (091 US2)", () => {
  it("asks for the dances from today on and those before today (P3)", async () => {
    const calls = stubHub({ rows: SEASON });
    render(<BookingCentralPage />);
    await waitFor(() => expect(reportCalls(calls)).toHaveLength(2));

    const asked = reportCalls(calls).map((u) => [
      u.searchParams.get("direction"),
      u.searchParams.get("split"),
    ]);
    expect(asked).toEqual(
      expect.arrayContaining([
        ["newer", TODAY],
        ["older", TODAY],
      ]),
    );
    expect(reportCalls(calls).every((u) => !u.searchParams.has("horizon"))).toBe(true);
  });

  it.each(["narrow", "wide"] as const)(
    "puts the first dance dated today or later at the bottom of the window, %s (P3, FR-007)",
    async (width) => {
      setWidth(width);
      stubHub({ rows: SEASON });
      const scrolled = spyScroll();
      render(<BookingCentralPage />);
      await waitFor(() =>
        expect(scrolled()).toContainEqual({ dance: "t0", options: { block: "end" } }),
      );
    },
  );

  it("shows the dances newest first: those to come above the default, the past below (P3)", async () => {
    setWidth("narrow");
    stubHub({ rows: SEASON });
    render(<BookingCentralPage />);
    const list = await screen.findByRole("list", { name: "Dances" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(5));
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.getAttribute("data-dance")),
    ).toEqual(["f2", "f1", "t0", "p1", "p2"]);
  });

  it("opens on the most recent dance when none is to come (FR-007)", async () => {
    stubHub({ rows: SEASON.slice(3) });
    const scrolled = spyScroll();
    render(<BookingCentralPage />);
    await waitFor(() =>
      expect(scrolled()).toContainEqual({ dance: "p1", options: { block: "end" } }),
    );
  });

  it("has no Showing dances from control (P2, FR-010)", async () => {
    stubHub({ rows: SEASON });
    render(<BookingCentralPage />);
    await screen.findByText("Tonight");
    expect(screen.queryByLabelText(/showing dances from/i)).toBeNull();
  });
});

/**
 * Rich, 2026-10-01: no buttons at the ends — scrolling (or the arrow keys) to the top or the foot loads
 * more that way, and the end says so when there is no more.
 */
describe("Booking Central — both ends (091 US2)", () => {
  it("loads later dances when the Booker scrolls to the top, and says when there are no more (P4)", async () => {
    const reach = stubScrolling();
    const calls = stubHub({ rows: [...AHEAD, ...SEASON] });
    render(<BookingCentralPage />);
    await screen.findByText("Tonight");
    expect(screen.queryByRole("button", { name: /later dances/i })).toBeNull();

    await waitFor(() => reach("later"));
    await waitFor(() =>
      expect(
        reportCalls(calls).some(
          (u) => u.searchParams.get("direction") === "newer" && u.searchParams.has("cursor"),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("No later dances")).toBeInTheDocument();
  });

  it("loads earlier dances when the Booker scrolls to the foot, and says when there are no more (P5)", async () => {
    const reach = stubScrolling();
    const past = Array.from({ length: 45 }, (_, i) =>
      dance(
        `old${i}`,
        `2025-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + Math.floor(i / 12)).padStart(2, "0")}`,
        `Old ${i}`,
      ),
    );
    const calls = stubHub({ rows: [...SEASON, ...past] });
    render(<BookingCentralPage />);
    await screen.findByText("Tonight");
    expect(screen.queryByRole("button", { name: /earlier dances/i })).toBeNull();
    await waitFor(() => reach("earlier"));
    await waitFor(() =>
      expect(
        reportCalls(calls).some(
          (u) => u.searchParams.get("direction") === "older" && u.searchParams.has("cursor"),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("No earlier dances")).toBeInTheDocument();
  });

  it("says once that there are no dances, and offers no loading (P6)", async () => {
    stubHub({ rows: [] });
    render(<BookingCentralPage />);
    expect(await screen.findByText("No dances.")).toBeInTheDocument();
    expect(screen.queryByText(/no (later|earlier) dances/i)).toBeNull();
  });

  it("re-reads both sides after a save, as many as it holds (P7)", async () => {
    const calls = stubHub({ rows: SEASON });
    render(<BookingCentralPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Tonight" }));
    const dialog = await screen.findByRole("dialog", { name: /event/i });
    const before = reportCalls(calls).length;
    await userEvent.click(within(dialog).getByRole("button", { name: /save/i }));

    await waitFor(() => expect(reportCalls(calls).length).toBe(before + 2));
    const reread = reportCalls(calls).slice(before);
    const limitOf = (d: string) =>
      Number(reread.find((u) => u.searchParams.get("direction") === d)?.searchParams.get("limit"));
    expect(limitOf("newer")).toBe(3); // tonight and the two to come
    expect(limitOf("older")).toBe(2);
    expect(reread.every((u) => !u.searchParams.has("cursor"))).toBe(true);
  });
});

describe("Booking Central — crossing 48rem (091 X1)", () => {
  it("swaps cards for the table and keeps the dance that was last in view in view", async () => {
    const flip = setWidth("narrow");
    stubHub({ rows: SEASON });
    // Lay the dances out 400px apart in a 768px window, as if the Booker had scrolled up: f2 and f1 are
    // in view, f1 the last of them — not t0, the dance the page opened on.
    const order = SEASON.map((r) => r.eventId);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const i = order.indexOf(this.getAttribute("data-dance") ?? "");
      const top = i < 0 ? 0 : i * 400;
      return {
        top,
        bottom: top + 380,
        left: 0,
        right: 0,
        width: 0,
        height: 380,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });
    vi.stubGlobal("innerHeight", 768);
    render(<BookingCentralPage />);
    await screen.findByRole("list", { name: "Dances" });
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(5));
    fireEvent.scroll(window);

    const scrolled = spyScroll();
    act(() => flip("wide"));
    await screen.findByRole("list", { name: "Dances" });
    await waitFor(() =>
      expect(scrolled()).toContainEqual({ dance: "f1", options: { block: "end" } }),
    );
  });
});
