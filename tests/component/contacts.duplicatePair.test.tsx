// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContactsPage from "@/app/(admin)/contacts/page";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; init?: RequestInit };
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

const side = (over: Record<string, unknown> = {}) => ({
  id: "c-a",
  displayName: "Robert Jones",
  firstName: "Robert",
  lastName: "Jones",
  displayNameOverride: null,
  membershipStatus: "current",
  membershipLevel: "family",
  phone: "+15855551234",
  emails: ["rob@example.com"],
  createdAt: "2019-04-02T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
  hasLogin: false,
  hasUnshownAddress: false,
  messageRecipient: null,
  ...over,
});

const PAIR = (over: Record<string, unknown> = {}) => ({
  a: side(),
  b: side({
    id: "c-b",
    displayName: "Rob Jones",
    membershipStatus: "never",
    membershipLevel: null,
    phone: null,
    emails: [],
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  }),
  similarity: 0.64,
  sharedHousehold: { email: false, account: false },
  rejected: null,
  safeToReject: true,
  safeToMerge: true,
  ...over,
});

/**
 * `pairsFor` answers the suggestions endpoint differently depending on `includeRejected`, which is how
 * the queue both hides a rejected pair and reveals it on request (FR-004a).
 */
function stub(pairsFor: (includeRejected: boolean) => unknown[], onReject?: () => void): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push({ url: u, init });
      if (u.includes("/api/contacts/launcher-counts"))
        return json({ needsReview: 0, duplicates: 1 });
      if (u.includes("/api/me/capabilities"))
        return json({ contactWrite: true, contactDelete: false, contactDeleteUnrestricted: false });
      if (u.includes("/api/dedup/rejections")) {
        if (method === "POST") onReject?.();
        return json({ ok: true });
      }
      if (u.includes("/api/dedup/suggestions")) {
        const pairs = pairsFor(u.includes("includeRejected=1")) as { rejected?: unknown }[];
        // The server reports how many the list is hiding, which is what makes the reveal offerable.
        const suppressed = (pairsFor(true) as { rejected?: unknown }[]).filter(
          (p) => p.rejected,
        ).length;
        return json({ pairs, suppressed, truncated: false });
      }
      return json({ items: [] });
    }),
  );
  return calls;
}

const openQueue = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(await screen.findByRole("button", { name: /review duplicates/i }));

/**
 * Feature 076 (069 manual pass). The display name is the header. When it is CUSTOM, the name the pair was
 * actually proposed on — first + last — is shown beneath it, because pairing runs on first + last and a
 * custom display name can hide that entirely. When it is automatic it IS first + last, so nothing is
 * repeated. There is no "(custom)" marker: the line appearing is the signal.
 */
describe("the row's names (076)", () => {
  it("shows first and last name beneath a CUSTOM display name", async () => {
    stub(() => [
      PAIR({
        a: side({
          displayName: "Peggy CDR",
          firstName: "Peggy",
          lastName: "Dempsey",
          displayNameOverride: "Peggy CDR",
        }),
      }),
    ]);
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openQueue(user);

    const row = await screen.findByRole("listitem", { name: /Peggy CDR/i });
    expect(within(row).getByText("Peggy Dempsey")).toBeTruthy();
    expect(within(row).queryByText(/custom/i), "no custom marker is wanted").toBeNull();
  });

  it("shows nothing beneath an automatic display name", async () => {
    stub(() => [PAIR()]);
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openQueue(user);

    const row = await screen.findByRole("listitem", { name: /Robert Jones/i });
    // Only the header carries the name — no second "Robert Jones" line beneath it.
    expect(within(row).getAllByText(/^Robert Jones$/)).toHaveLength(1);
  });

  it("shows just the first name when a custom-named contact has no last name", async () => {
    stub(() => [
      PAIR({
        a: side({
          displayName: "The Fiddler",
          firstName: "Zeke",
          lastName: null,
          displayNameOverride: "The Fiddler",
        }),
      }),
    ]);
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openQueue(user);

    const row = await screen.findByRole("listitem", { name: /The Fiddler/i });
    expect(within(row).getByText(/^Zeke$/)).toBeTruthy();
  });
});

