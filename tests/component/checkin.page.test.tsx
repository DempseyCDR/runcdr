// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CheckinPage from "@/app/(door)/checkin/page";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; init?: RequestInit };
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

/** The device's local date, as the page computes "today". */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const EVENT = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  eventDate: today(),
  seriesId: "s-tnc",
  startTime: "19:30:00",
  label: null,
  ...over,
});
const SERIES = [
  { id: "s-tnc", key: "tnc", name: "Thursday Night Contra" },
  { id: "s-cd", key: "community_dance", name: "Community Dance" },
];
const RESULT = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  displayName: "DJ",
  firstName: "David",
  lastName: "Jones",
  displayNameOverride: "DJ",
  membershipStatus: "current",
  checkedIn: false,
  emails: ["dj@example.com"],
  reachedVia: null,
  ...over,
});

type Opts = {
  events?: unknown[];
  results?: unknown[];
  truncated?: boolean;
  post?: () => { body: unknown; status: number };
};

function stub(opts: Opts = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.startsWith("/api/events") && init?.method === "POST") {
        const r = opts.post?.() ?? { body: { id: "a1" }, status: 201 };
        return json(r.body, r.status);
      }
      if (u.includes("/api/attendance/search"))
        return json({ items: opts.results ?? [RESULT()], truncated: opts.truncated ?? false });
      if (u.includes("/attendance-breakdown")) return json({});
      if (/\/api\/events\/[^/]+\/attendance/.test(u)) return json({ count: 0, attendees: [] });
      if (u.includes("/api/events")) return json({ items: opts.events ?? [EVENT()] });
      if (u.includes("/api/series")) return json({ items: SERIES });
      return json({ items: [] });
    }),
  );
  return calls;
}

const posts = (calls: Call[]) =>
  calls
    .filter((c) => c.init?.method === "POST" && /\/api\/events\/[^/]+\/attendance$/.test(c.url))
    .map((c) => JSON.parse(String(c.init!.body)));

const searchBox = () => screen.findByRole("searchbox", { name: /search/i });
/** The confirmed event's heading — not the selector's options, which repeat the same dates and names. */
const eventHeading = (name: RegExp) => screen.findByRole("heading", { name });
const extras = () => screen.getByRole("group", { name: /extras/i });

async function searchFor(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(await searchBox(), text);
  return screen.findByRole("list", { name: /search results/i });
}

/**
 * Feature 079, User Story 1 (FR-001–FR-012): the check-in page, rebuilt for a phone. Everything Meg needs for
 * the common dancer sits in one compact region above the results.
 */
