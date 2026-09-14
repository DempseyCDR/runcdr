// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MergeCompare from "@/app/(admin)/contacts/_components/MergeCompare";

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
  firstName: "David",
  lastName: "Jones",
  displayNameOverride: null,
  membershipStatus: "current",
  membershipLevel: "family",
  phone: "+15855551234",
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
  b: side({
    id: "c-bridget",
    displayName: "Bridgit Jones",
    membershipStatus: "never",
    membershipLevel: null,
    phone: null,
    emails: [],
  }),
  similarity: 0.82,
  sharedHousehold: { email: false, account: false },
  rejected: null,
  safeToReject: false,
  safeToMerge: false,
  heldMergeId: null,
};

const owner = {
  id: "c-david",
  displayName: "David Jones",
  emails: [
    { id: "e-david", email: "shared@jones.com", status: "active" },
    { id: "e-david-old", email: "dj-1998@aol.com", status: "inactive" },
  ],
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
      const hit = Object.keys(records).find((id) => u.endsWith(`/api/contacts/${id}`));
      if (hit) return json(records[hit]);
      return json({ ok: true });
    }),
  );
  return calls;
}

const open = () =>
  render(
    <MergeCompare
      pair={PAIR}
      onClose={() => {}}
      onMerged={() => {}}
      onRejected={() => {}}
      onOpenHold={() => {}}
      permissions={{ merge: true, share: true, seeHolds: true }}
    />,
  );

/**
 * Feature 069, US3 (FR-008/FR-009/FR-015a/FR-015b). The pair opens a COMPARISON of two records, not an
 * inline field-by-field merge: one question — "are these one person?" — with three answers, of which only
 * one is destructive. This screen replaces the retired `/dedup` page and carries its guards across.
 */
/** Feature 076: the comparison shows names by exactly the same rule as the queue row. */
describe("the comparison's names (076)", () => {
  it("shows first and last name beneath a CUSTOM display name, and nothing beneath an automatic one", async () => {
    stub({ "c-david": owner, "c-bridget": referrerNoEmail });
    const pair = {
      ...PAIR,
      b: side({
        id: "c-bridget",
        displayName: "Biddy",
        firstName: "Bridgit",
        lastName: "Jones",
        displayNameOverride: "Biddy",
        emails: [],
      }),
    };
    render(
      <MergeCompare
        pair={pair}
        onClose={() => {}}
        onMerged={() => {}}
        onRejected={() => {}}
        onOpenHold={() => {}}
        permissions={{ merge: true, share: true, seeHolds: true }}
      />,
    );
    const panel = await screen.findByRole("dialog");

    expect(within(panel).getByText("Bridgit Jones")).toBeInTheDocument();
    // David Jones is automatic: his name appears in the header and in the action buttons, but never as
    // a separate name line.
    expect(within(panel).getAllByText(/^David Jones$/)).toHaveLength(1);
    expect(within(panel).queryByText(/custom/i)).toBeNull();
  });
});

describe("the merge comparison", () => {
  it("shows EVERY email per side, whatever its status, and says the survivor inherits them (FR-009)", async () => {
    stub({ "c-david": owner, "c-bridget": referrerNoEmail });
    open();
    const panel = await screen.findByRole("dialog");
    // The retired address is exactly the fact the queue row could not show.
    expect(within(panel).getByText(/dj-1998@aol\.com/)).toBeInTheDocument();
    expect(within(panel).getByText(/inactive/i)).toBeInTheDocument();
    expect(within(panel).getByText(/inherits every address/i)).toBeInTheDocument();
    // Feature 076: since 074 a merge CAN be undone, and the queue row already says so. The comparison
    // used to say it could not, contradicting the row one click earlier.
    expect(within(panel).getByText(/can be undone afterwards/i)).toBeInTheDocument();
    expect(within(panel).queryByText(/cannot be undone/i)).toBeNull();
  });

  it("offers all three resolutions, with merge marked as the destructive one (FR-015a)", async () => {
    stub({ "c-david": owner, "c-bridget": referrerNoEmail });
    open();
    const panel = await screen.findByRole("dialog");
    const merge = within(panel).getByRole("button", { name: /keep David Jones/i });
    expect(merge).toBeInTheDocument();
    expect(merge.className).toMatch(/destructive/i);
    expect(
      within(panel).getByRole("button", { name: /share David Jones'?s? email/i }),
    ).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /not duplicates/i })).toBeInTheDocument();
  });

  it("names the address the referring contact would adopt, and sends nothing yet (FR-015b)", async () => {
    const calls = stub({ "c-david": owner, "c-bridget": referrerNoEmail });
    open();
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /share David Jones'?s? email/i }));

    const confirm = await screen.findByRole("region", { name: /shared email confirmation/i });
    expect(within(confirm).getByText(/shared@jones\.com/)).toBeInTheDocument();
    expect(calls.some((c) => c.init?.method === "PUT")).toBe(false);
  });

  it("confirming links the referrer to the owner's email (FR-015b)", async () => {
    const calls = stub({ "c-david": owner, "c-bridget": referrerNoEmail });
    open();
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /share David Jones'?s? email/i }));
    await screen.findByRole("region", { name: /shared email confirmation/i });
    await userEvent.click(screen.getByRole("button", { name: /confirm shared email/i }));

    await waitFor(() => {
      const put = calls.find(
        (c) =>
          c.url.includes("/api/contacts/c-bridget/message-recipient") && c.init?.method === "PUT",
      );
      expect(put).toBeTruthy();
      expect(String(put!.init?.body)).toContain('"emailId":"e-david"');
    });
  });

  it("warns before retiring an address the referrer already owns, then sends retireEmailId (FR-015b)", async () => {
    const calls = stub({ "c-david": owner, "c-bridget": referrerWithEmail });
    open();
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /share David Jones'?s? email/i }));

    const confirm = await screen.findByRole("region", { name: /shared email confirmation/i });
    expect(within(confirm).getByText(/bridgit-old@example\.com/)).toBeInTheDocument();
    expect(calls.some((c) => c.init?.method === "PUT")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: /confirm shared email/i }));
    await waitFor(() => {
      const put = calls.find((c) => c.init?.method === "PUT");
      expect(String(put!.init?.body)).toContain('"retireEmailId":"e-bridget"');
    });
  });

  it("says so when the contact whose address would be shared has none", async () => {
    stub({ "c-david": owner, "c-bridget": referrerNoEmail });
    open();
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /share Bridgit Jones'?s? email/i }));
    expect(await screen.findByText(/has no active address to share/i)).toBeInTheDocument();
  });
});
