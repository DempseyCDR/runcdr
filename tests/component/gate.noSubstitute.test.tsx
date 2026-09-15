// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GatePage from "@/app/(door)/gate/page";
import { BREAKDOWN } from "./fixtures/attendanceBreakdown";

// Feature 043 (P6-R12): performer substitution moved off the gate page to /payments. The gate must no longer
// render a "Substitute a performer" control.
type Call = { url: string; init?: RequestInit };

function stub(calls: Call[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      const json = async () => {
        if (u.includes("/attendance-breakdown")) return BREAKDOWN(); // feature 079
        if (u.endsWith("/door-record"))
          return {
            doorRecord: {
              id: "dr1",
              seedFloat: 15,
              compCount: 0,
              giftCardRedemptionCount: 0,
              openBandCount: 0,
              grossCash: 0,
              pcGross: 0,
              posTransactionCount: 0,
              cashPaidOut: 0,
              cashPaidOutReason: null,
            },
            gateSales: [],
          };
        if (u.includes("/gate-sales")) return { enrolled: [] };
        if (u.includes("/door-records/")) return { deposit: 0 };
        if (u.includes("/bookings")) return { bookings: [] };
        if (u.includes("/api/events")) return { items: [{ id: "e1", eventDate: "2026-06-25" }] };
        return { items: [] };
      };
      return { ok: true, status: 200, json };
    }),
  );
}

describe("GatePage — no substitute control (043 R12)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not render a 'Substitute a performer' control", async () => {
    const calls: Call[] = [];
    stub(calls);
    const user = userEvent.setup();
    render(<GatePage />);

    await user.selectOptions(await screen.findByRole("combobox", { name: /event/i }), "e1");
    // wait for the gate to finish loading the selected event (its money fields appear)
    await screen.findByLabelText(/gross cash/i);

    expect(screen.queryByText(/substitute a performer/i)).not.toBeInTheDocument();
  });
});
