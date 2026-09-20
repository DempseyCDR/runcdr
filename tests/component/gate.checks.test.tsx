// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GatePage from "@/app/(door)/gate/page";
import { CHECK, SALE, stubGate, writesTo, type GateStubOpts } from "./fixtures/gatePage";

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

const CHUCKS = CHECK({
  id: "k-chuck",
  writer: "Chuck Writer",
  writerContactId: "c-chuck",
  amount: 95,
  note: "covers Jo too",
  recordedBy: { contactId: "c-meg", displayName: "Meg Door" },
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
      note: "T-shirt, L",
    }),
    SALE({
      id: "l3",
      category: "donation",
      paymentMethod: "check",
      amount: 40,
      checkId: "k-chuck",
      contactId: "c-dee",
      contactName: "Dee Member",
    }),
  ],
});

const BIGS = CHECK({
  id: "k-big",
  writer: "Big Donor",
  amount: 500,
  depositSeparately: true,
  lines: [
    SALE({ id: "l4", category: "donation", paymentMethod: "check", amount: 500, checkId: "k-big" }),
  ],
});

const checks = () => within(screen.getByRole("region", { name: "Checks" }));

/** Feature 082 US3 (FR-014–FR-023, FR-029): the checks received, on the gate page. */
describe("GatePage — checks received (082 US3)", () => {
  it("lists each check with its writer, amount, lines, note and who recorded it", async () => {
    await open({ checks: [CHUCKS] });
    const item = checks().getByRole("listitem", { name: "Check from Chuck Writer" });
    expect(item).toHaveTextContent("Chuck Writer");
    expect(item).toHaveTextContent("$95.00");
    expect(item).toHaveTextContent("Admission $30.00 · 2 people");
    expect(item).toHaveTextContent("Merchandise $25.00 — T-shirt, L");
    expect(item).toHaveTextContent("Donation $40.00 · Dee Member");
    expect(item).toHaveTextContent("covers Jo too");
    expect(item).toHaveTextContent("recorded by Meg Door");
  });

  it("shows a membership line's level", async () => {
    await open({
      checks: [
        CHECK({
          id: "k-newt",
          writer: "Newt Payer",
          amount: 40,
          lines: [
            SALE({
              id: "l9",
              category: "membership",
              paymentMethod: "check",
              amount: 40,
              checkId: "k-newt",
              contactId: "c-dee",
              contactName: "Dee Member",
              membershipLevel: "family",
            }),
          ],
        }),
      ],
    });
    const item = checks().getByRole("listitem", { name: "Check from Newt Payer" });
    expect(item).toHaveTextContent("Membership $40.00 · family · Dee Member");
  });

  it("says so plainly when there are none", async () => {
    await open();
    expect(checks().getByText("No checks received.")).toBeInTheDocument();
  });

  it("opens a check to correct it, and saves the change on its own (FR-023)", async () => {
    const { calls, user } = await open({ checks: [CHUCKS] });
    const item = checks().getByRole("listitem", { name: "Check from Chuck Writer" });
    await user.click(within(item).getByRole("button", { name: "Edit" }));
    const dialog = within(screen.getByRole("dialog", { name: "Correct a sale" }));
    expect(dialog.getByRole("radio", { name: "Check" })).toBeChecked();
    expect(dialog.getByLabelText("Note on the check")).toHaveValue("covers Jo too");
    await user.clear(dialog.getByLabelText("Note on the check"));
    await user.click(dialog.getByRole("button", { name: "Record" }));

    await waitFor(() =>
      expect(writesTo(calls, "PATCH", "/api/gate-checks/k-chuck")).toHaveLength(1),
    );
    expect(writesTo(calls, "PATCH", "/api/door-records/dr1")).toHaveLength(0);
  });

  it("removes a check on its own, after asking", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { calls, user } = await open({ checks: [CHUCKS], reloaded: { checks: [] } });
    const item = checks().getByRole("listitem", { name: "Check from Chuck Writer" });
    await user.click(within(item).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(writesTo(calls, "DELETE", "/api/gate-checks/k-chuck")).toHaveLength(1),
    );
    await waitFor(() => expect(checks().getByText("No checks received.")).toBeInTheDocument());
  });

  it("records a check from Add a sale, and keeps money typed but not yet saved", async () => {
    const { calls, user } = await open({
      contacts: [{ id: "c-chuck", displayName: "Chuck Writer" }],
      reloaded: { checks: [CHUCKS] },
    });
    const gross = screen.getByLabelText("Gross cash");
    await user.clear(gross);
    await user.type(gross, "600");

    await user.click(screen.getByRole("button", { name: "Add a sale" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add a sale" }));
    await user.click(dialog.getByRole("radio", { name: "Check" }));
    await user.type(dialog.getByLabelText("Payer"), "Chu");
    await user.click(await dialog.findByRole("button", { name: "Chuck Writer" }));
    const line = within(dialog.getByRole("group", { name: "Line 1" }));
    await user.selectOptions(line.getByLabelText("What was sold"), "admission");
    await user.type(line.getByLabelText("Amount"), "30");
    await user.type(line.getByLabelText("How many?"), "2");
    await user.click(dialog.getByRole("button", { name: "Record" }));

    await waitFor(() =>
      expect(writesTo(calls, "POST", "/api/door-records/dr1/checks")).toHaveLength(1),
    );
    expect(writesTo(calls, "POST", "/api/door-records/dr1/checks")[0]!.body).toEqual({
      writerContactId: "c-chuck",
      lines: [{ category: "admission", amount: 30, quantity: 2 }],
    });
    await checks().findByRole("listitem", { name: "Check from Chuck Writer" });
    expect(screen.queryByRole("dialog", { name: "Add a sale" })).toBeNull();
    // The reload refreshed the checks and left Mary's unsaved figure alone.
    expect(screen.getByLabelText("Gross cash")).toHaveValue("600");
  });

  it("offers no controls to someone who may not record gate money", async () => {
    await open({ checks: [CHUCKS], gateWrite: false });
    expect(screen.queryByRole("button", { name: "Add a sale" })).toBeNull();
    expect(checks().queryByRole("button", { name: "Edit" })).toBeNull();
  });
});

/** Feature 082 (FR-022): the deposits, on the gate page. */
describe("GatePage — deposits (082 US3)", () => {
  it("lists the main deposit with what makes it up, and each check banked on its own", async () => {
    await open({ checks: [CHUCKS, BIGS] });
    const deposits = within(screen.getByRole("region", { name: "Deposits" }));
    const main = deposits.getByRole("listitem", { name: "Main deposit" });
    // $500 counted − the $15 cash box seed + $95 of checks with the cash.
    expect(main).toHaveTextContent("$580.00");
    expect(main).toHaveTextContent("counted cash $500.00");
    expect(main).toHaveTextContent("cash box seed $15.00");
    expect(main).toHaveTextContent("checks $95.00");
    const own = deposits.getByRole("listitem", { name: "Check from Big Donor" });
    expect(own).toHaveTextContent("$500.00");
  });

  it("marks a check as deposited separately in the list", async () => {
    await open({ checks: [BIGS] });
    const item = checks().getByRole("listitem", { name: "Check from Big Donor" });
    expect(item).toHaveTextContent("Deposited separately");
  });
});
