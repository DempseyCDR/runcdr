// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import SaleOrCheckDialog from "@/app/_components/SaleOrCheckDialog";
import { stubGate, writesTo, type GateStubOpts } from "./fixtures/gatePage";

afterEach(() => vi.unstubAllGlobals());

const CONTACTS = [
  { id: "c-chuck", displayName: "Chuck Writer" },
  { id: "c-dee", displayName: "Dee Member" },
];

function open(opts: GateStubOpts & { canMark?: boolean; editing?: Record<string, unknown> } = {}) {
  const calls = stubGate({ contacts: CONTACTS, ...opts });
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(
    <SaleOrCheckDialog
      doorRecordId="dr1"
      canMark={opts.canMark ?? true}
      editing={opts.editing as never}
      onSaved={onSaved}
      onClose={() => {}}
    />,
  );
  return { calls, onSaved, user };
}

const dialog = () => within(screen.getByRole("dialog"));
const line = (n: number) => within(dialog().getByRole("group", { name: `Line ${n}` }));
const record = (user: UserEvent) => user.click(dialog().getByRole("button", { name: "Record" }));
const SALES = "/api/door-records/dr1/sales";
const CHECKS = "/api/door-records/dr1/checks";

async function pickPayer(user: UserEvent, name = "Chuck Writer") {
  await user.type(dialog().getByLabelText("Payer"), name.slice(0, 3));
  await user.click(await dialog().findByRole("button", { name }));
}

const categories = (n: number) =>
  within(line(n).getByLabelText("What was sold"))
    .getAllByRole("option")
    .map((o) => o.getAttribute("value"));

/**
 * Feature 082 (research R16, R17 — the P1 review): ONE dialog, "Add a sale", from the door and the gate.
 * Paid by cash, check or card; cash and card record one line, a check several.
 */
