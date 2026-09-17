// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GatePage from "@/app/(door)/gate/page";
import { BREAKDOWN } from "./fixtures/attendanceBreakdown";
import { SUMMARY } from "./fixtures/paymentSummary";

afterEach(() => vi.unstubAllGlobals());

const RECORD = {
  doorRecord: {
    id: "dr1",
    seedFloat: 15,
    compCount: 0,
    giftCardRedemptionCount: 0,
    openBandCount: 0,
    grossCash: 300,
    pcGross: 0,
    posTransactionCount: 0,
    cashPaidOut: 20,
    cashPaidOutReason: "ice",
    performerCash: [{ paymentId: "pay1", payee: "Payee Fiddle", amount: 60 }],
  },
  gateSales: [],
};

function stub() {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      urls.push(u);
      const body = u.endsWith("/door-record")
        ? RECORD
        : u.includes("/attendance-breakdown")
          ? BREAKDOWN()
          : u.includes("/payment-summary")
            ? SUMMARY({ booked: 320, paid: 60, stillToPay: 260, stillToPayCount: 2 })
            : u.includes("/door-records/")
              ? { deposit: 205 }
              : u.includes("/gate-sales")
                ? { enrolled: [] }
                : u.includes("/api/events")
                  ? { items: [{ id: "e1", eventDate: "2026-06-25" }] }
                  : { items: [] };
      return { ok: true, status: 200, json: async () => body };
    }),
  );
  return urls;
}

/** Feature 081 (FR-005, FR-033): the gate sees the performers' pay and the cash already paid to them. */
describe("GatePage — performers' pay (081)", () => {
  it("shows the payments summary under the attendance breakdown, and fetches it again after a save", async () => {
    const urls = stub();
    const user = userEvent.setup();
    render(<GatePage />);
    await user.selectOptions(await screen.findByRole("combobox", { name: /event/i }), "e1");

    const payments = await screen.findByRole("region", { name: "Payments" });
    expect(payments).toHaveTextContent("Still to pay $260.00 (2)");
    const attendance = screen.getByRole("region", { name: /attendance/i });
    expect(
      attendance.compareDocumentPosition(payments) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const fetched = () => urls.filter((u) => u.includes("/api/events/e1/payment-summary")).length;
    const before = fetched();
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(fetched()).toBeGreaterThan(before));
  });

  it("lists cash paid to performers, and labels the gate's own figure as other cash paid out", async () => {
    stub();
    const user = userEvent.setup();
    render(<GatePage />);
    await user.selectOptions(await screen.findByRole("combobox", { name: /event/i }), "e1");

    expect(
      await screen.findByText("Paid to performers in cash: Payee Fiddle $60.00"),
    ).toBeInTheDocument();
    expect((screen.getByLabelText("Other cash paid out") as HTMLInputElement).value).toBe("20");
    expect(screen.queryByLabelText(/^Cash paid out/)).toBeNull();
  });
});
