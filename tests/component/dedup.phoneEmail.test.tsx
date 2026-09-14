// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContactsPage from "@/app/(admin)/contacts/page";

// Feature 033 (P5-R7): each candidate shows its dashed phone + active email(s), with a clear
// "no phone" / "no email" when absent — never a bare blank — and the merge controls stay reachable.
// Feature 069: re-pointed from the retired `/dedup` page to the queue row that replaced it.
const PAIRS = [
  {
    a: {
      id: "a1",
      displayName: "Chris Smith",
      membershipStatus: "active",
      membershipLevel: null,
      phone: "+15855551234",
      emails: ["chris@example.org"],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      hasLogin: false,
      hasUnshownAddress: false,
      messageRecipient: null,
    },
    b: {
      id: "b1",
      displayName: "Christopher Smith",
      membershipStatus: "never",
      membershipLevel: null,
      phone: null,
      emails: [] as string[],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      hasLogin: false,
      hasUnshownAddress: false,
      messageRecipient: null,
    },
    similarity: 1,
    sharedHousehold: { email: false, account: false },
    rejected: null,
    safeToReject: true,
    safeToMerge: true,
  },
];

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/contacts/launcher-counts"))
        return json({ needsReview: 0, duplicates: 1 });
      if (u.includes("/api/me/capabilities")) return json({ contactWrite: true, dedupWrite: true });
      if (u.includes("/api/dedup/suggestions")) return json({ pairs: PAIRS });
      return json({ items: [] });
    }),
  );
}

describe("phone + email per candidate on the duplicates row (033 US1)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows dashed phone + email, and no-phone/no-email when absent; merge controls stay", async () => {
    stub();
    const user = userEvent.setup();
    render(<ContactsPage />);
    await user.click(await screen.findByRole("button", { name: /review duplicates/i }));
    const row = await screen.findByRole("listitem", { name: /Chris Smith and Christopher Smith/i });

    // Candidate A: dashed phone (formatPhone) + its active email.
    expect(within(row).getByText("585-555-1234")).toBeInTheDocument();
    expect(within(row).getByText(/chris@example\.org/)).toBeInTheDocument();

    // Candidate B: no phone / no email indicated (not a blank).
    expect(within(row).getByText(/no phone/i)).toBeInTheDocument();
    expect(within(row).getByText(/no email/i)).toBeInTheDocument();

    // Merge controls unchanged.
    expect(within(row).getByRole("button", { name: /keep Chris Smith$/i })).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: /keep Christopher Smith$/i }),
    ).toBeInTheDocument();
  });
});
