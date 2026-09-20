// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GatePage from "@/app/(door)/gate/page";
import {
  CHECK,
  DOOR_RECORD,
  EVENT,
  OTHER_EVENT,
  SALE,
  stubGate,
  writesTo,
  type GateStubOpts,
} from "./fixtures/gatePage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open(opts: GateStubOpts = {}) {
  const calls = stubGate(opts);
  const user = userEvent.setup();
  render(<GatePage />);
  await screen.findByRole("region", { name: "Money so far" });
  return { calls, user };
}

/** The figure shown against a name in the money summary — the `<dd>` after its `<dt>`. */
function figure(name: string): string {
  const money = screen.getByRole("region", { name: "Money so far" });
  const term = within(money).getByText(name, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? "";
}

const saves = (calls: ReturnType<typeof stubGate>) =>
  writesTo(calls, "PATCH", "/api/door-records/dr1");

/** Feature 082 US1 (FR-001–FR-009, FR-030): the evening's money on a phone. */
describe("GatePage — the evening's money (082 US1)", () => {
  it("confirms the event as the other pages do (FR-002)", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      `Thursday Night Contra · ${EVENT.eventDate} · 7:30 PM`,
    );
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(screen.queryByText(/Not today/)).toBeNull();
  });

  it("warns when the event is not today's", async () => {
    await open({ events: [OTHER_EVENT] });
    await screen.findByText(`Not today — this event is on ${OTHER_EVENT.eventDate}.`);
  });

  it("runs the summary first, then the sections in Mary's order (FR-003, FR-004)", async () => {
    await open();
    const payments = screen.getByRole("region", { name: "Payments" });
    const money = screen.getByRole("region", { name: "Money so far" });
    expect(payments.compareDocumentPosition(money) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const order = ["Door counts", "Cash", "Card", "Sales", "Checks", "Deposits", "Notes"];
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    const positions = order.map((name) => headings.indexOf(name));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    const firstSection = screen.getByRole("heading", { level: 2, name: "Door counts" });
    expect(
      money.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("works out admission by cash, card and check, the card fee, the checks and the deposit", async () => {
    // $500 counted, a $15 float, a $25 T-shirt for cash and a $40 donation by card, and one $95 check
    // paying $30 of admission — the page derives every figure from these, as the server does (R10).
    await open({
      gateSales: [
        SALE({ id: "s-merch", category: "merchandise", paymentMethod: "cash", amount: 25 }),
        SALE({
          id: "s-dee",
          category: "donation",
          paymentMethod: "card",
          amount: 40,
          contactId: "c-dee",
          contactName: "Dee Member",
        }),
      ],
      checks: [
        CHECK({
          id: "k-chuck",
          writer: "Chuck Writer",
          amount: 95,
          lines: [
            SALE({
              id: "l1",
              category: "admission",
              paymentMethod: "check",
              amount: 30,
              quantity: 2,
              checkId: "k-chuck",
            }),
            SALE({
              id: "l2",
              category: "merchandise",
              paymentMethod: "check",
              amount: 25,
              checkId: "k-chuck",
            }),
            SALE({
              id: "l3",
              category: "donation",
              paymentMethod: "check",
              amount: 40,
              checkId: "k-chuck",
            }),
          ],
        }),
      ],
    });
    expect(figure("Admission by cash")).toBe("$460.00");
    expect(figure("Admission by card")).toBe("$140.00");
    expect(figure("Admission by check")).toBe("$30.00");
    expect(figure("Admission")).toBe("$630.00");
    expect(figure("Card fee")).toBe("$4.93");
    expect(figure("Checks")).toBe("$95.00");
    expect(figure("Deposit")).toBe("$580.00");
  });

  it("writes a negative figure as a minus before the dollar sign (FR-007's negative admission)", async () => {
    // No cash counted yet, but the $15 float is already out of the takings.
    await open({ doorRecord: { grossCash: 0 } });
    expect(figure("Admission by cash")).toBe("−$15.00");
    expect(figure("Deposit")).toBe("−$15.00");
  });

  it("shows the door's counts beside the figures Mary confirms, and open band read-only (FR-005)", async () => {
    await open();
    const counts = screen.getByRole("region", { name: "Door counts" });
    expect(within(counts).getByLabelText("Comps (admitted free)")).toHaveValue("3");
    expect(within(counts).getByText("the door recorded 3")).toBeInTheDocument();
    expect(within(counts).getByLabelText("Gift cards redeemed")).toHaveValue("2");
    expect(within(counts).getByText("the door recorded 2")).toBeInTheDocument();
    expect(within(counts).getByText("Open-band comps: 4")).toBeInTheDocument();
    expect(within(counts).queryByLabelText(/open-band/i)).toBeNull();
  });

  it("says 'last saved' rather than 'the door recorded' once the money has been saved", async () => {
    await open({
      doorRecord: { moneyRecordedBy: { contactId: "c-mary", displayName: "Mary FS" } },
    });
    const counts = screen.getByRole("region", { name: "Door counts" });
    expect(within(counts).getByText("last saved 3")).toBeInTheDocument();
    expect(within(counts).queryByText(/the door recorded/)).toBeNull();
  });

  it("follows the typing before any save (FR-006)", async () => {
    const { calls, user } = await open();
    const gross = screen.getByLabelText("Gross cash");
    await user.clear(gross);
    await user.type(gross, "600");
    expect(figure("Admission by cash")).toBe("$585.00");
    expect(figure("Deposit")).toBe("$585.00");

    const card = screen.getByLabelText("Card gross");
    await user.clear(card);
    await user.type(card, "200");
    expect(figure("Admission by card")).toBe("$200.00");
    expect(figure("Card fee")).not.toBe("$4.93");

    expect(saves(calls)).toHaveLength(0);
  });

  it("says nothing is wrong while Mary types, and shows the server's warnings after Save (FR-007)", async () => {
    const { user } = await open({
      writes: {
        "PATCH /api/door-records/dr1": {
          status: 200,
          body: {
            ...DOOR_RECORD({ cashPaidOut: 20 }),
            warnings: [
              {
                code: "PAYOUT_WITHOUT_REASON",
                message: "Cash was paid out with no reason — say what it was for.",
              },
            ],
          },
        },
      },
    });
    await user.type(screen.getByLabelText("Other cash paid out"), "20");
    expect(screen.queryByRole("list", { name: "Warnings" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save" }));
    const warnings = await screen.findByRole("list", { name: "Warnings" });
    expect(warnings).toHaveTextContent("Cash was paid out with no reason");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("saves the money and never a sale or a check — each is recorded on its own (research R16)", async () => {
    const { calls, user } = await open({
      gateSales: [
        SALE({ id: "s-merch", category: "merchandise", paymentMethod: "cash", amount: 25 }),
        SALE({
          id: "s-dee",
          category: "donation",
          paymentMethod: "cash",
          amount: 40,
          contactId: "c-dee",
          contactName: "Dee Member",
        }),
      ],
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(saves(calls)[0]!.body).toMatchObject({
      grossCash: 500,
      seedFloat: 15,
      pcGross: 180,
      posTransactionCount: 9,
      compCount: 3,
      giftCardRedemptionCount: 2,
    });
    expect(saves(calls)[0]!.body).not.toHaveProperty("sales");
    // The Save is the only write: nothing else is sent, and no sale is replaced.
    expect(calls.filter((c) => c.method !== "GET" && !c.url.endsWith("/door-record"))).toHaveLength(
      1,
    );
  });

  it("clears a saved payout reason when Mary empties the box", async () => {
    const { calls, user } = await open({
      doorRecord: { cashPaidOut: 20, cashPaidOutReason: "ice" },
    });
    await user.clear(screen.getByLabelText("Reason"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(saves(calls)[0]!.body).toMatchObject({ cashPaidOutReason: null });
  });

  it("shows, edits and saves the evening's note (FR-030)", async () => {
    const { calls, user } = await open({ doorRecord: { eveningNote: "quiet night" } });
    const note = screen.getByLabelText("The evening's note");
    expect(note).toHaveValue("quiet night");
    await user.clear(note);
    await user.type(note, "the ice ran out at 9");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(saves(calls)[0]!.body).toMatchObject({ eveningNote: "the ice ran out at 9" });
  });

  it("asks before changing the event with unsaved entries (FR-008)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { calls, user } = await open({ events: [EVENT, OTHER_EVENT] });
    await user.type(screen.getByLabelText("Gross cash"), "5");

    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Event" }), "e2");

    expect(confirm).toHaveBeenCalledOnce();
    expect(calls.some((c) => c.url.endsWith("/api/events/e2/door-record"))).toBe(false);
    expect(screen.getByLabelText("Gross cash")).toHaveValue("5005");
  });

  it("changes the event without asking when nothing is unsaved", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const { calls, user } = await open({ events: [EVENT, OTHER_EVENT] });
    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Event" }), "e2");
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/api/events/e2/door-record"))).toBe(true),
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it("warns before leaving the page with unsaved entries, and not after saving (FR-008)", async () => {
    const { user } = await open();
    const leave = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(leave()).toBe(false);
    await user.type(screen.getByLabelText("Gross cash"), "5");
    expect(leave()).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved");
    expect(leave()).toBe(false);
  });

  it("asks the phone for the decimal keypad on money and the number keypad on counts (FR-009)", async () => {
    await open();
    for (const label of ["Gross cash", "Cash box seed", "Other cash paid out", "Card gross"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("inputmode", "decimal");
    }
    for (const label of ["Card transactions", "Comps (admitted free)", "Gift cards redeemed"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("inputmode", "numeric");
    }
  });

  it("lets someone without gate authority read the page but not save it", async () => {
    await open({ gateWrite: false });
    expect(screen.getByRole("region", { name: "Money so far" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

/**
 * What the pre-082 gate page's tests proved that still holds, ported here when those files were retired
 * (tasks.md T033 — the coverage map is in Deviations).
 */
describe("GatePage — carried over from the old page's tests", () => {
  it("reopens with everything already saved, and a Save round-trips it (D2)", async () => {
    const { calls, user } = await open({
      doorRecord: { cashPaidOut: 20, cashPaidOutReason: "ice", eveningNote: "quiet night" },
    });
    expect(screen.getByLabelText("Gross cash")).toHaveValue("500");
    expect(screen.getByLabelText("Cash box seed")).toHaveValue("15");
    expect(screen.getByLabelText("Other cash paid out")).toHaveValue("20");
    expect(screen.getByLabelText("Reason")).toHaveValue("ice");
    expect(screen.getByLabelText("Card gross")).toHaveValue("180");
    expect(screen.getByLabelText("Card transactions")).toHaveValue("9");

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saves(calls)).toHaveLength(1));
    expect(saves(calls)[0]!.body).toMatchObject({
      grossCash: 500,
      cashPaidOut: 20,
      cashPaidOutReason: "ice",
      eveningNote: "quiet night",
    });
  });

  it("shows who came and what the performers are owed, and fetches both again after a save", async () => {
    const { calls, user } = await open();
    const breakdown = await screen.findByRole("region", { name: /attendance/i });
    await waitFor(() => expect(breakdown).toHaveTextContent(/Paying 40/));
    const fetched = (suffix: string) => calls.filter((c) => c.url.endsWith(suffix)).length;
    const before = [fetched("/attendance-breakdown"), fetched("/payment-summary")];

    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved");
    await waitFor(() => expect(fetched("/attendance-breakdown")).toBe(before[0]! + 1));
    expect(fetched("/payment-summary")).toBe(before[1]! + 1);
  });

  it("lists the cash paid to performers, and calls the gate's own figure other cash paid out (081)", async () => {
    await open({
      doorRecord: { performerCash: [{ paymentId: "p1", payee: "Pat Caller", amount: 60 }] },
    });
    expect(screen.getByText("Paid to performers in cash: Pat Caller $60.00")).toBeInTheDocument();
    expect(screen.getByLabelText("Other cash paid out")).toBeInTheDocument();
  });

  it("counts the performers' cash out of the deposit as Mary types", async () => {
    const { user } = await open({
      doorRecord: { performerCash: [{ paymentId: "p1", payee: "Pat Caller", amount: 60 }] },
    });
    const gross = screen.getByLabelText("Gross cash");
    await user.clear(gross);
    await user.type(gross, "600");
    expect(figure("Deposit")).toBe("$525.00");
  });

  it("says nothing was saved, with the server's reason", async () => {
    const { user } = await open({
      writes: {
        "PATCH /api/door-records/dr1": {
          status: 422,
          body: { error: { code: "VALIDATION_ERROR", message: "gross cash is not a number" } },
        },
      },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Nothing was saved: gross cash is not a number");
  });

  it("says so when the server cannot be reached", async () => {
    stubGate();
    const user = userEvent.setup();
    render(<GatePage />);
    await screen.findByRole("region", { name: "Money so far" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("offline"))),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Nothing was saved: Could not reach the server.");
  });

  it("says who may record gate money when the server refuses the caller", async () => {
    const { user } = await open({
      writes: { "PATCH /api/door-records/dr1": { status: 403, body: {} } },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(
      "Nothing was saved: Only the Financial Secretary or Treasurer for this series may record gate money.",
    );
  });

  it("has no substitute-a-performer control — that is /payments' (043 R12)", async () => {
    await open();
    expect(screen.queryByRole("button", { name: /substitute/i })).toBeNull();
  });
});
