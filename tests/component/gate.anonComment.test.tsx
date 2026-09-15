// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GatePage from "@/app/(door)/gate/page";
import { BREAKDOWN } from "./fixtures/attendanceBreakdown";

// Feature 031 (P5-R4) US3: the anonymous-sales comment is sent as `note` on the anon line(s) on save, and
// reloads from the persisted note on reopen.
type Call = { url: string; method: string; body: unknown };

function drRecord(gateSales: unknown[]) {
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
    gateSales,
  };
}

function stub(calls: Call[], gateSales: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = async () => {
        if (u.includes("/attendance-breakdown")) return BREAKDOWN(); // feature 079
        if (u.includes("/api/series")) return { items: [{ id: "s1", key: "tnc", name: "TNC" }] };
        if (u.endsWith("/door-record")) return drRecord(gateSales);
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

describe("GatePage — anonymous-sales comment (031 US3)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the comment as note on the anon line when saving", async () => {
    const calls: Call[] = [];
    stub(calls, []);
    const user = userEvent.setup();
    render(<GatePage />);
    await screen.findByText("Gate money");
    await waitFor(() => expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled());

    // An anonymous merchandise cash sale + the section comment.
    const merchRow = screen.getByText("merchandise").closest("tr") as HTMLElement;
    await user.type(within(merchRow).getAllByRole("textbox")[0]!, "12"); // cash column
    await user.type(screen.getByLabelText("Anonymous sales comment"), "3 CDs, 2 shirts");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const put = calls.find((c) => c.url.includes("/gate-sales") && c.method === "PUT");
      expect(put).toBeTruthy();
      const sales = (put!.body as { sales: { category: string; amount: number; note?: string }[] })
        .sales;
      expect(sales).toContainEqual(
        expect.objectContaining({ category: "merchandise", amount: 12, note: "3 CDs, 2 shirts" }),
      );
    });
  });

  it("reloads the comment from the persisted note on reopen", async () => {
    const calls: Call[] = [];
    stub(calls, [
      {
        category: "merchandise",
        paymentMethod: "cash",
        amountCents: 1200,
        contactId: null,
        contactName: null,
        note: "3 CDs, 2 shirts",
      },
    ]);
    render(<GatePage />);
    await screen.findByText("Gate money");

    await waitFor(() =>
      expect((screen.getByLabelText("Anonymous sales comment") as HTMLTextAreaElement).value).toBe(
        "3 CDs, 2 shirts",
      ),
    );
  });
});
