// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GatePage from "@/app/(door)/gate/page";
import { BREAKDOWN } from "./fixtures/attendanceBreakdown";

/**
 * Feature 080 (MARY-R5): a membership sold at the gate records the level bought. The server has required it
 * since 068; these tests pin the page's half — the choice, the send, the guard, and what a refused save says.
 */
type Call = { url: string; init?: RequestInit };
/** A stubbed reply: a status with an optional JSON body (none → the body is not JSON), or a network failure. */
type Reply = { status: number; body?: unknown } | Error;

const CANDIDATES = [
  { id: "c1", displayName: "Jane Doe" },
  { id: "c2", displayName: "Ann Able" },
];
const ENROLLED = [{ contactId: "c1", displayName: "Jane Doe", expiryDate: "2027-08-31" }];

const EMPTY_RECORD = {
  doorRecord: {
    id: "dr1",
    seedFloat: 15,
    compCount: 0,
    giftCardRedemptionCount: 0,
    openBandCount: 0,
    grossCash: 0,
    pcGross: 0,
    posTransactionCount: 0,
    cashPaidOut: 0,
    cashPaidOutReason: null,
  },
  gateSales: [],
};

function respond(reply: Reply) {
  if (reply instanceof Error) throw reply;
  return {
    ok: reply.status < 400,
    status: reply.status,
    json: async () => {
      if (reply.body === undefined) throw new SyntaxError("Unexpected token < in JSON");
      return reply.body;
    },
  };
}

function stub(calls: Call[], over: { put?: Reply; patch?: Reply } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (init?.method === "PUT" && u.includes("/gate-sales")) {
        return respond(over.put ?? { status: 200, body: { enrolled: ENROLLED } });
      }
      if (init?.method === "PATCH" && u.includes("/door-records/")) {
        return respond(over.patch ?? { status: 200, body: { deposit: 0 } });
      }
      if (u.endsWith("/door-record")) return respond({ status: 200, body: EMPTY_RECORD });
      if (u.includes("/attendance-breakdown")) return respond({ status: 200, body: BREAKDOWN() });
      if (u.includes("/api/attendance/search")) {
        const q = (new URL(u, "http://x").searchParams.get("q") ?? "").toLowerCase();
        const items = CANDIDATES.filter((c) => c.displayName.toLowerCase().includes(q));
        return respond({ status: 200, body: { items } });
      }
      if (u.includes("/api/events")) {
        return respond({ status: 200, body: { items: [{ id: "e1", eventDate: "2026-06-25" }] } });
      }
      return respond({ status: 200, body: { items: [] } });
    }),
  );
}

type User = ReturnType<typeof userEvent.setup>;

async function openEvening(user: User) {
  render(<GatePage />);
  await user.selectOptions(await screen.findByRole("combobox", { name: /event/i }), "e1");
  await screen.findByRole("region", { name: /attendance/i });
}

/** Adds a named line through the page's own category + search + add controls; returns the line. */
async function addLine(user: User, category: string, name: string, amount?: string) {
  const categorySelect = screen
    .getAllByRole("combobox")
    .find((s) => within(s).queryByRole("option", { name: "future_event" }))!;
  await user.selectOptions(categorySelect, category);
  const searchBox = screen.getByPlaceholderText("Find contact…");
  await user.clear(searchBox);
  await user.type(searchBox, name);
  const hit = await screen.findByText(new RegExp(`^${name}`));
  await user.click(within(hit.closest("li")!).getByRole("button", { name: "add" }));
  const line = lineFor(category, name);
  if (amount) await user.type(within(line).getByPlaceholderText("amount"), amount);
  return line;
}

const lineFor = (category: string, name: string) =>
  screen.getByText(new RegExp(`^${category} — ${name}`)).closest("li")!;

const levelFor = (name: string) =>
  screen.getByRole("combobox", { name: `Level for ${name}` }) as HTMLSelectElement;

const save = (user: User) => user.click(screen.getByRole("button", { name: /^save$/i }));

