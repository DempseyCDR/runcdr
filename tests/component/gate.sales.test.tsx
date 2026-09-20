// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GatePage from "@/app/(door)/gate/page";
import { SALE, stubGate, writesTo, type GateStubOpts } from "./fixtures/gatePage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open(opts: GateStubOpts = {}) {
  const calls = stubGate({ contacts: [{ id: "c-dee", displayName: "Dee Member" }], ...opts });
  const user = userEvent.setup();
  render(<GatePage />);
  await screen.findByRole("region", { name: "Money so far" });
  return { calls, user };
}

const DEE = SALE({
  id: "s-dee",
  category: "membership",
  paymentMethod: "cash",
  amount: 25,
  contactId: "c-dee",
  contactName: "Dee Member",
  membershipLevel: "individual",
  note: "renewed at the door",
  recordedBy: { contactId: "c-meg", displayName: "Meg Door" },
});
const JO = SALE({
  id: "s-jo",
  category: "future_event",
  paymentMethod: "card",
  amount: 15,
  contactId: "c-jo",
  contactName: "Jo Friend",
});
const SHIRTS = SALE({
  id: "s-shirts",
  category: "merchandise",
  paymentMethod: "cash",
  amount: 75,
  quantity: 3,
  note: "T-shirts",
  recordedBy: { contactId: "c-meg", displayName: "Meg Door" },
});

const sales = () => within(screen.getByRole("region", { name: "Sales" }));

/**
 * Feature 082 (research R16 — the P1 review): every sale is its own line. The Sales section lists every
 * sale that is not a check's line, anonymous ones included, and the one Add a sale records any of them.
 */
describe("GatePage — sales", () => {
  it("lists a named sale with its person, amount, how it was paid, its note and who recorded it", async () => {
    await open({ gateSales: [DEE, JO] });
    const dee = sales().getByRole("listitem", { name: "Dee Member" });
    expect(dee).toHaveTextContent("$25.00 cash");
    expect(dee).toHaveTextContent("Membership · individual");
    expect(dee).toHaveTextContent("renewed at the door");
    expect(dee).toHaveTextContent("recorded by Meg Door");
  });

  it("lists an anonymous sale by what was sold, with its quantity", async () => {
    await open({ gateSales: [SHIRTS] });
    const shirts = sales().getByRole("listitem", { name: "Merchandise" });
    expect(shirts).toHaveTextContent("$75.00 cash");
    expect(shirts).toHaveTextContent("qty 3");
    expect(shirts).toHaveTextContent("T-shirts");
    expect(shirts).toHaveTextContent("recorded by Meg Door");
  });

  it("shows no empty note where a sale has none (FR-028)", async () => {
    await open({ gateSales: [JO] });
    const jo = sales().getByRole("listitem", { name: "Jo Friend" });
    expect(jo.querySelectorAll("p")).toHaveLength(0);
  });

  it("says so plainly when there are none", async () => {
    await open();
    expect(sales().getByText("None yet.")).toBeInTheDocument();
  });

  it("has one Add a sale, and records an anonymous sale on its own (FR-026)", async () => {
    const { calls, user } = await open({ reloaded: { gateSales: [SHIRTS] } });
    expect(screen.getAllByRole("button", { name: "Add a sale" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Add a check" })).toBeNull();

    await user.click(sales().getByRole("button", { name: "Add a sale" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add a sale" }));
    await user.selectOptions(dialog.getByLabelText("What was sold"), "merchandise");
    await user.type(dialog.getByLabelText("Amount"), "75");
    await user.type(dialog.getByLabelText("How many?"), "3");
    await user.click(dialog.getByRole("button", { name: "Record" }));

    await waitFor(() =>
      expect(writesTo(calls, "POST", "/api/door-records/dr1/sales")).toHaveLength(1),
    );
    await sales().findByRole("listitem", { name: "Merchandise" });
    expect(writesTo(calls, "PATCH", "/api/door-records/dr1")).toHaveLength(0);
  });

  it("corrects and removes a sale, one at a time", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { calls, user } = await open({ gateSales: [DEE, SHIRTS] });
    const dee = sales().getByRole("listitem", { name: "Dee Member" });
    await user.click(within(dee).getByRole("button", { name: "Edit" }));
    const dialog = within(screen.getByRole("dialog", { name: "Correct a sale" }));
    await user.click(dialog.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(writesTo(calls, "PATCH", "/api/gate-sales/s-dee")).toHaveLength(1));

    const shirts = sales().getByRole("listitem", { name: "Merchandise" });
    await user.click(within(shirts).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(writesTo(calls, "DELETE", "/api/gate-sales/s-shirts")).toHaveLength(1),
    );
  });

  it("offers no controls to someone who may not record gate money", async () => {
    await open({ gateSales: [DEE], gateWrite: false });
    expect(screen.queryByRole("button", { name: "Add a sale" })).toBeNull();
    expect(sales().queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
