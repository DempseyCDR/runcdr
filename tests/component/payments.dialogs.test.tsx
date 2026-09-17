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

const LEAD = BOOKING({
  id: "b-lead",
  performerName: "Lena Lead",
  performerType: "lead_musician",
  payCents: 10000,
});
const SIDE = BOOKING({ id: "b-side", performerName: "Sid Side", payCents: 8000 });
const CALL = BOOKING({
  id: "b-call",
  performerName: "Cal Caller",
  performerType: "caller",
  payCents: 12000,
});

type User = ReturnType<typeof userEvent.setup>;

async function open(opts: StubOpts = {}) {
  const calls = stubPayments({ bookings: [LEAD, SIDE, CALL], ...opts });
  const user = userEvent.setup();
  render(<PaymentsPage />);
  await screen.findByRole("listitem", { name: "Lena Lead" });
  return { calls, user };
}

async function openDialog(user: User, button: string, name = button) {
  await user.click(screen.getByRole("button", { name: button }));
  return screen.findByRole("dialog", { name });
}

/** Feature 081 US2 (FR-032): one check for several performers — never cash. */
describe("several performers", () => {
  it("records one check, with a number, for the ticked bookings at their amounts", async () => {
    const { calls, user } = await open();
    const dialog = await openDialog(user, "One check, several performers");
    const d = within(dialog);
    expect(d.queryByRole("radio", { name: "Cash" })).toBeNull();

    await user.selectOptions(d.getByLabelText("Payee"), "p-b-lead");
    await user.click(d.getByRole("checkbox", { name: /Lena Lead/ }));
    await user.click(d.getByRole("checkbox", { name: /Sid Side/ }));
    await user.clear(d.getByLabelText("Amount for Sid Side"));
    await user.type(d.getByLabelText("Amount for Sid Side"), "70");

    await user.click(d.getByRole("button", { name: "Record check" }));
    expect(d.getByRole("alert")).toHaveTextContent("Enter the check number.");
    expect(writesTo(calls, "POST", "/api/performer-payments")).toHaveLength(0);

    await user.type(d.getByLabelText("Check number"), "9100");
    await user.click(d.getByRole("button", { name: "Record check" }));
    await waitFor(() => expect(writesTo(calls, "POST", "/api/performer-payments")).toHaveLength(1));
    expect(writesTo(calls, "POST", "/api/performer-payments")[0]!.body).toEqual({
      eventId: "e1",
      payeePerformerId: "p-b-lead",
      method: "check",
      checkNumber: "9100",
      lines: [
        { bookingId: "b-lead", amount: 100 },
        { bookingId: "b-side", amount: 70 },
      ],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks the same questions when the number is taken or the payee already paid", async () => {
    const { user } = await open({
      writes: {
        "POST /api/performer-payments": {
          status: 409,
          body: {
            error: {
              code: "SECOND_PAYMENT_TO_PAYEE",
              message: "Lena Lead already has check #9001 tonight.",
              details: { paymentId: "p1", checkNumber: "9001", method: "check", amount: 100 },
            },
          },
        },
      },
    });
    const dialog = await openDialog(user, "One check, several performers");
    const d = within(dialog);
    await user.selectOptions(d.getByLabelText("Payee"), "p-b-lead");
    await user.click(d.getByRole("checkbox", { name: /Sid Side/ }));
    await user.type(d.getByLabelText("Check number"), "9101");
    await user.click(d.getByRole("button", { name: "Record check" }));
    expect(await screen.findByRole("dialog", { name: "Pay again?" })).toBeInTheDocument();
  });
});

/** Feature 081 US3 (FR-015): correcting a check, whatever it settles. */
describe("edit", () => {
  const TWO = PAYMENT({
    id: "pay1",
    payee: "Lena Lead",
    payeePerformerId: "p-b-lead",
    checkNumber: "9001",
    amount: 180,
    lines: [
      LINE("b-lead", 100, { performer: "Lena Lead" }),
      LINE("b-side", 80, { performer: "Sid Side" }),
    ],
  });

  it("changes the number, payee and lines, and saves them together", async () => {
    const { calls, user } = await open({ payments: [TWO] });
    const leadRow = within(screen.getByRole("listitem", { name: "Lena Lead" }));
    const dialog = await (async () => {
      await user.click(leadRow.getByRole("button", { name: "Edit" }));
      return screen.findByRole("dialog", { name: "Edit payment" });
    })();
    const d = within(dialog);

    await user.clear(d.getByLabelText("Check number"));
    await user.type(d.getByLabelText("Check number"), "9001b");
    await user.selectOptions(d.getByLabelText("Payee"), "p-b-side");
    await user.click(d.getByRole("button", { name: "Remove Lena Lead" }));
    await user.selectOptions(d.getByLabelText("Add a booking"), "b-call");
    await user.clear(d.getByLabelText("Amount for Cal Caller"));
    await user.type(d.getByLabelText("Amount for Cal Caller"), "110");
    await user.type(d.getByLabelText("Note"), "split differently");
    await user.click(d.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(writesTo(calls, "PATCH", "/api/performer-payments/pay1")).toHaveLength(1),
    );
    expect(writesTo(calls, "PATCH", "/api/performer-payments/pay1")[0]!.body).toEqual({
      checkNumber: "9001b",
      payeePerformerId: "p-b-side",
      overrideReason: "split differently",
      lines: [
        { bookingId: "b-side", amount: 80 },
        { bookingId: "b-call", amount: 110 },
      ],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks before moving a check to a performer already paid, and saves when told to", async () => {
    const { calls, user } = await open({
      payments: [TWO],
      writes: {
        "PATCH /api/performer-payments/pay1": (body) =>
          (body as { confirmSecondPayment?: boolean }).confirmSecondPayment
            ? { status: 200, body: {} }
            : {
                status: 409,
                body: {
                  error: {
                    code: "SECOND_PAYMENT_TO_PAYEE",
                    message: "Sid Side already has check #9002 tonight.",
                    details: { paymentId: "p2", checkNumber: "9002", method: "check", amount: 80 },
                  },
                },
              },
      },
    });
    await user.click(
      within(screen.getByRole("listitem", { name: "Lena Lead" })).getByRole("button", {
        name: "Edit",
      }),
    );
    const d = within(await screen.findByRole("dialog", { name: "Edit payment" }));
    await user.selectOptions(d.getByLabelText("Payee"), "p-b-side");
    await user.click(d.getByRole("button", { name: "Save" }));
    const again = await screen.findByRole("dialog", { name: "Pay again?" });
    await user.click(within(again).getByRole("button", { name: "Pay again" }));
    await waitFor(() =>
      expect(writesTo(calls, "PATCH", "/api/performer-payments/pay1")).toHaveLength(2),
    );
    expect(writesTo(calls, "PATCH", "/api/performer-payments/pay1")[1]!.body).toMatchObject({
      confirmSecondPayment: true,
    });
    expect(writesTo(calls, "POST", "/api/performer-payments")).toHaveLength(0);
  });

  it("has no Edit for a voided check", async () => {
    await open({
      payments: [{ ...TWO, voided: true, voidReason: "lost" }],
      list: {
        voidedByBooking: {
          "b-lead": [{ paymentId: "pay1", checkNumber: "9001", reason: "lost" }],
        },
      },
    });
    expect(
      within(screen.getByRole("listitem", { name: "Lena Lead" })).queryByRole("button", {
        name: "Edit",
      }),
    ).toBeNull();
  });
});

/** Feature 081 US4 (FR-023, FR-024, FR-026): a last-minute performer, found or created. */
describe("add a performer", () => {
  const ROLES = [
    { performerType: "caller", rate: 120 },
    { performerType: "musician", rate: 75 },
    { performerType: "instructor", rate: 0 },
  ];
  const PERFORMERS = [
    { id: "p-b-side", displayName: "Sid Side", bookedAs: "musician" },
    { id: "p-new", displayName: "Nia Newcomer", bookedAs: null },
  ];

  it("marks who is already booked, and adds another at the role's rate", async () => {
    const { calls, user } = await open({ roles: ROLES, performers: PERFORMERS });
    const d = within(await openDialog(user, "Add a performer"));
    await user.type(d.getByLabelText("Find a performer"), "i");

    const sid = await d.findByRole("listitem", { name: "Sid Side" });
    expect(sid).toHaveTextContent("already booked as musician");
    expect(within(sid).queryByRole("button")).toBeNull();
    expect(calls.some((c) => c.url === "/api/performers?q=i&eventId=e1")).toBe(true);

    await user.click(d.getByRole("button", { name: "Nia Newcomer" }));
    expect(
      within(d.getByLabelText("Role"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["caller", "musician", "instructor"]);
    await user.selectOptions(d.getByLabelText("Role"), "musician");
    expect(d.getByLabelText("Amount")).toHaveValue("75.00");
    await user.click(d.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(writesTo(calls, "POST", "/api/events/e1/settlement-performer")).toHaveLength(1),
    );
    expect(writesTo(calls, "POST", "/api/events/e1/settlement-performer")[0]!.body).toEqual({
      performerId: "p-new",
      performerType: "musician",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sends the pay when Mary changes it, and shows a refusal in the dialog", async () => {
    const { calls, user } = await open({
      roles: ROLES,
      performers: PERFORMERS,
      writes: {
        "POST /api/events/e1/settlement-performer": {
          status: 422,
          body: { error: { code: "SOUND_TECH_NOT_ALLOWED", message: "No sound tech here." } },
        },
      },
    });
    const d = within(await openDialog(user, "Add a performer"));
    await user.type(d.getByLabelText("Find a performer"), "nia");
    await user.click(await d.findByRole("button", { name: "Nia Newcomer" }));
    await user.selectOptions(d.getByLabelText("Role"), "instructor");
    expect(d.getByLabelText("Amount")).toHaveValue("0.00");
    await user.clear(d.getByLabelText("Amount"));
    await user.type(d.getByLabelText("Amount"), "50");
    await user.click(d.getByRole("button", { name: "Add" }));
    expect(await d.findByRole("alert")).toHaveTextContent("No sound tech here.");
    expect(writesTo(calls, "POST", "/api/events/e1/settlement-performer")[0]!.body).toEqual({
      performerId: "p-new",
      performerType: "instructor",
      pay: 50,
    });
  });

  it("creates a performer from an existing contact, then adds them", async () => {
    const { calls, user } = await open({
      roles: ROLES,
      performers: [],
      contacts: [{ id: "c-kim", displayName: "Kim Contact", emails: [], reachedVia: null }],
      writes: {
        "POST /api/performers": { status: 201, body: { id: "p-kim", displayName: "Kim Contact" } },
      },
    });
    const d = within(await openDialog(user, "Add a performer"));
    await user.type(d.getByLabelText("Find a performer"), "kim");
    await user.click(await d.findByRole("button", { name: "Not listed? Create a performer" }));
    await user.type(d.getByLabelText("Find a contact"), "kim");
    await user.click(await d.findByRole("button", { name: "Use Kim Contact" }));
    await waitFor(() => expect(writesTo(calls, "POST", "/api/performers")).toHaveLength(1));
    expect(writesTo(calls, "POST", "/api/performers")[0]!.body).toEqual({ contactId: "c-kim" });

    expect(d.getByText("Kim Contact")).toBeInTheDocument();
    await user.selectOptions(d.getByLabelText("Role"), "caller");
    await user.click(d.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(writesTo(calls, "POST", "/api/events/e1/settlement-performer")).toHaveLength(1),
    );
    expect(writesTo(calls, "POST", "/api/events/e1/settlement-performer")[0]!.body).toMatchObject({
      performerId: "p-kim",
    });
  });

  it("creates a performer and their contact from a new person's name", async () => {
    const { calls, user } = await open({
      roles: ROLES,
      performers: [],
      writes: {
        "POST /api/performers": (_body, n) =>
          n === 1
            ? {
                status: 409,
                body: {
                  error: {
                    code: "EMAIL_ACTIVE_ELSEWHERE",
                    message: "That email belongs to someone else.",
                  },
                },
              }
            : { status: 201, body: { id: "p-bo", displayName: "Bo Banjo" } },
      },
    });
    const d = within(await openDialog(user, "Add a performer"));
    await user.type(d.getByLabelText("Find a performer"), "bo");
    await user.click(await d.findByRole("button", { name: "Not listed? Create a performer" }));
    await user.click(d.getByRole("button", { name: "A new person" }));
    await user.type(d.getByLabelText("First name"), "Bo");
    await user.type(d.getByLabelText("Last name"), "Banjo");
    await user.type(d.getByLabelText("Email"), "bo@example.com");
    await user.click(d.getByRole("button", { name: "Create performer" }));
    expect(await d.findByRole("alert")).toHaveTextContent("That email belongs to someone else.");
    expect(writesTo(calls, "POST", "/api/performers")[0]!.body).toEqual({
      firstName: "Bo",
      lastName: "Banjo",
      email: "bo@example.com",
    });

    await user.clear(d.getByLabelText("Email"));
    await user.click(d.getByRole("button", { name: "Create performer" }));
    await waitFor(() => expect(writesTo(calls, "POST", "/api/performers")).toHaveLength(2));
    expect(writesTo(calls, "POST", "/api/performers")[1]!.body).toEqual({
      firstName: "Bo",
      lastName: "Banjo",
    });
    expect(await d.findByText("Bo Banjo")).toBeInTheDocument();
  });

  it("is not offered to someone who may not record payments", async () => {
    await open({ canWrite: false });
    expect(screen.queryByRole("button", { name: "Add a performer" })).toBeNull();
  });
});

/** Feature 081 US5 (FR-025, FR-026): a substitute steps into the slot at the same booked amount. */
describe("substitute", () => {
  it("shows the slot's booked amount, offers none to change, and substitutes the one found", async () => {
    const { calls, user } = await open({
      performers: [{ id: "p-sub", displayName: "Sue Sub", bookedAs: null }],
    });
    const d = within(await openDialog(user, "Substitute a performer"));
    const slot = d.getByLabelText("Booking to replace");
    expect(
      within(slot)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      "Choose…",
      "Cal Caller (caller) — $120.00",
      "Lena Lead (lead musician) — $100.00",
      "Sid Side (musician) — $80.00",
    ]);
    await user.selectOptions(slot, "b-call");
    expect(
      d.getByText("The substitute takes the same booked amount: $120.00."),
    ).toBeInTheDocument();
    expect(d.queryByLabelText("Amount")).toBeNull();

    await user.type(d.getByLabelText("Find a performer"), "sue");
    await user.click(await d.findByRole("button", { name: "Sue Sub" }));
    await user.click(d.getByRole("button", { name: "Substitute" }));
    await waitFor(() =>
      expect(writesTo(calls, "POST", "/api/bookings/b-call/substitute")).toHaveLength(1),
    );
    expect(writesTo(calls, "POST", "/api/bookings/b-call/substitute")[0]!.body).toEqual({
      newPerformerId: "p-sub",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("can create the substitute first", async () => {
    const { calls, user } = await open({
      performers: [],
      writes: {
        "POST /api/performers": { status: 201, body: { id: "p-new", displayName: "Nat New" } },
      },
    });
    const d = within(await openDialog(user, "Substitute a performer"));
    await user.selectOptions(d.getByLabelText("Booking to replace"), "b-side");
    await user.type(d.getByLabelText("Find a performer"), "nat");
    await user.click(await d.findByRole("button", { name: "Not listed? Create a performer" }));
    await user.click(d.getByRole("button", { name: "A new person" }));
    await user.type(d.getByLabelText("First name"), "Nat");
    await user.click(d.getByRole("button", { name: "Create performer" }));
    await user.click(await d.findByRole("button", { name: "Substitute" }));
    await waitFor(() =>
      expect(writesTo(calls, "POST", "/api/bookings/b-side/substitute")).toHaveLength(1),
    );
    expect(writesTo(calls, "POST", "/api/bookings/b-side/substitute")[0]!.body).toEqual({
      newPerformerId: "p-new",
    });
  });
});

/** Feature 081 US7 (FR-035–FR-037): paying tonight for an earlier evening's booking. */
describe("earlier booking", () => {
  const UNPAID = [
    {
      bookingId: "b-old",
      eventId: "e0",
      eventDate: "2026-06-04",
      performerType: "musician",
      booked: 90,
    },
  ];

  it("finds the performer, lists their unpaid earlier bookings, and pays one from tonight", async () => {
    const { calls, user } = await open({
      performers: [{ id: "p-b-side", displayName: "Sid Side", bookedAs: "musician" }],
      unpaid: UNPAID,
    });
    const d = within(await openDialog(user, "Pay an earlier booking"));
    await user.type(d.getByLabelText("Find a performer"), "sid");
    // Booked tonight does not stop paying an older booking; no creating from here.
    await user.click(await d.findByRole("button", { name: "Sid Side" }));
    expect(d.queryByRole("button", { name: /Create a performer/ })).toBeNull();
    expect(
      calls.some((c) => c.url === "/api/performers/p-b-side/unpaid-bookings?forEvent=e1"),
    ).toBe(true);

    await user.click(await d.findByRole("radio", { name: "2026-06-04 · musician · $90.00" }));
    await user.click(d.getByRole("radio", { name: "Cash" }));
    await user.click(d.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(writesTo(calls, "POST", "/api/performer-payments")).toHaveLength(1));
    expect(writesTo(calls, "POST", "/api/performer-payments")[0]!.body).toEqual({
      eventId: "e1",
      payeePerformerId: "p-b-side",
      method: "cash",
      lines: [{ bookingId: "b-old", amount: 90 }],
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Pay an earlier booking" })).toBeNull(),
    );
  });

  it("asks before paying the performer twice tonight", async () => {
    const { user } = await open({
      performers: [{ id: "p-b-side", displayName: "Sid Side" }],
      unpaid: UNPAID,
      writes: {
        "POST /api/performer-payments": {
          status: 409,
          body: {
            error: {
              code: "SECOND_PAYMENT_TO_PAYEE",
              message: "Sid Side already has check #9002 tonight.",
              details: { paymentId: "p2", checkNumber: "9002", method: "check", amount: 80 },
            },
          },
        },
      },
    });
    const d = within(await openDialog(user, "Pay an earlier booking"));
    await user.type(d.getByLabelText("Find a performer"), "sid");
    await user.click(await d.findByRole("button", { name: "Sid Side" }));
    await user.click(await d.findByRole("radio", { name: /2026-06-04/ }));
    await user.type(d.getByLabelText("Check number"), "9010");
    await user.click(d.getByRole("button", { name: "Record" }));
    expect(await screen.findByRole("dialog", { name: "Pay again?" })).toBeInTheDocument();
  });

  it("says when there is nothing unpaid", async () => {
    const { user } = await open({ performers: [{ id: "p-x", displayName: "Xavi" }], unpaid: [] });
    const d = within(await openDialog(user, "Pay an earlier booking"));
    await user.type(d.getByLabelText("Find a performer"), "xa");
    await user.click(await d.findByRole("button", { name: "Xavi" }));
    expect(
      await d.findByText("No unpaid bookings in the 90 days before this event."),
    ).toBeInTheDocument();
  });
});

/** Feature 081 US7 (FR-037): where a booking was paid, on both evenings' pages. */
describe("paid at another event", () => {
  it("shows a booking paid later as Paid at, and tonight's payments for earlier bookings apart", async () => {
    await open({
      payments: [
        PAYMENT({
          id: "pay-old",
          method: "cash",
          checkNumber: null,
          payee: "Olly Old",
          amount: 70,
          lines: [
            LINE("b-old", 70, { eventId: "e0", eventDate: "2026-06-04", performer: "Olly Old" }),
          ],
        }),
      ],
      list: {
        paidElsewhere: {
          "b-side": { eventId: "e9", eventDate: "2026-09-18", paymentId: "p9" },
        },
      },
    });
    const side = within(screen.getByRole("listitem", { name: "Sid Side" }));
    expect(side.getByText("Paid at 2026-09-18")).toBeInTheDocument();
    expect(side.queryByLabelText("Check number")).toBeNull();

    const earlier = within(screen.getByRole("list", { name: "Earlier bookings paid tonight" }));
    expect(earlier.getByText("Olly Old — 2026-06-04 — Cash $70.00")).toBeInTheDocument();
    expect(earlier.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});
