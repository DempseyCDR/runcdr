// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CheckinPage from "@/app/(door)/checkin/page";
import { DOOR_RECORD, EVENT, SALE, CHECK } from "./fixtures/gatePage";
import { SERIES } from "./fixtures/paymentsPage";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; method: string; body: unknown };
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

/** The door's own sale, someone else's, and the door's own check. */
const MINE = SALE({
  id: "s-mine",
  category: "membership",
  paymentMethod: "cash",
  amount: 25,
  contactId: "c-dee",
  contactName: "Dee Member",
  membershipLevel: "individual",
  recordedBy: { contactId: "c-meg", displayName: "Meg Door" },
});
const THEIRS = SALE({
  id: "s-theirs",
  category: "donation",
  paymentMethod: "cash",
  amount: 10,
  contactId: "c-jo",
  contactName: "Jo Friend",
  recordedBy: { contactId: "c-mary", displayName: "Mary FS" },
});

function stub(opts: { gateSales?: unknown[]; checks?: unknown[] } = {}): Call[] {
  const calls: Call[] = [];
  const payload = {
    // The door gets no card fee (feature 002 FR-007); the page must show no money either way.
    doorRecord: { ...DOOR_RECORD(), cardFee: undefined },
    gateSales: opts.gateSales ?? [],
    checks: opts.checks ?? [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.startsWith("/api/me/capabilities"))
        return json({ contactId: "c-meg", gateWrite: false, attendanceWrite: true });
      if (u.endsWith("/api/events/e1/door-record") && method === "POST") return json(payload);
      if (u.endsWith("/api/door-records/dr1") && method === "GET") return json(payload);
      if (u.endsWith("/api/door-records/dr1/sales") && method === "POST")
        return json({ id: "s-new", enrolled: [] }, 201);
      if (u.includes("/api/attendance/search"))
        return json({
          items: [{ id: "c-dee", displayName: "Dee Member", firstName: "Dee", lastName: "Member" }],
        });
      if (u.includes("/attendance-breakdown")) return json({});
      if (/\/api\/events\/[^/]+\/attendance/.test(u)) return json({ count: 0, attendees: [] });
      if (u.includes("/api/events")) return json({ items: [EVENT] });
      if (u.includes("/api/series")) return json({ items: SERIES });
      return json({ items: [] });
    }),
  );
  return calls;
}

async function open(opts: Parameters<typeof stub>[0] = {}) {
  const calls = stub(opts);
  const user = userEvent.setup();
  render(<CheckinPage />);
  // The button waits for the evening to be chosen (the selector picks today's by default).
  const button = await screen.findByRole("button", { name: "Add a sale" });
  await waitFor(() => expect(button).toBeEnabled());
  return { calls, user };
}

/** Feature 082 US4 (FR-024–FR-027): the door records a sale or a check as it is handed over. */
describe("the check-in page — a sale or check at the door (082 US4)", () => {
  it("opens the shared Add a sale dialog", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Add a sale" }));
    // The evening's record is opened first, so the dialog follows a moment later.
    const dialog = within(await screen.findByRole("dialog", { name: "Add a sale" }));
    for (const way of ["Cash", "Check", "Card"]) {
      expect(dialog.getByRole("radio", { name: way })).toBeInTheDocument();
    }
  });

  it("records a sale at once, on its own (FR-026)", async () => {
    const { calls, user } = await open();
    await user.click(screen.getByRole("button", { name: "Add a sale" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Add a sale" }));
    await user.type(dialog.getByLabelText("Payer"), "Dee");
    await user.click(await dialog.findByRole("button", { name: "Dee Member" }));
    await user.selectOptions(dialog.getByLabelText("What was sold"), "membership");
    await user.selectOptions(dialog.getByLabelText("Level"), "individual");
    await user.type(dialog.getByLabelText("Amount"), "25");
    await user.type(dialog.getByLabelText("Note"), "renewed at the door");
    await user.click(dialog.getByRole("button", { name: "Record" }));

    await waitFor(() =>
      expect(
        calls.filter((c) => c.method === "POST" && c.url.endsWith("/api/door-records/dr1/sales")),
      ).toHaveLength(1),
    );
    expect(calls.find((c) => c.url.endsWith("/api/door-records/dr1/sales"))!.body).toEqual({
      category: "membership",
      paymentMethod: "cash",
      amount: 25,
      contactId: "c-dee",
      membershipLevel: "individual",
      note: "renewed at the door",
    });
    await screen.findByText("Recorded.");
  });

  it("gives the door no deposit-separately mark on a check (FR-021)", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("button", { name: "Add a sale" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Add a sale" }));
    await user.click(dialog.getByRole("radio", { name: "Check" }));
    expect(dialog.queryByRole("checkbox", { name: "Deposit separately" })).toBeNull();
  });

  it("shows the door none of the evening's money (FR-027, feature 002 SC-003)", async () => {
    await open();
    for (const text of [/gross cash/i, /card fee/i, /deposit/i, /admission by/i]) {
      expect(screen.queryByText(text)).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("lists what the door recorded tonight, to correct it — and nobody else's (FR-027)", async () => {
    const { user } = await open({
      gateSales: [
        MINE,
        THEIRS,
        // Research R16: an anonymous sale is a sale like any other — the door's own is the door's to correct.
        SALE({
          id: "s-anon",
          category: "merchandise",
          paymentMethod: "cash",
          amount: 75,
          quantity: 3,
          recordedBy: { contactId: "c-meg", displayName: "Meg Door" },
        }),
      ],
      checks: [
        CHECK({
          id: "k-mine",
          writer: "Chuck Writer",
          amount: 30,
          recordedBy: { contactId: "c-meg", displayName: "Meg Door" },
          lines: [
            SALE({
              id: "l1",
              category: "admission",
              paymentMethod: "check",
              amount: 30,
              quantity: 2,
            }),
          ],
        }),
      ],
    });
    await user.click(screen.getByRole("button", { name: "Your sales and checks tonight" }));
    const mine = within(await screen.findByRole("list", { name: "Recorded by you tonight" }));
    expect(mine.getByRole("listitem", { name: "Dee Member" })).toBeInTheDocument();
    expect(mine.getByRole("listitem", { name: "Merchandise" })).toHaveTextContent(
      "Merchandise · $75.00 cash · qty 3",
    );
    expect(mine.getByRole("listitem", { name: "Check from Chuck Writer" })).toBeInTheDocument();
    expect(mine.queryByRole("listitem", { name: "Jo Friend" })).toBeNull();
    expect(mine.getAllByRole("listitem")).toHaveLength(3);

    await user.click(
      within(mine.getByRole("listitem", { name: "Dee Member" })).getByRole("button", {
        name: "Edit",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Correct a sale" })).toBeInTheDocument();
  });
});
