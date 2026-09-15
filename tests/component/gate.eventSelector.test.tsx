// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GatePage from "@/app/(door)/gate/page";
import { BREAKDOWN } from "./fixtures/attendanceBreakdown";

// Feature 028 (P5-R1) US4: the gate uses the shared EventSelector; selecting an event runs the gate's own
// side effect — opening/loading that event's door record. Two events (dates far past so "≤ today" is
// deterministic) let us distinguish the explicit pick from the on-open default.
type Call = { url: string; method: string };
const EVENTS = [
  {
    id: "e_recent",
    eventDate: "2020-06-15",
    seriesId: "s1",
    startTime: "19:30:00",
    label: "Contra",
  },
  { id: "e_old", eventDate: "2020-01-10", seriesId: "s1", startTime: null, label: null },
];
const SERIES = [{ id: "s1", key: "tnc", name: "TNC" }];

function stub(calls: Call[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? "GET" });
      const json = async () => {
        if (u.includes("/attendance-breakdown")) return BREAKDOWN(); // feature 079
        if (u.includes("/door-record"))
          return {
            doorRecord: {
              id: "dr1",
              seedFloat: 15,
              compCount: 0,
              giftCardRedemptionCount: 0,
              openBandCount: 0,
            },
            gateSales: [],
          };
        if (u.includes("/bookings")) return { bookings: [] };
        if (u.includes("/api/series")) return { items: SERIES };
        if (u.includes("/api/events")) return { items: EVENTS };
        return { items: [] };
      };
      return { ok: true, status: 200, json };
    }),
  );
}

const doorPost = (calls: Call[], id: string) =>
  calls.some((c) => c.url.includes(`/events/${id}/door-record`) && c.method === "POST");

describe("GatePage — shared event selector drives the door record (028 US4)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens the default event's door record on open, and the picked event's on select", async () => {
    const calls: Call[] = [];
    stub(calls);
    const user = userEvent.setup();
    render(<GatePage />);

    // On open the selector defaults to the most recent event ≤ today and opens its door record.
    await waitFor(() => expect(doorPost(calls, "e_recent")).toBe(true));

    // Explicitly picking the older event opens ITS door record (the gate's own side effect).
    await user.selectOptions(await screen.findByRole("combobox", { name: /^event$/i }), "e_old");
    await waitFor(() => expect(doorPost(calls, "e_old")).toBe(true));
  });
});
