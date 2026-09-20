// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TreasurerReportPage from "@/app/(admin)/treasurer/page";
import { REPORT } from "./fixtures/treasurerReport";

// Feature 028 (P5-R1) US4 + FR-010: the treasurer report is a single `/treasurer` page (no `[eventId]` URL).
// It renders the shared selector + the report for the default event, and reloads the report when the
// selected event changes. Dates far in the past so the "≤ today" default is deterministic.
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

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = async () => {
        const m = /\/events\/([^/]+)\/treasurer-report/.exec(u);
        if (m) return REPORT(m[1]!);
        if (u.includes("/api/series")) return { items: SERIES };
        if (u.includes("/api/events")) return { items: EVENTS };
        return { items: [] };
      };
      return { ok: true, status: 200, json };
    }),
  );
}

describe("TreasurerReportPage — /treasurer single page + selector (028)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the report for the default event and reloads when the event changes", async () => {
    stub();
    const user = userEvent.setup();
    render(<TreasurerReportPage />);

    // Defaults to the most recent event ≤ today and loads its report.
    expect(await screen.findByText(/Contra e_recent/)).toBeInTheDocument();

    // Feature 038 (P6-R6): no non-dance-income section or entry form is rendered.
    expect(screen.queryByText(/Non-Dance Income/i)).toBeNull();

    // Switching the selected event reloads the report.
    await user.selectOptions(screen.getByRole("combobox", { name: /^event$/i }), "e_old");
    expect(await screen.findByText(/Contra e_old/)).toBeInTheDocument();
  });

  // Feature 079 (FR-027): the attendance breakdown, comps and gift cards included, in the report's heading.
  it("shows the attendance breakdown at the top, comps and gift cards included (079)", async () => {
    stub();
    render(<TreasurerReportPage />);
    await screen.findByText(/Contra e_recent/);

    const breakdown = screen.getByRole("region", { name: /attendance/i });
    expect(breakdown).toHaveTextContent(/Paying 21/);
    expect(breakdown).toHaveTextContent(/Comps 3/);
    expect(breakdown).toHaveTextContent(/Gift cards 2/);
    const receipts = screen.getByRole("heading", { name: "Receipts" });
    expect(
      breakdown.compareDocumentPosition(receipts) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
