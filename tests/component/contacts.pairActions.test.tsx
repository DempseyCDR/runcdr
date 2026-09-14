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
  displayName: "Holdy Signin",
  firstName: "Holdy",
  lastName: "Signin",
  displayNameOverride: null,
  membershipStatus: "never",
  membershipLevel: null,
  phone: null,
  emails: ["signin@example.com"],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  hasLogin: true,
  hasUnshownAddress: false,
  messageRecipient: null,
  ...over,
});

const PAIR = (over: Record<string, unknown> = {}) => ({
  a: side(),
  b: side({
    id: "c-b",
    displayName: "Holdy Signen",
    lastName: "Signen",
    emails: ["signen@example.com"],
  }),
  similarity: 0.8,
  sharedHousehold: { email: false, account: false },
  rejected: null,
  safeToReject: true,
  safeToMerge: false,
  heldMergeId: null,
  ...over,
});

const HOLD_DETAIL = {
  id: "h1",
  reason: "two_logins",
  canonical: { id: "c-a", displayName: "Holdy Signin" },
  merged: { id: "c-b", displayName: "Holdy Signen" },
  answerableBy: "role.assign",
  canAnswer: true,
  answered: [],
  candidates: [],
};

type Opts = {
  caps: Record<string, boolean>;
  pair?: Record<string, unknown>;
  merge?: { body: unknown; status: number };
  reject?: { body: unknown; status: number };
};

function stub(opts: Opts): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.includes("/api/contacts/launcher-counts"))
        return json({ needsReview: 0, duplicates: 1 });
      if (u.includes("/api/me/capabilities")) return json(opts.caps);
      if (u.includes("/api/dedup/suggestions"))
        return json({ pairs: [PAIR(opts.pair)], suppressed: 0, truncated: false });
      if (u.includes("/api/dedup/merge"))
        return json(opts.merge?.body ?? { outcome: "completed" }, opts.merge?.status ?? 200);
      if (u.includes("/api/dedup/rejections"))
        return json(opts.reject?.body ?? { ok: true }, opts.reject?.status ?? 200);
      if (/\/api\/dedup\/held\/h1$/.test(u)) return json(HOLD_DETAIL);
      if (/\/api\/contacts\/c-[ab]$/.test(u)) return json({ emails: [] });
      return json({ items: [] });
    }),
  );
  return calls;
}

const PRESIDENT = { roleAssign: true };
const MEL = { contactWrite: true, contactMailingWrite: true, dedupWrite: true };

async function openPairs() {
  const user = userEvent.setup();
  render(<ContactsPage />);
  await user.click(await screen.findByRole("button", { name: /review duplicates/i }));
  const row = await screen.findByRole("listitem", { name: /Holdy Signin and Holdy Signen/i });
  return { user, row };
}

/**
 * Feature 078, from the manual pass. A President — who can answer holds but not merge — opened a held pair
 * from the duplicates queue: the comparison offered merge buttons that failed silently, and no way to the
 * hold she could answer.
 */
describe("pair actions follow what the person can do (078)", () => {
  it("offers no merge or not-duplicates on the row to someone who cannot merge", async () => {
    stub({ caps: PRESIDENT, pair: { safeToMerge: true } });
    const { row } = await openPairs();
    expect(within(row).queryAllByRole("button", { name: /^keep /i })).toHaveLength(0);
    expect(within(row).queryAllByRole("button", { name: /not duplicates/i })).toHaveLength(0);
  });

  it("makes the comparison view-only for someone who cannot merge", async () => {
    stub({ caps: PRESIDENT });
    const { user, row } = await openPairs();
    await user.click(within(row).getByRole("button", { name: /open to resolve/i }));
    const dialog = await screen.findByRole("dialog", { name: /Holdy Signin/i });
    expect(within(dialog).queryAllByRole("button", { name: /keep .*retire/i })).toHaveLength(0);
    expect(within(dialog).queryAllByRole("button", { name: /not duplicates/i })).toHaveLength(0);
    expect(within(dialog).queryAllByRole("button", { name: /share/i })).toHaveLength(0);
    expect(within(dialog).getByText(/cannot merge/i)).toBeInTheDocument();
  });

  it("still offers merging to someone who can", async () => {
    stub({ caps: MEL });
    const { user, row } = await openPairs();
    await user.click(within(row).getByRole("button", { name: /open to resolve/i }));
    const dialog = await screen.findByRole("dialog", { name: /Holdy Signin/i });
    expect(
      within(dialog).getByRole("button", { name: /keep Holdy Signin, retire/i }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /not duplicates/i })).toBeInTheDocument();
  });

  it("sends a held pair to its hold, from the row and from the comparison", async () => {
    const calls = stub({ caps: PRESIDENT, pair: { heldMergeId: "h1" } });
    const { user, row } = await openPairs();
    expect(within(row).getByText(/merge is held/i)).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: /open held merge/i }));
    expect(
      await screen.findByRole("dialog", { name: /held merge: Holdy Signin and Holdy Signen/i }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/api/dedup/held/h1"))).toBe(true);
    await user.click(screen.getByRole("button", { name: /^close$/i }));

    await user.click(within(row).getByRole("button", { name: /open to resolve/i }));
    const compare = await screen.findByRole("dialog", { name: /Holdy Signin/i });
    await user.click(within(compare).getByRole("button", { name: /open held merge/i }));
    expect(
      await screen.findByRole("dialog", { name: /held merge: Holdy Signin and Holdy Signen/i }),
    ).toBeInTheDocument();
  });

  it("does not offer merging a pair whose merge is already held, even to someone who can merge", async () => {
    stub({ caps: MEL, pair: { heldMergeId: "h1" } });
    const { user, row } = await openPairs();
    await user.click(within(row).getByRole("button", { name: /open to resolve/i }));
    const dialog = await screen.findByRole("dialog", { name: /Holdy Signin/i });
    expect(within(dialog).queryAllByRole("button", { name: /keep .*retire/i })).toHaveLength(0);
    expect(within(dialog).getByRole("button", { name: /open held merge/i })).toBeInTheDocument();
  });

  it("says why when a merge is refused, instead of doing nothing", async () => {
    stub({
      caps: MEL,
      pair: {
        safeToMerge: true,
        a: side({ hasLogin: false }),
        b: side({ id: "c-b", displayName: "Holdy Signen", hasLogin: false }),
      },
      merge: {
        body: { error: { code: "UNAUTHORIZED", message: "Not permitted: dedup.write." } },
        status: 403,
      },
    });
    const { user, row } = await openPairs();
    await user.click(within(row).getByRole("button", { name: /keep Holdy Signin/i }));
    expect(await screen.findByText(/not permitted: dedup\.write/i)).toBeInTheDocument();
  });

  it("says why when not-duplicates is refused", async () => {
    stub({
      caps: MEL,
      reject: {
        body: { error: { code: "UNAUTHORIZED", message: "Not permitted: dedup.write." } },
        status: 403,
      },
    });
    const { user, row } = await openPairs();
    await user.click(within(row).getByRole("button", { name: /not duplicates/i }));
    await waitFor(() =>
      expect(screen.getByText(/not permitted: dedup\.write/i)).toBeInTheDocument(),
    );
  });
});
