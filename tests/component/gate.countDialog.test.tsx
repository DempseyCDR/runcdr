// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import GatePage from "@/app/(door)/gate/page";
import { stubGate, writesTo, type GateStubOpts } from "./fixtures/gatePage";

afterEach(() => vi.unstubAllGlobals());

async function open(opts: GateStubOpts = {}) {
  const calls = stubGate(opts);
  const user = userEvent.setup();
  render(<GatePage />);
  await screen.findByRole("region", { name: "Money so far" });
  return { calls, user };
}

const dialog = () => within(screen.getByRole("dialog", { name: "Count the cash" }));
const face = (name: string) => dialog().getByRole("button", { name });

async function key(user: UserEvent, keys: string) {
  for (const k of keys) {
    await user.click(dialog().getByRole("button", { name: k === "." ? "Decimal point" : k }));
  }
}

/** Feature 082 US2 (FR-010–FR-013): counting the drawer with the dialog's own keypad. */
describe("GatePage — counting the cash (082 US2)", () => {
  it("lists the bill faces and the coins, with a keypad and no place for checks (FR-010, FR-013)", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Count" }));

    for (const f of ["$100", "$50", "$20", "$10", "$5", "$1", "Coins"]) {
      expect(face(f)).toBeInTheDocument();
    }
    for (const k of ["0", "1", "9", "Delete", "Next", "Previous"]) {
      expect(dialog().getByRole("button", { name: k })).toBeInTheDocument();
    }
    expect(dialog().queryByText(/check/i)).toBeNull();
  });

  it("keys the counts and keeps a running total (FR-010)", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Count" }));

    // $100 is chosen first.
    await key(user, "2");
    await user.click(dialog().getByRole("button", { name: "Next" })); // $50
    await user.click(dialog().getByRole("button", { name: "Next" })); // $20
    await key(user, "4");
    await user.click(face("$5"));
    await key(user, "67");
    await user.click(dialog().getByRole("button", { name: "Delete" })); // 6
    await user.click(face("Coins"));
    await key(user, "4.35");

    expect(face("$100")).toHaveTextContent("2");
    expect(face("$20")).toHaveTextContent("4");
    expect(face("$5")).toHaveTextContent("6");
    expect(dialog().getByText("Total $314.35")).toBeInTheDocument();
  });

  it("goes back a denomination with Previous", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Count" }));
    await user.click(dialog().getByRole("button", { name: "Next" }));
    await user.click(dialog().getByRole("button", { name: "Previous" }));
    await key(user, "3");
    expect(face("$100")).toHaveTextContent("3");
  });

  it("puts the total in gross cash and closes (FR-011)", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Count" }));
    await key(user, "3");
    await user.click(dialog().getByRole("button", { name: "Use as gross cash" }));

    expect(screen.queryByRole("dialog", { name: "Count the cash" })).toBeNull();
    expect(screen.getByLabelText("Gross cash")).toHaveValue("300.00");
  });

  it("keeps the counts when closed and reopened (FR-012)", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Count" }));
    await key(user, "2");
    await user.click(dialog().getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Count" }));
    expect(face("$100")).toHaveTextContent("2");
  });

  it("keeps the counts on the server as Mary moves between them, so a reload does not lose them", async () => {
    const { calls, user } = await open();
    await user.click(screen.getByRole("button", { name: "Count" }));
    await key(user, "2");
    await user.click(dialog().getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(writesTo(calls, "PATCH", "/api/door-records/dr1").at(-1)?.body).toEqual({
        cashCount: { "100": 2 },
      }),
    );
  });

  it("reopens a count in progress after a reload (FR-012)", async () => {
    const { user } = await open({ doorRecord: { cashCount: { "100": 2, "20": 4, coins: 4.35 } } });
    await user.click(screen.getByRole("button", { name: "Count" }));
    expect(face("$100")).toHaveTextContent("2");
    expect(face("$20")).toHaveTextContent("4");
    expect(dialog().getByText("Total $284.35")).toBeInTheDocument();
  });

  it("is not offered to someone who may not record gate money", async () => {
    await open({ gateWrite: false });
    expect(screen.queryByRole("button", { name: "Count" })).toBeNull();
  });
});