describe("the duplicates worklist row (feature 069, M-R18)", () => {
  it("shows each side's reach, standing and record age, so the decision needs no other screen", async () => {
    stub(() => [PAIR()]);
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openQueue(user);

    const row = await screen.findByRole("listitem", { name: /Robert Jones/i });
    expect(within(row).getByText(/rob@example\.com/)).toBeTruthy();
    expect(within(row).getByText(/555.*1234/)).toBeTruthy();
    expect(within(row).getByText(/family/i)).toBeTruthy();
    // Record age is the common tell: a long-standing record beside one created last week.
    expect(within(row).getAllByText(/2019/).length).toBeGreaterThan(0);
    expect(within(row).getAllByText(/2026/).length).toBeGreaterThan(0);
    // And the side with nothing on it says so rather than rendering a blank.
    expect(within(row).getAllByText(/no email/i).length).toBeGreaterThan(0);
  });

  it("flags a shared household — evidence AGAINST a merge", async () => {
    stub(() => [PAIR({ sharedHousehold: { email: false, account: true } })]);
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openQueue(user);
    expect(await screen.findByText(/same membership account/i)).toBeTruthy();
  });

  it("rejecting posts the rejection and removes the row", async () => {
    let rejected = false;
    const calls = stub(
      (includeRejected) =>
        rejected && !includeRejected ? [] : [PAIR({ rejected: rejected ? REJECTION : null })],
      () => {
        rejected = true;
      },
    );
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openQueue(user);

    await user.click(await screen.findByRole("button", { name: /not duplicates/i }));

    const post = calls.find(
      (c) => c.url.includes("/api/dedup/rejections") && c.init?.method === "POST",
    );
    expect(post).toBeTruthy();
    expect(JSON.parse(String(post!.init!.body))).toEqual({
      contactAId: "c-a",
      contactBId: "c-b",
    });
    await waitFor(() => expect(screen.queryByText("Rob Jones")).toBeNull());
  });

  it("reveals rejected pairs from the queue and undoes one in place (FR-004a)", async () => {
    const calls = stub((includeRejected) =>
      includeRejected ? [PAIR({ rejected: REJECTION })] : [],
    );
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openQueue(user);
    expect(await screen.findByText(/no potential duplicates/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /show rejected/i }));
    expect(await screen.findByText("Rob Jones")).toBeTruthy();
    expect(screen.getByText(/Mel Manager/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/dedup/rejections") && c.init?.method === "DELETE"),
      ).toBe(true),
    );
  });
});

const REJECTION = { at: "2026-09-01T00:00:00.000Z", byDisplayName: "Mel Manager" };

/**
 * Feature 069 (FR-005/FR-006/FR-007). A pair's two answers are OPPOSITES, so the row offers them
 * independently: a conflict between the records blocks MERGING and is an argument FOR rejecting. What
 * must hold in every case is that the underlying records can still be opened.
 */
describe("a pair's actions follow whether the row carries the decision", () => {
  it("offers both answers when the row settles the pair either way", async () => {
    stub(() => [PAIR({ safeToReject: true, safeToMerge: true })]);
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openQueue(user);
    expect(await screen.findByRole("button", { name: /not duplicates/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /keep Robert Jones/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open to resolve/i })).toBeNull();
  });

  it("keeps 'not duplicates' but withholds MERGE when the records conflict", async () => {
    // The conflict argues FOR "different people" — it must never take that answer away.
    stub(() => [PAIR({ safeToReject: true, safeToMerge: false })]);
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openQueue(user);
    expect(await screen.findByRole("button", { name: /not duplicates/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /keep Robert Jones/i })).toBeNull();
    expect(screen.getByRole("button", { name: /open to resolve/i })).toBeTruthy();
  });

  it("offers only 'open to resolve' when the row is hiding an address", async () => {
    stub(() => [PAIR({ safeToReject: false, safeToMerge: false })]);
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openQueue(user);
    expect(await screen.findByRole("button", { name: /open to resolve/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /not duplicates/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /keep Robert Jones/i })).toBeNull();
  });

  it("shows a ridden household address rather than 'No email' (067)", async () => {
    stub(() => [
      PAIR({
        b: {
          ...PAIR().b,
          emails: [],
          messageRecipient: { address: "culberts@example.com", ownerDisplayName: "Cindy Culbert" },
        },
      }),
    ]);
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openQueue(user);
    const row = await screen.findByRole("listitem", { name: /Robert Jones/i });
    expect(within(row).getByText(/reached via Cindy Culbert/i)).toBeTruthy();
    expect(within(row).queryByText(/^No email$/i)).toBeNull();
  });

  it("can open either record from every row (FR-007)", async () => {
    stub(() => [PAIR()]);
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openQueue(user);
    const row = await screen.findByRole("listitem", { name: /Robert Jones/i });
    expect(within(row).getByRole("button", { name: /open Robert Jones/i })).toBeTruthy();
    expect(within(row).getByRole("button", { name: /open Rob Jones/i })).toBeTruthy();
  });
});

/**
 * Feature 069 (FR-004a): a rejection must be findable "from the duplicates queue itself — where its
 * absence would be noticed". Searching a name is exactly such a place: the pairs shown beside the results
 * are the same queue, scoped, and a rejection hides pairs there too. Gating the control on the dedicated
 * view left the scoped list with no way to reveal them, and no sign that anything was missing.
 */
describe("revealing rejections works wherever pairs are shown", () => {
  it("offers the control beside search results, and scopes it to the query", async () => {
    const calls = stub((includeRejected) =>
      includeRejected ? [PAIR({ rejected: REJECTION })] : [],
    );
    const user = userEvent.setup();
    render(<ContactsPage />);

    await user.type(screen.getByPlaceholderText(/search by name/i), "Jones");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /potential duplicates/i })).toBeTruthy(),
    );

    await user.click(screen.getByRole("button", { name: /show rejected/i }));
    expect(await screen.findByText("Rob Jones")).toBeTruthy();
    // The scoped reveal keeps the query — it is the same queue, narrowed, not a jump to the global one.
    const revealed = calls.filter((c) => c.url.includes("includeRejected=1"));
    expect(revealed.length).toBeGreaterThan(0);
    expect(revealed.some((c) => c.url.includes("q=Jones"))).toBe(true);
  });
});
