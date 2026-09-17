// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaymentsPage from "@/app/(admin)/payments/page";
import { SUMMARY } from "./fixtures/paymentSummary";
import {
  BOOKING,
  LINE,
  PAYMENT,
  stubPayments,
  writesTo,
  type StubOpts,
} from "./fixtures/paymentsPage";

afterEach(() => vi.unstubAllGlobals());

const CALLER = BOOKING({
  id: "b-cal",
  performerName: "Cal Caller",
  performerType: "caller",
  payCents: 12000,
});
const ZED = BOOKING({ id: "b-zed", performerName: "Zed Musician" });
const ABE = BOOKING({ id: "b-abe", performerName: "Abe Musician" });
const IVY = BOOKING({
  id: "b-ivy",
  performerName: "Ivy Instructor",
  performerType: "instructor",
  payCents: 0,
  requiresCheck: false,
});

async function open(opts: StubOpts = {}) {
  const calls = stubPayments({ bookings: [IVY, ZED, CALLER, ABE], ...opts });
  const user = userEvent.setup();
  render(<PaymentsPage />);
  await screen.findByRole("listitem", { name: "Cal Caller" });
  return { calls, user };
}

const row = (name: string) => within(screen.getByRole("listitem", { name }));

/** Feature 081 US1 (FR-001–FR-010, FR-031): paying the evening on a phone. */
describe("PaymentsPage — paying (081 US1)", () => {
  it("confirms the event and shows the summary above the performers, in paying order", async () => {
    const { calls } = await open({
      list: { summary: SUMMARY({ booked: 320, stillToPay: 320, stillToPayCount: 3 }) },
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Thursday Night Contra");
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();

    const summary = screen.getByRole("region", { name: "Payments" });
    const list = screen.getByRole("list", { name: "Performers" });
    expect(summary.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.getAttribute("aria-label")),
    ).toEqual(["Cal Caller", "Abe Musician", "Zed Musician", "Ivy Instructor"]);
    // Nothing is recorded until Mary records it (030 FR-004).
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
    // Feature 081 US8 (FR-029): unmatched online payments are no longer on this page.
    expect(screen.queryByText(/parked|unmatched/i)).toBeNull();
    expect(calls.some((c) => c.url.includes("/api/membership-captures/parked"))).toBe(false);
  });

  it("records a check at the booked amount when the amount is left blank", async () => {
    const { calls, user } = await open();
    await user.type(row("Cal Caller").getByLabelText("Check number"), "9001");
    await user.click(row("Cal Caller").getByRole("button", { name: "Record" }));
    await waitFor(() => expect(writesTo(calls, "POST", "/api/performer-payments")).toHaveLength(1));
    expect(writesTo(calls, "POST", "/api/performer-payments")[0]!.body).toEqual({
      eventId: "e1",
      payeePerformerId: "p-b-cal",
      method: "check",
      checkNumber: "9001",
      lines: [{ bookingId: "b-cal", amount: 120 }],
    });
  });

  it("opens a notes box only when the amount is changed, and sends a note only if written", async () => {
    const { calls, user } = await open();
    const r = row("Abe Musician");
    expect(r.queryByLabelText("Note")).toBeNull();
    await user.type(r.getByLabelText("Amount"), "90");
    expect(r.getByLabelText("Note")).toBeInTheDocument();
    await user.type(r.getByLabelText("Check number"), "9002");
    await user.click(r.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(writesTo(calls, "POST", "/api/performer-payments")).toHaveLength(1));
    expect(writesTo(calls, "POST", "/api/performer-payments")[0]!.body).toMatchObject({
      lines: [{ bookingId: "b-abe", amount: 90 }],
    });
    expect(writesTo(calls, "POST", "/api/performer-payments")[0]!.body).not.toHaveProperty(
      "overrideReason",
    );

    // A saved row starts afresh.
    await waitFor(() => expect(r.getByLabelText("Amount")).toHaveValue(""));
    await user.type(r.getByLabelText("Amount"), "80");
    await user.type(r.getByLabelText("Check number"), "9003");
    await user.type(r.getByLabelText("Note"), "left early");
    await user.click(r.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(writesTo(calls, "POST", "/api/performer-payments")).toHaveLength(2));
    expect(writesTo(calls, "POST", "/api/performer-payments")[1]!.body).toMatchObject({
      overrideReason: "left early",
    });
  });

  it("pays in cash with no number", async () => {
    const { calls, user } = await open();
    const r = row("Zed Musician");
    await user.click(r.getByRole("radio", { name: "Cash" }));
    expect(r.queryByLabelText("Check number")).toBeNull();
    await user.click(r.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(writesTo(calls, "POST", "/api/performer-payments")).toHaveLength(1));
    const body = writesTo(calls, "POST", "/api/performer-payments")[0]!.body;
    expect(body).toMatchObject({ method: "cash", lines: [{ bookingId: "b-zed", amount: 100 }] });
    expect(body).not.toHaveProperty("checkNumber");
  });

  it("lets a free booking be paid", async () => {
    const { calls, user } = await open();
    const r = row("Ivy Instructor");
    expect(r.getByText("free")).toBeInTheDocument();
    expect(r.queryByRole("button", { name: "Record" })).toBeNull();
    await user.click(r.getByRole("button", { name: "Pay" }));
    await user.click(r.getByRole("radio", { name: "Cash" }));
    await user.type(r.getByLabelText("Amount"), "25");
    await user.click(r.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(writesTo(calls, "POST", "/api/performer-payments")).toHaveLength(1));
    expect(writesTo(calls, "POST", "/api/performer-payments")[0]!.body).toMatchObject({
      method: "cash",
      lines: [{ bookingId: "b-ivy", amount: 25 }],
    });
  });

  it("shows a paid row as a check or cash, with its note only when there is one", async () => {
    await open({
      payments: [
        PAYMENT({ id: "pay1", checkNumber: "9001", amount: 120, lines: [LINE("b-cal", 120)] }),
        PAYMENT({
          id: "pay2",
          method: "cash",
          checkNumber: null,
          amount: 90,
          overrideReason: "left early",
          lines: [LINE("b-abe", 90, { booked: 100 })],
        }),
      ],
    });
    expect(row("Cal Caller").getByText("Check #9001 $120.00")).toBeInTheDocument();
    expect(row("Cal Caller").queryByText(/note/i)).toBeNull();
    expect(row("Abe Musician").getByText("Cash $90.00")).toBeInTheDocument();
    expect(row("Abe Musician").getByText("left early")).toBeInTheDocument();
    expect(row("Cal Caller").queryByRole("button", { name: "Record" })).toBeNull();
  });

  it("shows a check's total on each row of a check that pays several bookings", async () => {
    await open({
      payments: [
        PAYMENT({
          id: "pay1",
          checkNumber: "9001",
          amount: 175,
          lines: [LINE("b-cal", 50), LINE("b-zed", 125)],
        }),
      ],
    });
    expect(
      row("Cal Caller").getByText("Check #9001 $50.00 · check total $175.00"),
    ).toBeInTheDocument();
    expect(
      row("Zed Musician").getByText("Check #9001 $125.00 · check total $175.00"),
    ).toBeInTheDocument();
    expect(row("Cal Caller").getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("still records a donated fee", async () => {
    const { calls, user } = await open();
    await user.click(row("Zed Musician").getByRole("button", { name: "Donated" }));
    await user.click(await screen.findByRole("button", { name: "Confirm donation" }));
    await waitFor(() =>
      expect(writesTo(calls, "POST", "/api/bookings/b-zed/donate")).toHaveLength(1),
    );
  });

  it("reloads the list after a save and shows a refusal inside the row", async () => {
    const { calls, user } = await open({
      writes: {
        "POST /api/performer-payments": {
          status: 422,
          body: { error: { code: "INVALID_CHECK_NUMBER", message: "A check number is digits…" } },
        },
      },
    });
    const before = calls.filter(
      (c) => c.url.endsWith("/performer-payments") && c.method === "GET",
    ).length;
    await user.type(row("Cal Caller").getByLabelText("Check number"), "#9001");
    await user.click(row("Cal Caller").getByRole("button", { name: "Record" }));
    expect(await row("Cal Caller").findByRole("alert")).toHaveTextContent(
      "A check number is digits…",
    );
    expect(
      calls.filter((c) => c.url.endsWith("/performer-payments") && c.method === "GET").length,
    ).toBe(before);
  });

  it("is read-only for someone who may not record payments (FR-030)", async () => {
    await open({ canWrite: false });
    expect(screen.getByRole("region", { name: "Payments" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pay" })).toBeNull();
    expect(screen.queryByLabelText("Check number")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add a performer/ })).toBeNull();
  });
});
