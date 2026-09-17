// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaymentsPage from "@/app/(admin)/payments/page";
import {
  BOOKING,
  LINE,
  PAYMENT,
  stubPayments,
  writesTo,
  type StubOpts,
} from "./fixtures/paymentsPage";

afterEach(() => vi.unstubAllGlobals());

const PIANO = BOOKING({ id: "b-pia", performerName: "Payee Piano", payCents: 9000 });

async function open(opts: StubOpts = {}) {
  const calls = stubPayments({ bookings: [PIANO], ...opts });
  const user = userEvent.setup();
  render(<PaymentsPage />);
  await screen.findByRole("listitem", { name: "Payee Piano" });
  return { calls, user };
}

const row = () => within(screen.getByRole("listitem", { name: "Payee Piano" }));

async function recordCheck(user: ReturnType<typeof userEvent.setup>, number: string) {
  await user.type(row().getByLabelText("Check number"), number);
  await user.click(row().getByRole("button", { name: "Record" }));
}

const taken = (details: Record<string, unknown>) => ({
  status: 409,
  body: {
    error: {
      code: "CHECK_NUMBER_TAKEN",
      message: "Check #9001 is already used (Payee Caller, 2026-06-18).",
      details: {
        paymentId: "pay1",
        eventId: "e1",
        eventDate: "2026-06-18",
        payee: "Payee Caller",
        voided: false,
        sameEvent: true,
        ...details,
      },
    },
  },
});

