// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { localToday } from "@/app/localToday";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventSelector, type EventRow, type SelectedBy } from "@/app/EventSelector";

// Feature 028 (P5-R1): one shared selector — default most-recent-≤-today (US1), series + date-range filters
// (US2), and a selection confirmed by picking (not by adjusting a filter) (US3). Dates far past/future so
// "≤ today" is deterministic regardless of the test clock.
const EVENTS: EventRow[] = [
  { id: "fut", eventDate: "2099-01-01", seriesId: "s1", startTime: "20:00:00", label: "Future" },
  { id: "recent", eventDate: "2020-06-15", seriesId: "s1", startTime: "19:30:00", label: "Contra" },
  { id: "ecd", eventDate: "2020-06-10", seriesId: "s2", startTime: "13:00:00", label: "English" },
  { id: "old", eventDate: "2020-01-10", seriesId: "s1", startTime: null, label: null },
];
const SERIES = [
  { id: "s1", key: "tnc", name: "TNC" },
  { id: "s2", key: "ecd", name: "ECD" },
];

function stub(events = EVENTS, series = SERIES) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = async () => (u.includes("/api/series") ? { items: series } : { items: events });
      return { ok: true, status: 200, json };
    }),
  );
}

/** Harness: holds the controlled value + records every onSelect call. */
function Harness({ onPick }: { onPick?: (e: EventRow, by: SelectedBy) => void }) {
  const [value, setValue] = useState("");
  return (
    <EventSelector
      value={value}
      onSelect={(e, by) => {
        setValue(e.id);
        onPick?.(e, by);
      }}
    />
  );
}

const eventSelect = () => screen.getByLabelText("Event") as HTMLSelectElement;
const optionValues = () => Array.from(eventSelect().options).map((o) => o.value);

describe("EventSelector", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("US1: defaults to the most recent event ≤ today and labels options date · HH:MM · label", async () => {
    const picks: EventRow[] = [];
    stub();
    render(<Harness onPick={(e) => picks.push(e)} />);

    await waitFor(() => expect(eventSelect().value).toBe("recent")); // 2020-06-15, not the 2099 future event
    expect(picks[0]?.id).toBe("recent"); // onSelect fired once with the default

    const opt = Array.from(eventSelect().options).find((o) => o.value === "recent")!;
    expect(opt.textContent).toMatch(/2020-06-15/);
    expect(opt.textContent).toMatch(/19:30/);
    expect(opt.textContent).not.toMatch(/19:30:00/); // normalized HH:MM
    expect(opt.textContent).toMatch(/Contra/);
  });

  it("US1: shows an empty state and selects nothing when there are no events", async () => {
    const picks: EventRow[] = [];
    stub([]);
    render(<Harness onPick={(e) => picks.push(e)} />);

    await screen.findByText(/no events/i);
    expect(picks).toHaveLength(0);
    expect(eventSelect().value).toBe("");
  });

  it("US2: filters the list by series and by date range", async () => {
    stub();
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(optionValues()).toContain("recent"));

    // Series filter → only s2 events.
    await user.selectOptions(screen.getByLabelText(/filter series/i), "s2");
    await waitFor(() => expect(optionValues().filter(Boolean)).toEqual(["ecd"]));

    // Clear series, apply a date range that excludes the 2099 future event.
    await user.selectOptions(screen.getByLabelText(/filter series/i), "");
    await user.type(screen.getByLabelText(/from date/i), "2020-01-01");
    await user.type(screen.getByLabelText(/to date/i), "2020-12-31");
    await waitFor(() => expect(optionValues()).not.toContain("fut"));
    expect(optionValues().filter(Boolean).sort()).toEqual(["ecd", "old", "recent"]);
  });

  // Feature 090 (FR-024) narrowed this: a SERIES change now selects that series' default (below); the
  // date range still only narrows the list.
  it("US3: adjusting the date range does not re-select; picking an event calls onSelect", async () => {
    const picks: EventRow[] = [];
    stub();
    const user = userEvent.setup();
    render(<Harness onPick={(e) => picks.push(e)} />);
    await waitFor(() => expect(picks).toHaveLength(1)); // the default

    // Changing the date range must NOT commit a new selection.
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2020-01-01" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2020-03-01" } });
    await waitFor(() => expect(optionValues()).toEqual(["", "old"]));
    expect(picks).toHaveLength(1);

    // Picking an event commits it.
    await user.selectOptions(eventSelect(), "old");
    await waitFor(() => expect(picks).toHaveLength(2));
    expect(picks[1]?.id).toBe("old");
  });

  /**
   * Feature 079 (research R9): "today" is the device's local date. At 9:30 pm on the East Coast the UTC date
   * is already tomorrow, so the old UTC default would have picked tomorrow's event — and the door's new "not
   * today" warning would have fired on the evening's own dance.
   */
  describe("today is the device's local date (079)", () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      vi.useRealTimers();
      process.env.TZ = originalTz;
    });

    it("defaults to tonight's event after the UTC date has rolled over", async () => {
      process.env.TZ = "America/New_York";
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-18T01:30:00Z")); // 21:30 on 17 September, Eastern
      expect(localToday()).toBe("2026-09-17");

      const picks: EventRow[] = [];
      stub([
        {
          id: "tomorrow",
          eventDate: "2026-09-18",
          seriesId: "s1",
          startTime: "19:30:00",
          label: null,
        },
        {
          id: "tonight",
          eventDate: "2026-09-17",
          seriesId: "s1",
          startTime: "19:30:00",
          label: null,
        },
      ]);
      render(<Harness onPick={(e) => picks.push(e)} />);
      await waitFor(() => expect(picks[0]?.id).toBe("tonight"));
    });
  });
});

