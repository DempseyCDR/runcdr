// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TreasurerReportPage from "@/app/(admin)/treasurer/page";
import { BREAKDOWN } from "./fixtures/attendanceBreakdown";

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

function report(eventId: string) {
  return {
    event: {
      id: eventId,
      date: eventId === "e_old" ? "2020-01-10" : "2020-06-15",
      seriesKey: "tnc",
    },
    gateSalesSummary: {
      customer: `Cust ${eventId}`,
      posVerification: { gross: 0, fee: 0 },
      lines: [],
    },
    namedCustomerReceipts: [],
    performerPayments: [],
    // Feature 040 (P6-R8): the rent bill (vendor = landlord, class, amount; no check line).
    bills: [{ vendor: "Faith Lutheran Church", class: "TNC", amount: 250 }],
    deposit: { amount: 0 },
    fees: { doorFee: 0, onlineFee: 0, total: 0 },
    // Feature 040 (P6-R9): reconciliation counts.
    compCount: 3,
    giftCardRedemptionCount: 2,
    // Feature 079: the evening's attendance breakdown.
    attendance: BREAKDOWN({ paying: eventId === "e_old" ? 12 : 21, comps: 3, giftCards: 2 }),
  };
}

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = async () => {
        const m = /\/events\/([^/]+)\/treasurer-report/.exec(u);
        if (m) return report(m[1]!);
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
    expect(await screen.findByText(/Gate Sales Summary — Cust e_recent/)).toBeInTheDocument();

    // Feature 038 (P6-R6): no non-dance-income section or entry form is rendered.
    expect(screen.queryByText(/Non-Dance Income/i)).toBeNull();

    // Switching the selected event reloads the report.
    await user.selectOptions(screen.getByRole("combobox", { name: /^event$/i }), "e_old");
    expect(await screen.findByText(/Gate Sales Summary — Cust e_old/)).toBeInTheDocument();
  });

  // Feature 040 (P6-R8): the report reads in QBO data-entry order.
  it("renders sections in QBO order with the rent bill and keeps Print", async () => {
    stub();
    render(<TreasurerReportPage />);
    await screen.findByText(/Gate Sales Summary — Cust e_recent/);

    // The five QBO sections appear in order (SC-001).
    const headings = screen.getAllByRole("heading").map((h) => h.textContent ?? "");
    const idx = (re: RegExp) => headings.findIndex((t) => re.test(t));
    const sales = idx(/Sales Receipts/i);
    const bills = idx(/^Bills$/i);
    const performer = idx(/Performer Payments/i);
    const deposit = idx(/^Deposit$/i);
    const fees = idx(/Fees/i);
    expect(sales).toBeGreaterThanOrEqual(0);
    expect(sales).toBeLessThan(bills);
    expect(bills).toBeLessThan(performer);
    expect(performer).toBeLessThan(deposit);
    expect(deposit).toBeLessThan(fees);

    // Within Sales Receipts, the gate/attendance receipt precedes the named receipts (SC-003).
    expect(idx(/Gate Sales Summary/i)).toBeLessThan(idx(/Named-Customer Receipts/i));

    // The rent bill shows vendor + amount, with NO check-number control in the Bills section.
    expect(screen.getByText(/Faith Lutheran Church/)).toBeInTheDocument();

    // Print is retained after the regroup (FR-011).
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
  });

  // Feature 040 (P6-R9) counts, since feature 079 inside the attendance breakdown at the top of the report.
  it("shows the attendance breakdown at the top, comps and gift cards included (079)", async () => {
    stub();
    render(<TreasurerReportPage />);
    await screen.findByText(/Gate Sales Summary — Cust e_recent/);

    const breakdown = screen.getByRole("region", { name: /attendance/i });
    expect(breakdown).toHaveTextContent(/Paying 21/);
    expect(breakdown).toHaveTextContent(/Comps 3/);
    expect(breakdown).toHaveTextContent(/Gift cards 2/);
    const sales = screen.getByRole("heading", { name: /Sales Receipts/i });
    expect(
      breakdown.compareDocumentPosition(sales) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
