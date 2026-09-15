// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GatePage from "@/app/(door)/gate/page";
import { BREAKDOWN } from "./fixtures/attendanceBreakdown";

// Feature 031 (P5-R4) US1/US2: an optional denomination helper totals cash (Σ bill count × face + coins +
// checks) into the single gross-cash field; the direct gross-cash entry always works.
const SAVED = {
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

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = async () => {
        if (u.includes("/attendance-breakdown")) return BREAKDOWN(); // feature 079
        if (u.includes("/api/series")) return { items: [{ id: "s1", key: "tnc", name: "TNC" }] };
        if (u.endsWith("/door-record")) return SAVED;
        if (u.includes("/gate-sales")) return { enrolled: [] };
        if (u.includes("/door-records/")) return { deposit: 0 };
        if (u.includes("/bookings")) return { bookings: [] };
        if (u.includes("/api/events"))
          return {
            items: [
              { id: "e1", eventDate: "2026-06-25", seriesId: "s1", startTime: null, label: null },
            ],
          };
        return { items: [] };
      };
      return { ok: true, status: 200, json };
    }),
  );
}

const grossCash = () => screen.getByLabelText("Gross cash") as HTMLInputElement;

describe("GatePage — denomination helper + direct total (031 US1/US2)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("US1: totals bills + coins + checks and fills gross cash on 'Use as gross cash'", async () => {
    stub();
    const user = userEvent.setup();
    render(<GatePage />);
    await screen.findByText("Gate money");

    await user.type(screen.getByLabelText("$20 bills"), "3"); // 60
    await user.type(screen.getByLabelText("$10 bills"), "5"); // 50
    await user.type(screen.getByLabelText("Coins"), "5.25"); // 5.25
    await user.type(screen.getByLabelText("Checks"), "40"); // 40  → 155.25 (checks fold in, FR-003)

    await waitFor(() => expect(screen.getByText(/Grand cash total:/)).toHaveTextContent("$155.25"));

    await user.click(screen.getByRole("button", { name: /use as gross cash/i }));
    expect(grossCash().value).toBe("155.25");
  });

  it("US2: the gross-cash total can be typed directly, and a manual edit after the helper wins", async () => {
    stub();
    const user = userEvent.setup();
    render(<GatePage />);
    await screen.findByText("Gate money");

    // Direct entry, no helper.
    await user.type(grossCash(), "200");
    expect(grossCash().value).toBe("200");

    // Use the helper, then hand-edit gross cash → the edit is the recorded value (one value, last wins).
    await user.type(screen.getByLabelText("$5 bills"), "2"); // 10
    await user.click(screen.getByRole("button", { name: /use as gross cash/i }));
    expect(grossCash().value).toBe("10.00");
    await user.clear(grossCash());
    await user.type(grossCash(), "215");
    expect(grossCash().value).toBe("215");
  });
});
