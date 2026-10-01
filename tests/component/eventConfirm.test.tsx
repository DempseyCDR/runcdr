// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EventConfirm from "@/app/_components/EventConfirm";
import type { EventRow } from "@/app/EventSelector";

// Dates far in the past so the default ("most recent ≤ today") is deterministic.
const EVENTS: EventRow[] = [
  { id: "tnc", eventDate: "2020-06-18", seriesId: "s1", startTime: "19:30:00", label: null },
  { id: "ecd", eventDate: "2020-06-14", seriesId: "s2", startTime: "13:00:00", label: null },
  { id: "ecd-old", eventDate: "2020-06-07", seriesId: "s2", startTime: "13:00:00", label: null },
];
const SERIES = [
  { id: "s1", key: "tnc", name: "Thursday Night Contra" },
  { id: "s2", key: "ecd", name: "Sunday English Country Dance" },
];

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const items = String(url).includes("/api/series") ? SERIES : EVENTS;
      return { ok: true, status: 200, json: async () => ({ items }) };
    }),
  );
}

function Page() {
  const [event, setEvent] = useState<EventRow | null>(null);
  return <EventConfirm event={event} series={SERIES} onSelect={setEvent} />;
}

const heading = () => screen.getByRole("heading", { level: 1 });
const change = () => screen.getByRole("button", { name: "Change" });

/**
 * Feature 090 (FR-024): choosing a series under **Change** selects that series' most recent dance, and
 * keeps the selector open so an earlier evening of that series can still be picked; picking an evening
 * closes it, as before (feature 079).
 */
describe("EventConfirm — changing the series (090)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("selects the series' most recent dance and stays open until an evening is picked", async () => {
    stub();
    const user = userEvent.setup();
    render(<Page />);
    await waitFor(() => expect(heading()).toHaveTextContent("Thursday Night Contra"));

    await user.click(change());
    expect(change()).toHaveAttribute("aria-expanded", "true");

    await user.selectOptions(screen.getByLabelText("Filter series"), "s2");
    await waitFor(() => expect(heading()).toHaveTextContent("2020-06-14"));
    expect(change()).toHaveAttribute("aria-expanded", "true");

    await user.selectOptions(screen.getByRole("combobox", { name: "Event" }), "ecd-old");
    await waitFor(() => expect(heading()).toHaveTextContent("2020-06-07"));
    expect(change()).toHaveAttribute("aria-expanded", "false");
  });
});