describe("Add a sale — cash or card", () => {
  it("is called Add a sale, and starts on cash", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Add a sale" })).toBeInTheDocument();
    expect(dialog().getByRole("radio", { name: "Cash" })).toBeChecked();
  });

  it("records merchandise with a quantity and a note, no one named", async () => {
    const { calls, onSaved, user } = open();
    await user.selectOptions(line(1).getByLabelText("What was sold"), "merchandise");
    await user.type(line(1).getByLabelText("Amount"), "75");
    await user.type(line(1).getByLabelText("How many?"), "3");
    await user.type(line(1).getByLabelText("Note"), "T-shirts");
    await record(user);

    await waitFor(() => expect(writesTo(calls, "POST", SALES)).toHaveLength(1));
    expect(writesTo(calls, "POST", SALES)[0]!.body).toEqual({
      category: "merchandise",
      paymentMethod: "cash",
      amount: 75,
      quantity: 3,
      note: "T-shirts",
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("records a membership by card for its payer, with the level", async () => {
    const { calls, user } = open();
    await user.click(dialog().getByRole("radio", { name: "Card" }));
    await pickPayer(user, "Dee Member");
    await user.selectOptions(line(1).getByLabelText("What was sold"), "membership");
    await user.selectOptions(line(1).getByLabelText("Level"), "individual");
    await user.type(line(1).getByLabelText("Amount"), "25");
    await record(user);

    await waitFor(() => expect(writesTo(calls, "POST", SALES)).toHaveLength(1));
    expect(writesTo(calls, "POST", SALES)[0]!.body).toEqual({
      category: "membership",
      paymentMethod: "card",
      amount: 25,
      contactId: "c-dee",
      membershipLevel: "individual",
    });
  });

  it("names the payer on an anonymous sale when one is given", async () => {
    const { calls, user } = open();
    await pickPayer(user);
    await user.selectOptions(line(1).getByLabelText("What was sold"), "gift_card");
    await user.type(line(1).getByLabelText("Amount"), "50");
    await record(user);
    await waitFor(() => expect(writesTo(calls, "POST", SALES)).toHaveLength(1));
    expect(writesTo(calls, "POST", SALES)[0]!.body).toMatchObject({ contactId: "c-chuck" });
  });

  it("needs a payer for a membership, a donation or a future event", async () => {
    const { calls, user } = open();
    await user.selectOptions(line(1).getByLabelText("What was sold"), "donation");
    await user.type(line(1).getByLabelText("Amount"), "10");
    await record(user);
    expect(dialog().getByRole("alert")).toHaveTextContent("Who is the payer?");
    expect(writesTo(calls, "POST", SALES)).toHaveLength(0);
  });

  it("asks what was sold, and how much", async () => {
    const { user } = open();
    await record(user);
    expect(dialog().getByRole("alert")).toHaveTextContent("What was sold?");
    await user.selectOptions(line(1).getByLabelText("What was sold"), "merchandise");
    await record(user);
    expect(dialog().getByRole("alert")).toHaveTextContent("How much was paid?");
  });

  it("asks for a membership's level", async () => {
    const { user } = open();
    await pickPayer(user, "Dee Member");
    await user.selectOptions(line(1).getByLabelText("What was sold"), "membership");
    await user.type(line(1).getByLabelText("Amount"), "25");
    await record(user);
    expect(dialog().getByRole("alert")).toHaveTextContent("Choose the membership's level.");
  });

  it("offers no admission, and no second line", () => {
    open();
    expect(categories(1)).not.toContain("admission");
    expect(dialog().queryByRole("button", { name: "Add a line" })).toBeNull();
  });

  it("offers deposit separately only on a check", async () => {
    const { user } = open({ canMark: true });
    expect(dialog().queryByRole("checkbox", { name: "Deposit separately" })).toBeNull();
    await user.click(dialog().getByRole("radio", { name: "Check" }));
    expect(dialog().getByRole("checkbox", { name: "Deposit separately" })).toBeInTheDocument();
  });
});

describe("Add a sale — a check", () => {
  it("offers admission only once Check is chosen, with an optional How many?", async () => {
    const { user } = open();
    await user.click(dialog().getByRole("radio", { name: "Check" }));
    expect(categories(1)).toContain("admission");
  });

  it("records a check against its payer, a line for each thing it pays for", async () => {
    const { calls, onSaved, user } = open();
    await user.click(dialog().getByRole("radio", { name: "Check" }));
    await pickPayer(user);
    await user.selectOptions(line(1).getByLabelText("What was sold"), "admission");
    await user.type(line(1).getByLabelText("Amount"), "30");
    await user.type(line(1).getByLabelText("How many?"), "2");

    await user.click(dialog().getByRole("button", { name: "Add a line" }));
    await user.selectOptions(line(2).getByLabelText("What was sold"), "merchandise");
    await user.type(line(2).getByLabelText("Amount"), "25");
    await user.type(line(2).getByLabelText("Note"), "T-shirt, L");

    await user.click(dialog().getByRole("button", { name: "Add a line" }));
    await user.selectOptions(line(3).getByLabelText("What was sold"), "donation");
    await user.type(line(3).getByLabelText("Amount"), "40");

    expect(dialog().getByText("Check total $95.00")).toBeInTheDocument();
    await user.type(dialog().getByLabelText("Note on the check"), "covers Jo too");
    await record(user);

    await waitFor(() => expect(writesTo(calls, "POST", CHECKS)).toHaveLength(1));
    expect(writesTo(calls, "POST", CHECKS)[0]!.body).toEqual({
      writerContactId: "c-chuck",
      note: "covers Jo too",
      lines: [
        { category: "admission", amount: 30, quantity: 2 },
        { category: "merchandise", amount: 25, note: "T-shirt, L" },
        // A named line is the payer's unless Mary says otherwise.
        { category: "donation", amount: 40, contactId: "c-chuck" },
      ],
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("records admission with no count — How many? is optional", async () => {
    const { calls, user } = open();
    await user.click(dialog().getByRole("radio", { name: "Check" }));
    await pickPayer(user);
    await user.selectOptions(line(1).getByLabelText("What was sold"), "admission");
    await user.type(line(1).getByLabelText("Amount"), "30");
    await record(user);
    await waitFor(() => expect(writesTo(calls, "POST", CHECKS)).toHaveLength(1));
    expect(writesTo(calls, "POST", CHECKS)[0]!.body).toMatchObject({
      lines: [{ category: "admission", amount: 30 }],
    });
  });

  it("takes no check number (FR-014)", async () => {
    const { user } = open();
    await user.click(dialog().getByRole("radio", { name: "Check" }));
    expect(dialog().queryByLabelText(/check number/i)).toBeNull();
  });

  it("names someone else on a donation line — whose donation it is", async () => {
    const { calls, user } = open();
    await user.click(dialog().getByRole("radio", { name: "Check" }));
    await pickPayer(user);
    await user.selectOptions(line(1).getByLabelText("What was sold"), "donation");
    await user.type(line(1).getByLabelText("Amount"), "40");
    await user.click(line(1).getByRole("button", { name: "Someone else" }));
    await user.type(line(1).getByLabelText("For"), "Dee");
    await user.click(await line(1).findByRole("button", { name: "Dee Member" }));
    await record(user);

    await waitFor(() => expect(writesTo(calls, "POST", CHECKS)).toHaveLength(1));
    expect(writesTo(calls, "POST", CHECKS)[0]!.body).toMatchObject({
      lines: [{ category: "donation", amount: 40, contactId: "c-dee" }],
    });
  });

  // The quickstart walk (§3.3): a membership is always the payer's, and the payer is in it. Anyone else it
  // covers is added as a member — Rachel and Finn, when Will pays.
  it("keeps the payer in a membership and adds the members named", async () => {
    const { calls, user } = open();
    await user.click(dialog().getByRole("radio", { name: "Check" }));
    await pickPayer(user);
    await user.selectOptions(line(1).getByLabelText("What was sold"), "membership");
    await user.selectOptions(line(1).getByLabelText("Level"), "family");
    await user.type(line(1).getByLabelText("Amount"), "60");
    expect(line(1).getByText(/Members:/)).toHaveTextContent("Members: Chuck Writer");
    expect(line(1).queryByRole("button", { name: "Someone else" })).toBeNull();

    await user.click(line(1).getByRole("button", { name: "Add a member" }));
    await user.type(line(1).getByLabelText("Member"), "Dee");
    await user.click(await line(1).findByRole("button", { name: "Dee Member" }));
    expect(line(1).getByText(/Members:/)).toHaveTextContent("Members: Chuck Writer, Dee Member");
    await record(user);

    await waitFor(() => expect(writesTo(calls, "POST", CHECKS)).toHaveLength(1));
    expect(writesTo(calls, "POST", CHECKS)[0]!.body).toMatchObject({
      lines: [
        {
          category: "membership",
          amount: 60,
          contactId: "c-chuck",
          membershipLevel: "family",
          memberContactIds: ["c-dee"],
        },
      ],
    });
  });

  it("takes a member off again before recording", async () => {
    const { user } = open();
    await pickPayer(user);
    await user.selectOptions(line(1).getByLabelText("What was sold"), "membership");
    await user.click(line(1).getByRole("button", { name: "Add a member" }));
    await user.type(line(1).getByLabelText("Member"), "Dee");
    await user.click(await line(1).findByRole("button", { name: "Dee Member" }));
    await user.click(line(1).getByRole("button", { name: "Remove Dee Member" }));
    expect(line(1).getByText(/Members:/)).toHaveTextContent("Members: Chuck Writer");
  });

  it("says an individual membership covers the payer alone", async () => {
    const { calls, user } = open();
    await pickPayer(user);
    await user.selectOptions(line(1).getByLabelText("What was sold"), "membership");
    await user.selectOptions(line(1).getByLabelText("Level"), "individual");
    await user.type(line(1).getByLabelText("Amount"), "30");
    await user.click(line(1).getByRole("button", { name: "Add a member" }));
    await user.type(line(1).getByLabelText("Member"), "Dee");
    await user.click(await line(1).findByRole("button", { name: "Dee Member" }));
    await record(user);
    expect(dialog().getByRole("alert")).toHaveTextContent(
      "An individual membership covers the payer alone",
    );
    expect(writesTo(calls, "POST", SALES)).toHaveLength(0);
  });

  it("adds a payer who is not a contact yet, then records the check against them (FR-015)", async () => {
    const { calls, user } = open();
    await user.click(dialog().getByRole("radio", { name: "Check" }));
    await user.type(dialog().getByLabelText("Payer"), "Newt Payer");
    await user.click(
      await dialog().findByRole("button", { name: "Add Newt Payer as a new contact" }),
    );
    expect(dialog().getByLabelText("First name")).toHaveValue("Newt");
    expect(dialog().getByLabelText("Last name")).toHaveValue("Payer");
    await user.click(dialog().getByRole("button", { name: "Add contact" }));

    await waitFor(() => expect(writesTo(calls, "POST", "/api/contacts")).toHaveLength(1));
    await user.selectOptions(line(1).getByLabelText("What was sold"), "admission");
    await user.type(line(1).getByLabelText("Amount"), "15");
    await record(user);
    await waitFor(() => expect(writesTo(calls, "POST", CHECKS)).toHaveLength(1));
    expect(writesTo(calls, "POST", CHECKS)[0]!.body).toMatchObject({ writerContactId: "c-new" });
  });

  it("never records a check without a payer", async () => {
    const { calls, user } = open();
    await user.click(dialog().getByRole("radio", { name: "Check" }));
    await user.selectOptions(line(1).getByLabelText("What was sold"), "admission");
    await user.type(line(1).getByLabelText("Amount"), "15");
    await record(user);
    expect(dialog().getByRole("alert")).toHaveTextContent("Who is the payer?");
    expect(writesTo(calls, "POST", CHECKS)).toHaveLength(0);
  });

  it("refuses a check that pays for nothing (FR-017)", async () => {
    const { calls, user } = open();
    await user.click(dialog().getByRole("radio", { name: "Check" }));
    await pickPayer(user);
    await record(user);
    expect(dialog().getByRole("alert")).toHaveTextContent("A check needs at least one line");
    expect(writesTo(calls, "POST", CHECKS)).toHaveLength(0);
  });

  it("removes a line, and the total follows", async () => {
    const { user } = open();
    await user.click(dialog().getByRole("radio", { name: "Check" }));
    await user.type(line(1).getByLabelText("Amount"), "30");
    await user.click(dialog().getByRole("button", { name: "Add a line" }));
    await user.type(line(2).getByLabelText("Amount"), "25");
    expect(dialog().getByText("Check total $55.00")).toBeInTheDocument();
    await user.click(line(2).getByRole("button", { name: "Remove line" }));
    expect(dialog().getByText("Check total $30.00")).toBeInTheDocument();
    // The one line left cannot be removed — a check pays for something.
    expect(line(1).queryByRole("button", { name: "Remove line" })).toBeNull();
  });

  it("shows the server's refusal in the dialog", async () => {
    const { user } = open({
      writes: {
        [`POST ${CHECKS}`]: {
          status: 422,
          body: { error: { code: "NOT_FOUND", message: "That payer is not a contact." } },
        },
      },
    });
    await user.click(dialog().getByRole("radio", { name: "Check" }));
    await pickPayer(user);
    await user.selectOptions(line(1).getByLabelText("What was sold"), "merchandise");
    await user.type(line(1).getByLabelText("Amount"), "25");
    await record(user);
    await waitFor(() =>
      expect(dialog().getByRole("alert")).toHaveTextContent("That payer is not a contact."),
    );
  });

  it("marks a check to deposit separately, for whoever may record gate money (FR-021)", async () => {
    const { calls, user } = open({ canMark: true });
    await user.click(dialog().getByRole("radio", { name: "Check" }));
    await pickPayer(user);
    await user.selectOptions(line(1).getByLabelText("What was sold"), "donation");
    await user.type(line(1).getByLabelText("Amount"), "500");
    await user.click(dialog().getByRole("checkbox", { name: "Deposit separately" }));
    await record(user);
    await waitFor(() => expect(writesTo(calls, "POST", CHECKS)).toHaveLength(1));
    expect(writesTo(calls, "POST", CHECKS)[0]!.body).toMatchObject({ depositSeparately: true });
  });

  it("hides deposit separately from the door", async () => {
    const { user } = open({ canMark: false });
    await user.click(dialog().getByRole("radio", { name: "Check" }));
    expect(dialog().queryByRole("checkbox", { name: "Deposit separately" })).toBeNull();
  });
});

describe("correcting a sale or a check", () => {
  it("corrects a sale on its own, keeping what it was and that it was not a check", async () => {
    const { calls, user } = open({
      editing: {
        id: "s-dee",
        category: "future_event",
        paymentMethod: "cash",
        amount: 15,
        contactId: "c-dee",
        contactName: "Dee Member",
        membershipLevel: null,
        quantity: null,
        note: "for Jo",
      },
    });
    expect(screen.getByRole("dialog", { name: "Correct a sale" })).toBeInTheDocument();
    expect(line(1).getByLabelText("What was sold")).toBeDisabled();
    expect(dialog().getByRole("radio", { name: "Check" })).toBeDisabled();
    const note = line(1).getByLabelText("Note");
    await user.clear(note);
    await user.type(note, "for Jo's ticket in March");
    await user.click(dialog().getByRole("radio", { name: "Card" }));
    await record(user);

    await waitFor(() => expect(writesTo(calls, "PATCH", "/api/gate-sales/s-dee")).toHaveLength(1));
    expect(writesTo(calls, "PATCH", "/api/gate-sales/s-dee")[0]!.body).toEqual({
      amount: 15,
      paymentMethod: "card",
      contactId: "c-dee",
      quantity: null,
      note: "for Jo's ticket in March",
    });
  });

  it("corrects a check as a check", async () => {
    const { calls, user } = open({
      editing: {
        id: "k1",
        writerContactId: "c-chuck",
        writer: "Chuck Writer",
        note: null,
        depositSeparately: false,
        lines: [
          {
            category: "admission",
            amount: 30,
            contactId: null,
            contactName: null,
            membershipLevel: null,
            quantity: 2,
            note: null,
          },
        ],
      },
    });
    expect(dialog().getByRole("radio", { name: "Check" })).toBeChecked();
    expect(dialog().getByRole("radio", { name: "Cash" })).toBeDisabled();
    await user.clear(line(1).getByLabelText("Amount"));
    await user.type(line(1).getByLabelText("Amount"), "45");
    await record(user);
    await waitFor(() => expect(writesTo(calls, "PATCH", "/api/gate-checks/k1")).toHaveLength(1));
    expect(writesTo(calls, "PATCH", "/api/gate-checks/k1")[0]!.body).toEqual({
      writerContactId: "c-chuck",
      note: null,
      depositSeparately: false,
      lines: [{ category: "admission", amount: 45, quantity: 2 }],
    });
  });
});