/**
 * Feature 086 US3 (FR-010, FR-010a, FR-011, FR-012): the list starts where the volunteer works.
 *
 * A DEFAULT, never a gate. The filter is changeable in one step and every evening stays openable — the
 * routes decide that, not this component. Pages opt in; check-in deliberately does not.
 */
function stubWithSeries(mySeriesIds: string[] | "fail", events = EVENTS) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/me/capabilities")) {
        if (mySeriesIds === "fail") return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ mySeriesIds }) };
      }
      const json = async () => (u.includes("/api/series") ? { items: SERIES } : { items: events });
      return { ok: true, status: 200, json };
    }),
  );
}

function MineHarness({ onPick }: { onPick?: (e: EventRow) => void }) {
  const [value, setValue] = useState("");
  return (
    <EventSelector
      value={value}
      defaultToMySeries
      onSelect={(e) => {
        setValue(e.id);
        onPick?.(e);
      }}
    />
  );
}

const seriesFilter = () => screen.getByLabelText("Filter series") as HTMLSelectElement;

describe("EventSelector — the viewer's own series (086)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts narrowed when the viewer's roles name exactly one series (FR-010)", async () => {
    stubWithSeries(["s2"]);
    render(<MineHarness />);

    await waitFor(() => expect(seriesFilter().value).toBe("s2"));
    // Only the ECD evening is offered; the TNC ones are filtered out.
    await waitFor(() => expect(optionValues()).toEqual(["", "ecd"]));
  });

  it("chooses its default evening FROM the narrowed list, not the whole one (FR-010a)", async () => {
    const picks: EventRow[] = [];
    stubWithSeries(["s2"]);
    render(<MineHarness onPick={(e) => picks.push(e)} />);

    // Without the ordering fix the component latches onto "recent" (s1, and the most recent ≤ today)
    // before the viewer's series arrive, and never re-defaults — the filter would read s2 while the
    // chosen evening belonged to s1. Assert the SERIES of what was picked, not merely that a filter set.
    await waitFor(() => expect(picks.length).toBeGreaterThan(0));
    expect(picks[0]!.seriesId).toBe("s2");
    expect(picks[0]!.id).toBe("ecd");
  });

  it("starts unnarrowed when two series are named (FR-010)", async () => {
    stubWithSeries(["s1", "s2"]);
    render(<MineHarness />);

    await waitFor(() => expect(optionValues().length).toBeGreaterThan(1));
    // The filter holds one series or none; narrowing to one of her two would hide the other.
    expect(seriesFilter().value).toBe("");
  });

  it("starts unnarrowed for a club-wide holder (FR-012)", async () => {
    stubWithSeries([]);
    render(<MineHarness />);

    await waitFor(() => expect(optionValues().length).toBeGreaterThan(1));
    expect(seriesFilter().value).toBe("");
  });

  it("still defaults when the viewer's series cannot be fetched (U1)", async () => {
    const picks: EventRow[] = [];
    stubWithSeries("fail");
    render(<MineHarness onPick={(e) => picks.push(e)} />);

    // The default must degrade to today's behaviour, never to NO behaviour: a failed third request
    // must not leave the selector with nothing chosen.
    await waitFor(() => expect(picks.length).toBeGreaterThan(0));
    expect(seriesFilter().value).toBe("");
    expect(picks[0]!.id).toBe("recent");
  });

  it("widens in one step — the narrowing is a default, not a gate (FR-011)", async () => {
    stubWithSeries(["s2"]);
    render(<MineHarness />);
    await waitFor(() => expect(seriesFilter().value).toBe("s2"));

    await userEvent.selectOptions(seriesFilter(), "s1");

    await waitFor(() => expect(optionValues()).toEqual(["", "fut", "recent", "old"]));
  });

  it("leaves a page that does not opt in exactly as it was (FR-013)", async () => {
    stubWithSeries(["s2"]);
    render(<Harness />); // no defaultToMySeries — this is check-in's case

    await waitFor(() => expect(optionValues().length).toBeGreaterThan(2));
    expect(seriesFilter().value).toBe("");
  });
});

