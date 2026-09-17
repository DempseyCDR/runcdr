// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PaymentSummaryView from "@/app/_components/PaymentSummaryView";
import { SUMMARY } from "./fixtures/paymentSummary";

/** Feature 081 (FR-004, FR-005): the payments summary at the top of /payments and /gate. */
describe("PaymentSummaryView", () => {
  it("reads booked, paid and what is still to pay, with the count", () => {
    render(
      <PaymentSummaryView
        summary={SUMMARY({ booked: 320, paid: 210, stillToPay: 100, stillToPayCount: 1 })}
      />,
    );
    const region = screen.getByRole("region", { name: "Payments" });
    expect(region).toHaveTextContent("Booked $320.00 · Paid $210.00 · Still to pay $100.00 (1)");
  });

  it("says All paid when nothing is left", () => {
    render(<PaymentSummaryView summary={SUMMARY({ booked: 320, paid: 320 })} />);
    expect(screen.getByRole("region", { name: "Payments" })).toHaveTextContent(
      "Booked $320.00 · Paid $320.00 · All paid",
    );
    expect(screen.queryByText(/Still to pay/)).toBeNull();
  });

  it("shows the difference only when there is one, with its sign", () => {
    const { rerender } = render(<PaymentSummaryView summary={SUMMARY()} />);
    expect(screen.queryByText(/Difference/)).toBeNull();
    rerender(<PaymentSummaryView summary={SUMMARY({ difference: -10 })} />);
    expect(screen.getByText("Difference −$10.00")).toBeInTheDocument();
    rerender(<PaymentSummaryView summary={SUMMARY({ difference: 15 })} />);
    expect(screen.getByText("Difference +$15.00")).toBeInTheDocument();
  });

  it("shows earlier bookings paid tonight only when there are any", () => {
    const { rerender } = render(<PaymentSummaryView summary={SUMMARY()} />);
    expect(screen.queryByText(/Earlier bookings/)).toBeNull();
    rerender(<PaymentSummaryView summary={SUMMARY({ earlierPaidHere: 60 })} />);
    expect(screen.getByText("Earlier bookings paid tonight $60.00")).toBeInTheDocument();
  });
});
