// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import CheckinPage from "@/app/(door)/checkin/page";

// Feature 025 US2 (FR-011/012/013): the selector defaults to the most recent event on or before today, lists
// newest-first, and labels each option with date + start time + label. Dates chosen far in the past/future so
// "≤ today" is deterministic regardless of the test clock.
const EVENTS = [
  { id: "fut", eventDate: "2099-01-01", seriesId: "s1", startTime: "20:00:00", label: "Future" },
  { id: "recent", eventDate: "2020-01-15", seriesId: "s1", startTime: "19:30:00", label: "Contra" },
  {
    id: "older",
    eventDate: "2020-01-10",
    seriesId: "s1",
    startTime: "13:00:00",
    label: "Afternoon",
  },
];

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = async () => {
        if (u.includes("/api/events")) return { items: EVENTS };
        if (u.includes("/api/series")) return { items: [{ id: "s1", key: "tnc", name: "TNC" }] };
        if (u.includes("/attendance")) return { attendees: [] };
        return { items: [] };
      };
      return { ok: true, status: 200, json };
    }),
  );
}

describe("CheckinPage — event selector", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to the most recent event ≤ today and labels options with date + time + label", async () => {
    stub();
    render(<CheckinPage />);

    // Feature 079: the page now also has an "Event" region confirming the choice, so ask for the select itself.
    const select = (await screen.findByRole("combobox", { name: "Event" })) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("recent")); // 2020-01-15, not the 2099 future event

    // The recent option shows date + HH:MM start time + label.
    const opt = Array.from(select.options).find((o) => o.value === "recent")!;
    expect(opt.textContent).toMatch(/2020-01-15/);
    expect(opt.textContent).toMatch(/19:30/);
    expect(opt.textContent).not.toMatch(/19:30:00/); // normalized to HH:MM
    expect(opt.textContent).toMatch(/Contra/);
  });
});