/** Feature 081 US2 (FR-013, FR-014): the server's refusals become choices. */
describe("PaymentsPage — number taken, second payment (081 US2)", () => {
  it("offers to add the booking to a live check at this event, or to change the number", async () => {
    const { calls, user } = await open({ writes: { "POST /api/performer-payments": taken({}) } });
    await recordCheck(user, "9001");

    const dialog = await screen.findByRole("dialog", { name: "Check number already used" });
    expect(dialog).toHaveTextContent("Check #9001 is already used (Payee Caller, 2026-06-18).");
    expect(dialog).toHaveTextContent("From a duplicate check book? Add a letter, e.g. 9001A.");
    await user.click(
      within(dialog).getByRole("button", { name: "Add this booking to check #9001" }),
    );

    await waitFor(() =>
      expect(writesTo(calls, "POST", "/api/performer-payments/pay1/lines")).toHaveLength(1),
    );
    expect(writesTo(calls, "POST", "/api/performer-payments/pay1/lines")[0]!.body).toEqual({
      eventId: "e1",
      bookingId: "b-pia",
      amount: 90,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("returns to the number field on Change the number", async () => {
    const { calls, user } = await open({ writes: { "POST /api/performer-payments": taken({}) } });
    await recordCheck(user, "9001");
    const dialog = await screen.findByRole("dialog", { name: "Check number already used" });
    await user.click(within(dialog).getByRole("button", { name: "Change the number" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(row().getByLabelText("Check number")).toHaveFocus();
    expect(writesTo(calls, "POST", "/api/performer-payments/pay1/lines")).toHaveLength(0);
  });

  it.each([
    ["a voided check", { voided: true }],
    ["a check at another event", { sameEvent: false }],
  ])("offers only Change the number for %s", async (_label, details) => {
    const { user } = await open({ writes: { "POST /api/performer-payments": taken(details) } });
    await recordCheck(user, "9001");
    const dialog = await screen.findByRole("dialog", { name: "Check number already used" });
    expect(within(dialog).queryByRole("button", { name: /Add this booking/ })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Change the number" })).toBeInTheDocument();
  });

  it("asks before paying a performer twice, and pays again only when told to", async () => {
    const second = {
      status: 409,
      body: {
        error: {
          code: "SECOND_PAYMENT_TO_PAYEE",
          message: "Payee Piano already has check #9031 tonight.",
          details: { paymentId: "pay9", checkNumber: "9031", method: "check", amount: 50 },
        },
      },
    };
    const { calls, user } = await open({
      writes: {
        "POST /api/performer-payments": (body) =>
          (body as { confirmSecondPayment?: boolean }).confirmSecondPayment
            ? { status: 201, body: { id: "new" } }
            : second,
      },
    });
    await recordCheck(user, "9032");

    let dialog = await screen.findByRole("dialog", { name: "Pay again?" });
    expect(dialog).toHaveTextContent("Payee Piano already has check #9031 tonight. Pay again?");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(writesTo(calls, "POST", "/api/performer-payments")).toHaveLength(1);

    await user.click(row().getByRole("button", { name: "Record" }));
    dialog = await screen.findByRole("dialog", { name: "Pay again?" });
    await user.click(within(dialog).getByRole("button", { name: "Pay again" }));
    await waitFor(() => expect(writesTo(calls, "POST", "/api/performer-payments")).toHaveLength(3));
    expect(writesTo(calls, "POST", "/api/performer-payments")[2]!.body).toMatchObject({
      checkNumber: "9032",
      confirmSecondPayment: true,
    });
    await waitFor(() => expect(row().getByLabelText("Check number")).toHaveValue(""));
  });
});

/** Feature 081 US3 (FR-016–FR-021, FR-034): void and delete, told apart before the tap. */
describe("PaymentsPage — void and delete (081 US3)", () => {
  const PAID_CHECK = PAYMENT({
    id: "pay1",
    payee: "Payee Piano",
    checkNumber: "9001",
    amount: 90,
    lines: [LINE("b-pia", 90, { performer: "Payee Piano" })],
  });
  const PAID_CASH = PAYMENT({
    id: "pay2",
    payee: "Payee Piano",
    method: "cash",
    checkNumber: null,
    amount: 25,
    lines: [LINE("b-pia", 25, { performer: "Payee Piano" })],
  });

  it("explains void and delete once, above the list, not on every paid row", async () => {
    await open({ payments: [PAID_CHECK] });
    expect(row().getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(row().getByRole("button", { name: "Void" })).toBeInTheDocument();
    expect(row().getByRole("button", { name: "Delete" })).toBeInTheDocument();
    const reminders = screen.getAllByText(
      "Void: the check was written. Delete: it was never written.",
    );
    expect(reminders).toHaveLength(1);
    const list = screen.getByRole("list", { name: "Performers" });
    expect(
      reminders[0]!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows no void and delete reminder to someone who may not record payments", async () => {
    await open({ payments: [PAID_CHECK], canWrite: false });
    expect(screen.queryByText(/Void: the check was written/)).toBeNull();
  });

  it("offers no void for cash", async () => {
    await open({ payments: [PAID_CASH] });
    expect(row().queryByRole("button", { name: "Void" })).toBeNull();
    expect(row().getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("deletes a check only after the never-written question", async () => {
    const { calls, user } = await open({ payments: [PAID_CHECK] });
    await user.click(row().getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete payment" });
    expect(dialog).toHaveTextContent(
      "This erases check #9001 as never written. If you wrote it, void it instead.",
    );
    expect(dialog).not.toHaveTextContent(/treasurer report/i);
    expect(within(dialog).getByRole("button", { name: "Void" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(writesTo(calls, "DELETE", "/api/performer-payments/pay1")).toHaveLength(1),
    );
  });

  it("names the cash payment, and warns once the report was generated after the evening", async () => {
    const { user } = await open({
      eventDate: "2026-06-18",
      payments: [PAID_CASH],
      list: { treasurerReportGeneratedAt: "2026-06-19T20:00:00Z" },
    });
    await user.click(row().getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete payment" });
    expect(dialog).toHaveTextContent("This erases the cash payment of $25.00 to Payee Piano.");
    expect(dialog).toHaveTextContent(
      "The treasurer report for this event has been generated. It may already be in the ledger.",
    );
    expect(dialog).not.toHaveTextContent(/Mike/);
    expect(within(dialog).queryByRole("button", { name: "Void" })).toBeNull();
  });

  it("warns about the treasurer report when deleting a check too", async () => {
    const { user } = await open({
      eventDate: "2026-06-18",
      payments: [PAID_CHECK],
      list: { treasurerReportGeneratedAt: "2026-06-19T20:00:00Z" },
    });
    await user.click(row().getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("dialog", { name: "Delete payment" })).toHaveTextContent(
      "It may already be in the ledger.",
    );
  });

  it("does not warn when the report was only generated on the evening itself", async () => {
    const { user } = await open({
      eventDate: "2026-06-18",
      payments: [PAID_CHECK],
      list: { treasurerReportGeneratedAt: "2026-06-18T16:00:00Z" },
    });
    await user.click(row().getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("dialog", { name: "Delete payment" })).not.toHaveTextContent(
      /treasurer report/i,
    );
  });

  it("voids only with a reason, listing what the check paid", async () => {
    const { calls, user } = await open({ payments: [PAID_CHECK] });
    await user.click(row().getByRole("button", { name: "Void" }));
    const dialog = await screen.findByRole("dialog", { name: "Void check" });
    expect(dialog).toHaveTextContent("Void check #9001 to Payee Piano?");
    expect(dialog).toHaveTextContent("Payee Piano — $90.00");
    const confirm = within(dialog).getByRole("button", { name: "Void check" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Reason"), "wrong amount");
    await user.click(confirm);
    await waitFor(() =>
      expect(writesTo(calls, "POST", "/api/performer-payments/pay1/void")).toHaveLength(1),
    );
    expect(writesTo(calls, "POST", "/api/performer-payments/pay1/void")[0]!.body).toEqual({
      reason: "wrong amount",
    });
  });

  it("puts a void's line straight under the payment line, with the note", async () => {
    await open({
      payments: [
        PAYMENT({
          id: "pay5",
          checkNumber: "9005",
          amount: 80,
          overrideReason: "left early",
          lines: [LINE("b-pia", 80, { booked: 90 })],
        }),
      ],
      list: {
        voidedByBooking: {
          "b-pia": [{ paymentId: "pay4", checkNumber: "9004", reason: "wrong amount" }],
        },
      },
    });
    const paid = row().getByText("Check #9005 $80.00");
    const note = row().getByText("left early");
    const voided = row().getByText("Voided #9004 — wrong amount");
    const edit = row().getByRole("button", { name: "Edit" });
    const follows = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(paid, note)).toBe(true);
    expect(follows(note, voided)).toBe(true);
    expect(follows(voided, edit)).toBe(true);
  });

  it("keeps a quiet line for each void, also after a replacement", async () => {
    await open({
      payments: [
        PAYMENT({ id: "pay5", checkNumber: "9005", amount: 90, lines: [LINE("b-pia", 90)] }),
      ],
      list: {
        voidedByBooking: {
          "b-pia": [{ paymentId: "pay4", checkNumber: "9004", reason: "wrong amount" }],
        },
      },
    });
    expect(row().getByText("Voided #9004 — wrong amount")).toBeInTheDocument();
    expect(row().getByText("Check #9005 $90.00")).toBeInTheDocument();
  });
});