const sentSales = (calls: Call[]) => {
  const put = calls.find((c) => c.init?.method === "PUT" && c.url.includes("/gate-sales"));
  return put ? (JSON.parse(put.init!.body as string).sales as Record<string, unknown>[]) : null;
};
const patched = (calls: Call[]) =>
  calls.some((c) => c.init?.method === "PATCH" && c.url.includes("/door-records/"));

describe("GatePage — membership level (080)", () => {
  afterEach(() => vi.unstubAllGlobals());

  describe("US1 — record a membership bought at the gate", () => {
    it("offers a level on a membership line, with nothing chosen (FR-001)", async () => {
      stub([]);
      const user = userEvent.setup();
      await openEvening(user);
      await addLine(user, "membership", "Jane Doe");

      const level = levelFor("Jane Doe");
      expect(
        within(level)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["Level…", "Individual", "Family", "Supporter", "Student"]);
      expect(level.value).toBe("");
    });

    it("offers no level on donation or future-event lines (FR-002)", async () => {
      stub([]);
      const user = userEvent.setup();
      await openEvening(user);
      await addLine(user, "donation", "Jane Doe");
      await addLine(user, "future_event", "Jane Doe");

      expect(screen.queryByRole("combobox", { name: /^Level for/ })).toBeNull();
    });

    it("sends the chosen level on the membership line only, and says the membership was recorded (FR-003, FR-004)", async () => {
      const calls: Call[] = [];
      stub(calls);
      const user = userEvent.setup();
      await openEvening(user);
      await addLine(user, "membership", "Jane Doe", "40");
      await user.selectOptions(levelFor("Jane Doe"), "family");
      await addLine(user, "donation", "Jane Doe", "10");
      await save(user);

      // The renewal itself is covered against a real database by tests/integration/gate.membershipLevel.test.ts.
      expect(
        await screen.findByText("Saved. Membership recorded: Jane Doe (through 2027-08-31)"),
      ).toBeInTheDocument();
      const sales = sentSales(calls)!;
      expect(sales.find((s) => s.category === "membership")).toMatchObject({
        amount: 40,
        contactId: "c1",
        membershipLevel: "family",
      });
      const donation = sales.find((s) => s.category === "donation");
      expect(donation).toMatchObject({ amount: 10, contactId: "c1" });
      expect(donation).not.toHaveProperty("membershipLevel");
    });
  });

  describe("US3 — told when a save does not go through", () => {
    it("sends nothing while a membership line has no level, and names the sale (FR-006)", async () => {
      const calls: Call[] = [];
      stub(calls);
      const user = userEvent.setup();
      await openEvening(user);
      await addLine(user, "membership", "Jane Doe", "40");
      await save(user);

      expect(
        await screen.findByText("Choose a level for Jane Doe's membership. Nothing was saved."),
      ).toBeInTheDocument();
      expect(sentSales(calls)).toBeNull();
      expect(patched(calls)).toBe(false);
      expect(levelFor("Jane Doe")).toHaveAttribute("aria-invalid", "true");

      await user.selectOptions(levelFor("Jane Doe"), "student");
      expect(levelFor("Jane Doe")).not.toHaveAttribute("aria-invalid");
      await save(user);
      await waitFor(() => expect(sentSales(calls)).not.toBeNull());
    });

    it("names every membership that needs a level", async () => {
      stub([]);
      const user = userEvent.setup();
      await openEvening(user);
      await addLine(user, "membership", "Ann Able", "40");
      await addLine(user, "membership", "Jane Doe", "40");
      await save(user);

      expect(
        await screen.findByText(
          "Choose a level for each membership: Ann Able, Jane Doe. Nothing was saved.",
        ),
      ).toBeInTheDocument();
    });

    it("keeps the mark on the right sale when a line above it is removed", async () => {
      stub([]);
      const user = userEvent.setup();
      await openEvening(user);
      await addLine(user, "membership", "Ann Able", "40");
      await user.selectOptions(levelFor("Ann Able"), "family");
      await addLine(user, "membership", "Jane Doe", "40");
      await save(user);

      await waitFor(() => expect(levelFor("Jane Doe")).toHaveAttribute("aria-invalid", "true"));
      expect(levelFor("Ann Able")).not.toHaveAttribute("aria-invalid");

      await user.click(
        within(lineFor("membership", "Ann Able")).getByRole("button", { name: "remove" }),
      );
      expect(screen.queryByRole("combobox", { name: "Level for Ann Able" })).toBeNull();
      expect(levelFor("Jane Doe")).toHaveAttribute("aria-invalid", "true");
    });

    it("does not hold up the save for a membership line with no amount, which is not sent", async () => {
      const calls: Call[] = [];
      stub(calls, { put: { status: 200, body: { enrolled: [] } } });
      const user = userEvent.setup();
      await openEvening(user);
      await addLine(user, "membership", "Jane Doe");
      await save(user);

      expect(await screen.findByText("Saved")).toBeInTheDocument();
      expect(sentSales(calls)).toEqual([]);
    });

    it("says nothing was saved, with the server's reason, when the sales are refused (FR-007, FR-008)", async () => {
      const calls: Call[] = [];
      stub(calls, {
        put: {
          status: 422,
          body: {
            error: {
              code: "VALIDATION_ERROR",
              message: "membership lines require a membershipLevel",
            },
          },
        },
      });
      const user = userEvent.setup();
      await openEvening(user);
      await addLine(user, "membership", "Jane Doe", "40");
      await user.selectOptions(levelFor("Jane Doe"), "family");
      await save(user);

      expect(
        await screen.findByText("Nothing was saved: membership lines require a membershipLevel"),
      ).toBeInTheDocument();
      expect(patched(calls)).toBe(false);
    });

    it("falls back to the status when a refusal has no readable reason", async () => {
      stub([], { put: { status: 500 } });
      const user = userEvent.setup();
      await openEvening(user);
      await save(user);

      expect(
        await screen.findByText("Nothing was saved: the server refused it (500)"),
      ).toBeInTheDocument();
    });

    it("says the sales were saved but the money was not, and names the membership recorded (FR-008)", async () => {
      stub([], {
        patch: {
          status: 422,
          body: { error: { message: "Number must be greater than or equal to 0" } },
        },
      });
      const user = userEvent.setup();
      await openEvening(user);
      await addLine(user, "membership", "Jane Doe", "40");
      await user.selectOptions(levelFor("Jane Doe"), "family");
      await save(user);

      expect(
        await screen.findByText(
          "Sales saved, but the money figures were not: Number must be greater than or equal to 0. " +
            "Membership recorded: Jane Doe (through 2027-08-31)",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Deposit:/)).toBeNull();
    });

    it("reports a sales request that never reaches the server", async () => {
      const calls: Call[] = [];
      stub(calls, { put: new TypeError("Failed to fetch") });
      const user = userEvent.setup();
      await openEvening(user);
      await save(user);

      expect(
        await screen.findByText("Nothing was saved: Could not reach the server"),
      ).toBeInTheDocument();
      expect(patched(calls)).toBe(false);
    });

    it("reports a money request that never reaches the server", async () => {
      stub([], {
        put: { status: 200, body: { enrolled: [] } },
        patch: new TypeError("Failed to fetch"),
      });
      const user = userEvent.setup();
      await openEvening(user);
      await save(user);

      expect(
        await screen.findByText(
          "Sales saved, but the money figures were not: Could not reach the server",
        ),
      ).toBeInTheDocument();
    });

    it("keeps today's message for someone who may not record gate money", async () => {
      stub([], { put: { status: 403, body: { error: { code: "FORBIDDEN", message: "no" } } } });
      const user = userEvent.setup();
      await openEvening(user);
      await save(user);

      expect(
        await screen.findByText(
          "Only the Financial Secretary may record gate money for this event.",
        ),
      ).toBeInTheDocument();
    });

    it("saves an evening with no membership sale exactly as before (SC-004)", async () => {
      stub([], { put: { status: 200, body: { enrolled: [] } } });
      const user = userEvent.setup();
      await openEvening(user);
      await save(user);

      expect(await screen.findByText("Saved")).toBeInTheDocument();
    });
  });
});
