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
  id: "c-david",
  displayName: "David Jones",
  membershipStatus: "never",
  membershipLevel: null,
  phone: null,
  emails: ["shared@jones.com"],
  createdAt: "2019-04-02T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
  hasLogin: false,
  hasUnshownAddress: false,
  messageRecipient: null,
  ...over,
});

const PAIR = {
  a: side(),
  b: side({ id: "c-bridget", displayName: "Bridgit Jones", emails: [] }),
  similarity: 0.82,
  sharedHousehold: { email: false, account: false },
  rejected: null,
  // Not resolvable from the row, so the queue offers the comparison — which is where the action lives.
  safeToReject: false,
  safeToMerge: false,
};

const owner = {
  id: "c-david",
  displayName: "David Jones",
  emails: [{ id: "e-david", email: "shared@jones.com", status: "active" }],
};
const referrerNoEmail = { id: "c-bridget", displayName: "Bridgit Jones", emails: [] };
const referrerWithEmail = {
  id: "c-bridget",
  displayName: "Bridgit Jones",
  emails: [{ id: "e-bridget", email: "bridgit-old@example.com", status: "active" }],
};

function stub(records: Record<string, unknown>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.includes("/api/contacts/launcher-counts"))
        return json({ needsReview: 0, duplicates: 1 });
      if (u.includes("/api/me/capabilities"))
        return json({
          contactWrite: true,
          contactDelete: false,
          contactDeleteUnrestricted: false,
          contactMailingWrite: true, // linking a shared address is hers (078 gates it)
          dedupWrite: true,
        });
      if (u.includes("/api/dedup/suggestions")) return json({ pairs: [PAIR] });
      const hit = Object.keys(records).find((id) => u.endsWith(`/api/contacts/${id}`));
      if (hit) return json(records[hit]);
      return json({ items: [] });
    }),
  );
  return calls;
}

/** Queue → "open to resolve" → the comparison, which is where link-as-shared now lives. */
async function openComparison(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /review duplicates/i }));
  await user.click(await screen.findByRole("button", { name: /open to resolve/i }));
  return screen.findByRole("dialog", { name: /compare/i });
}

/**
 * Feature 067 (FR-019), re-pointed by feature 069 (FR-015b) when `/dedup` was retired.
 *
 * The duplicates queue pairs on NAME similarity and knows nothing about addresses. A same-surname pair is
 * not evidence of a household — Lydia and Richard Dempsey share a surname and must never share an address
 * — so the action must state the address being adopted and confirm before retiring anything. That guard
 * travels with the action: this asserts it from the queue Mel actually works, through to the write.
 */
describe("link as shared is explicit, from the duplicates queue (067 / 069)", () => {
  it("names the address the referring contact would adopt, and sends nothing yet", async () => {
    const calls = stub({ "c-david": owner, "c-bridget": referrerNoEmail });
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openComparison(user);

    await user.click(screen.getByRole("button", { name: /share David Jones'?s? email/i }));
    const confirm = await screen.findByRole("region", { name: /shared email confirmation/i });
    expect(within(confirm).getByText(/shared@jones\.com/)).toBeInTheDocument();
    expect(calls.some((c) => c.init?.method === "PUT")).toBe(false);
  });

  it("confirming links the referrer to the owner's email", async () => {
    const calls = stub({ "c-david": owner, "c-bridget": referrerNoEmail });
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openComparison(user);

    await user.click(screen.getByRole("button", { name: /share David Jones'?s? email/i }));
    await screen.findByRole("region", { name: /shared email confirmation/i });
    await user.click(screen.getByRole("button", { name: /confirm shared email/i }));

    await waitFor(() => {
      const put = calls.find(
        (c) =>
          c.url.includes("/api/contacts/c-bridget/message-recipient") && c.init?.method === "PUT",
      );
      expect(put).toBeTruthy();
      expect(String(put!.init?.body)).toContain('"emailId":"e-david"');
    });
  });

  it("warns before retiring an address the referrer already owns, then sends retireEmailId", async () => {
    const calls = stub({ "c-david": owner, "c-bridget": referrerWithEmail });
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openComparison(user);

    await user.click(screen.getByRole("button", { name: /share David Jones'?s? email/i }));
    const confirm = await screen.findByRole("region", { name: /shared email confirmation/i });
    expect(within(confirm).getByText(/bridgit-old@example\.com/)).toBeInTheDocument();
    expect(calls.some((c) => c.init?.method === "PUT")).toBe(false);

    await user.click(screen.getByRole("button", { name: /confirm shared email/i }));
    await waitFor(() => {
      const put = calls.find((c) => c.init?.method === "PUT");
      expect(String(put!.init?.body)).toContain('"retireEmailId":"e-bridget"');
    });
  });
});
