// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GatePage from "@/app/(door)/gate/page";
import { BREAKDOWN } from "./fixtures/attendanceBreakdown";

// D2 (gate data-loss fix): re-opening a door record must REPOPULATE the form from the persisted record —
// money scalars + gate-sale lines — so a subsequent Save round-trips them instead of writing blanks (0 /
// replace-all) over the saved data (the reproduced bug).
type Call = { url: string; init?: RequestInit };

const SAVED = {
  doorRecord: {
    id: "dr1",
    seedFloat: 15,
    compCount: 0,
    giftCardRedemptionCount: 0,
    openBandCount: 0,
    grossCash: 344,
    pcGross: 223,
    posTransactionCount: 16,
    cashPaidOut: 0,
    cashPaidOutReason: null,
  },
  gateSales: [
    {
      category: "membership",
      paymentMethod: "card",
      amountCents: 4000,
      contactId: "c1",
      contactName: "Jane Doe",
      membershipLevel: "family",
    },
    {
      category: "merchandise",
      paymentMethod: "cash",
      amountCents: 1200,
      contactId: null,
      contactName: null,
    },
  ],
};

function stub(calls: Call[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      const json = async () => {
        if (u.endsWith("/door-record")) return SAVED; // POST open → full reload payload
        if (u.includes("/attendance-breakdown")) return BREAKDOWN({ paying: 40 });
        if (u.includes("/gate-sales")) return { enrolled: [] };
        if (u.includes("/door-records/")) return { deposit: 0 }; // PATCH door record
        if (u.includes("/bookings")) return { bookings: [] }; // 025 substitute section
        if (u.includes("/api/events")) return { items: [{ id: "e1", eventDate: "2026-06-25" }] };
        return { items: [] };
      };
      return { ok: true, status: 200, json };
    }),
  );
}

describe("GatePage — reload persisted state on open (D2)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("repopulates money + sale lines, and a Save round-trips them (no wipe)", async () => {
    const calls: Call[] = [];
    stub(calls);
    const user = userEvent.setup();
    render(<GatePage />);

    await user.selectOptions(await screen.findByRole("combobox", { name: /event/i }), "e1");

    // Money fields reload from the saved record (previously blank on return).
    await waitFor(() =>
      expect((screen.getByLabelText(/gross cash/i) as HTMLInputElement).value).toBe("344"),
    );
    expect((screen.getByLabelText(/card gross/i) as HTMLInputElement).value).toBe("223");
    expect((screen.getByLabelText(/card transactions/i) as HTMLInputElement).value).toBe("16");
    // The named membership line reloads with its payer's name.
    expect(screen.getByText(/membership — Jane Doe/)).toBeInTheDocument();
    // Feature 080 (FR-005): …and with the level it was bought at.
    expect(
      (screen.getByRole("combobox", { name: "Level for Jane Doe" }) as HTMLSelectElement).value,
    ).toBe("family");

    // Saving now round-trips the reloaded lines instead of wiping them.
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      const put = calls.find((c) => c.init?.method === "PUT" && c.url.includes("/gate-sales"));
      expect(put).toBeTruthy();
      const sales = JSON.parse(put!.init!.body as string).sales as {
        category: string;
        amount: number;
        contactId?: string;
      }[];
      expect(sales).toContainEqual(
        expect.objectContaining({
          category: "membership",
          amount: 40,
          contactId: "c1",
          membershipLevel: "family",
        }),
      );
      expect(sales).toContainEqual(
        expect.objectContaining({ category: "merchandise", amount: 12 }),
      );
    });
    // And the money PATCH carries the reloaded gross cash, not 0.
    const patch = calls.find((c) => c.init?.method === "PATCH" && c.url.includes("/door-records/"));
    expect(JSON.parse(patch!.init!.body as string)).toMatchObject({ grossCash: 344, pcGross: 223 });
  });

  /** Feature 080 (FR-005, SC-003): correcting another figure on a saved evening keeps the level. */
  it("keeps a membership line's level through a second save", async () => {
    const calls: Call[] = [];
    stub(calls);
    const user = userEvent.setup();
    render(<GatePage />);
    await user.selectOptions(await screen.findByRole("combobox", { name: /event/i }), "e1");
    await waitFor(() =>
      expect((screen.getByLabelText(/gross cash/i) as HTMLInputElement).value).toBe("344"),
    );

    const puts = () =>
      calls.filter((c) => c.init?.method === "PUT" && c.url.includes("/gate-sales"));
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(puts()).toHaveLength(1));

    await user.clear(screen.getByLabelText(/gross cash/i));
    await user.type(screen.getByLabelText(/gross cash/i), "350");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(puts()).toHaveLength(2));

    const second = JSON.parse(puts()[1]!.init!.body as string).sales as Record<string, unknown>[];
    expect(second.find((s) => s.category === "membership")).toMatchObject({
      membershipLevel: "family",
    });
  });

  /** Feature 079 (FR-027, MEG-R10): the Financial Secretary sees the evening's attendance at the top. */
  it("shows the attendance breakdown at the top, and fetches it again after a save", async () => {
    const calls: Call[] = [];
    stub(calls);
    const user = userEvent.setup();
    render(<GatePage />);
    await user.selectOptions(await screen.findByRole("combobox", { name: /event/i }), "e1");

    const breakdown = await screen.findByRole("region", { name: /attendance/i });
    await waitFor(() => expect(breakdown).toHaveTextContent(/Paying 40/));
    const heading = screen.getByRole("heading", { name: /anonymous gate sales/i });
    expect(
      breakdown.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const fetches = () =>
      calls.filter((c) => c.url.includes("/api/events/e1/attendance-breakdown")).length;
    const before = fetches();
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(fetches()).toBeGreaterThan(before));
  });
});