/**
 * Feature 090 (FR-024, Rich 2026-09-30): on every page that uses the selector, choosing a series moves the
 * evening to that series' most recent dance — the same rule as the first default — so the page never
 * shows an evening from a series other than the one the filter names. The date range still only narrows
 * (028 US3, above). Each selection says why it was made, so a page can tell a pick from a default.
 */
describe("EventSelector — a new series selects its most recent dance (090)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("selects the chosen series' most recent dance up to today", async () => {
    const picks: EventRow[] = [];
    stub();
    const user = userEvent.setup();
    render(<Harness onPick={(e) => picks.push(e)} />);
    await waitFor(() => expect(picks).toHaveLength(1)); // the first default: "recent" (s1)

    await user.selectOptions(seriesFilter(), "s2");
    await waitFor(() => expect(picks).toHaveLength(2));
    expect(picks[1]?.id).toBe("ecd");
    expect(eventSelect().value).toBe("ecd");

    // Back to s1: its most recent dance up to today, not the 2099 one.
    await user.selectOptions(seriesFilter(), "s1");
    await waitFor(() => expect(picks).toHaveLength(3));
    expect(picks[2]?.id).toBe("recent");
  });

  it("selects the soonest upcoming dance when the series has none yet", async () => {
    const picks: EventRow[] = [];
    // A series whose dances are all still to come (the list arrives newest-first).
    stub(
      [
        { id: "later", eventDate: "2099-05-01", seriesId: "s3", startTime: null, label: null },
        { id: "next", eventDate: "2098-05-01", seriesId: "s3", startTime: null, label: null },
        ...EVENTS,
      ],
      [...SERIES, { id: "s3", key: "cdob", name: "CDOB" }],
    );
    const user = userEvent.setup();
    render(<Harness onPick={(e) => picks.push(e)} />);
    await waitFor(() => expect(picks).toHaveLength(1));

    await user.selectOptions(seriesFilter(), "s3");
    await waitFor(() => expect(picks).toHaveLength(2));
    expect(picks[1]?.id).toBe("next");
  });

  it("says why each evening was selected: the first default, a series, or a pick", async () => {
    const why: SelectedBy[] = [];
    stub();
    const user = userEvent.setup();
    render(<Harness onPick={(_, by) => why.push(by)} />);
    await waitFor(() => expect(why).toEqual(["default"]));

    await user.selectOptions(seriesFilter(), "s2");
    await waitFor(() => expect(why).toEqual(["default", "series"]));

    await user.selectOptions(seriesFilter(), "");
    await waitFor(() => expect(why).toEqual(["default", "series", "series"]));
    await user.selectOptions(eventSelect(), "old");
    await waitFor(() => expect(why).toEqual(["default", "series", "series", "picked"]));
  });
});
