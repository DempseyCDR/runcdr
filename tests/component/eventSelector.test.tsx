// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { localToday } from "@/app/localToday";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventSelector, type EventRow } from "@/app/EventSelector";

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

function stub(events = EVENTS) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = async () => (u.includes("/api/series") ? { items: SERIES } : { items: events });
      return { ok: true, status: 200, json };
    }),
  );
}

/** Harness: holds the controlled value + records every onSelect call. */
function Harness({ onPick }: { onPick?: (e: EventRow) => void }) {
  const [value, setValue] = useState("");
  return (
    <EventSelector
      value={value}
      onSelect={(e) => {
        setValue(e.id);
        onPick?.(e);
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

  it("US3: adjusting a filter does not re-select; only picking an event calls onSelect", async () => {
    const picks: EventRow[] = [];
    stub();
    const user = userEvent.setup();
    render(<Harness onPick={(e) => picks.push(e)} />);
    await waitFor(() => expect(picks).toHaveLength(1)); // the default

    // Changing a filter must NOT commit a new selection.
    await user.selectOptions(screen.getByLabelText(/filter series/i), "s1");
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