describe("the check-in page (079)", () => {
  it("lays out the event, search, extras, anonymous check-in and the two dialogs above the results", async () => {
    stub();
    const user = userEvent.setup();
    render(<CheckinPage />);
    const box = await searchBox();
    await waitFor(() => expect(document.activeElement).toBe(box));
    const results = await searchFor(user, "da");

    const order = [
      screen.getByRole("region", { name: /event/i }),
      box,
      extras(),
      screen.getByRole("button", { name: /check in anonymously/i }),
      screen.getByRole("button", { name: /add contact/i }),
      screen.getByRole("button", { name: /show checked in/i }),
      results,
    ];
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
        `element ${i} is out of order`,
      ).toBeTruthy();
    }
  });

  it("confirms the event, and warns only when it is not today's (FR-003)", async () => {
    stub();
    render(<CheckinPage />);
    const heading = await eventHeading(/Thursday Night Contra/);
    expect(heading).toHaveTextContent(today());
    expect(heading).toHaveTextContent("19:30");
    const event = screen.getByRole("region", { name: /event/i });
    expect(within(event).getByRole("button", { name: /change/i })).toBeInTheDocument();
    expect(within(event).queryByText(/not today/i)).toBeNull();
  });

  it("warns when the confirmed event is on another date", async () => {
    stub({ events: [EVENT({ eventDate: "2020-01-15" })] });
    render(<CheckinPage />);
    const event = await screen.findByRole("region", { name: /event/i });
    expect(await within(event).findByText(/not today/i)).toBeInTheDocument();
  });

  it("shows results by the name rule, with addresses or who they are reached through", async () => {
    stub({
      results: [
        RESULT(),
        RESULT({
          id: "c2",
          displayName: "Sam Jones",
          firstName: "Sam",
          displayNameOverride: null,
          emails: [],
          reachedVia: { ownerDisplayName: "Ann Jones", address: "jones@example.com" },
        }),
      ],
    });
    const user = userEvent.setup();
    render(<CheckinPage />);
    const results = await searchFor(user, "jones");
    const [dj, sam] = within(results).getAllByRole("listitem");
    expect(within(dj!).getByText("DJ")).toBeInTheDocument();
    expect(within(dj!).getByText("David Jones")).toBeInTheDocument();
    expect(within(dj!).getByText(/dj@example\.com/)).toBeInTheDocument();
    expect(within(sam!).getByText(/reached via Ann Jones/i)).toBeInTheDocument();
  });

  it("marks an already-checked-in dancer with a checkmark and no Check in (FR-007)", async () => {
    stub({ results: [RESULT({ checkedIn: true })] });
    const user = userEvent.setup();
    render(<CheckinPage />);
    const results = await searchFor(user, "dj");
    const [dj] = within(results).getAllByRole("listitem");
    expect(within(dj!).getByLabelText(/already checked in/i)).toBeInTheDocument();
    expect(within(dj!).queryByRole("button", { name: /check in/i })).toBeNull();
  });

  it("sends the extras row with the check-in, then resets it and returns to search (FR-009, FR-011)", async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<CheckinPage />);
    const results = await searchFor(user, "dj");
    await user.type(within(extras()).getByLabelText(/children/i), "2");
    await user.click(within(extras()).getByLabelText(/comp/i));
    await user.click(within(results).getByRole("button", { name: /check in/i }));

    await waitFor(() =>
      expect(posts(calls)).toEqual([{ contactId: "c1", childrenCount: 2, isComp: true }]),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/DJ/);
    await waitFor(() => expect(within(extras()).getByLabelText(/children/i)).toHaveValue(null));
    expect(within(extras()).getByLabelText(/comp/i)).not.toBeChecked();
    expect(await searchBox()).toHaveValue("");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("searchbox")));
  });

  it("keeps the extras row, and shows why, when a check-in is refused", async () => {
    stub({
      post: () => ({
        body: { error: { code: "ALREADY_CHECKED_IN", message: "Already checked in." } },
        status: 409,
      }),
    });
    const user = userEvent.setup();
    render(<CheckinPage />);
    const results = await searchFor(user, "dj");
    await user.click(within(extras()).getByLabelText(/gift card/i));
    await user.click(within(results).getByRole("button", { name: /check in/i }));

    expect(await screen.findByText(/already checked in\./i)).toBeInTheDocument();
    expect(within(extras()).getByLabelText(/gift card/i)).toBeChecked();
  });

  it("offers open band only at a community dance", async () => {
    stub();
    const { unmount } = render(<CheckinPage />);
    await eventHeading(/Thursday Night Contra/);
    expect(within(extras()).queryByLabelText(/open band/i)).toBeNull();
    unmount();

    stub({ events: [EVENT({ seriesId: "s-cd" })] });
    render(<CheckinPage />);
    await eventHeading(/Community Dance/);
    expect(within(extras()).getByLabelText(/open band/i)).toBeInTheDocument();
  });

  it("checks in the top result on Enter, unless it is already in (FR-010)", async () => {
    const calls = stub({ results: [RESULT(), RESULT({ id: "c2", displayName: "Dee" })] });
    const user = userEvent.setup();
    render(<CheckinPage />);
    await searchFor(user, "d");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(posts(calls)).toEqual([{ contactId: "c1" }]));
  });

  it("does nothing on Enter when the top result is already checked in, or there are none", async () => {
    const calls = stub({ results: [RESULT({ checkedIn: true })] });
    const user = userEvent.setup();
    render(<CheckinPage />);
    await searchFor(user, "dj");
    await user.keyboard("{Enter}");
    await new Promise((r) => setTimeout(r, 50));
    expect(posts(calls)).toEqual([]);
  });

  it("checks in anonymously with the extras row, and not while open band is ticked (FR-012)", async () => {
    const calls = stub({ events: [EVENT({ seriesId: "s-cd" })] });
    const user = userEvent.setup();
    render(<CheckinPage />);
    await eventHeading(/Community Dance/);
    const anon = screen.getByRole("button", { name: /check in anonymously/i });

    await user.click(within(extras()).getByLabelText(/open band/i));
    expect(anon).toBeDisabled();
    await user.click(within(extras()).getByLabelText(/open band/i));

    await user.type(within(extras()).getByLabelText(/children/i), "1");
    await user.click(within(extras()).getByLabelText(/gift card/i));
    await user.click(anon);
    await waitFor(() =>
      expect(posts(calls)).toEqual([{ unmatched: true, childrenCount: 1, redeemedGiftCard: true }]),
    );
  });

  it("records nothing until an event is chosen", async () => {
    const calls = stub({ events: [] });
    const user = userEvent.setup();
    render(<CheckinPage />);
    const event = await screen.findByRole("region", { name: /event/i });
    expect(within(event).getByRole("button", { name: /change/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /check in anonymously/i }));
    await user.type(await searchBox(), "dj{Enter}");
    await new Promise((r) => setTimeout(r, 50));
    expect(posts(calls)).toEqual([]);
  });

  it("says when more matched than are shown", async () => {
    stub({ truncated: true });
    const user = userEvent.setup();
    render(<CheckinPage />);
    await searchFor(user, "d");
    expect(await screen.findByText(/more match/i)).toBeInTheDocument();
  });
});
