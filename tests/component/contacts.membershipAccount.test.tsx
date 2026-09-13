// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MembershipAccount, {
  type MembershipBlock,
} from "@/app/(admin)/contacts/_components/MembershipAccount";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; init?: RequestInit };
function stub(status = 200, body: unknown = { ok: true }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: status < 400, status, json: async () => body };
    }),
  );
  return calls;
}

const asPayer: MembershipBlock = {
  status: "current",
  expiryDate: "2027-08-31",
  asPayer: {
    level: "supporter",
    members: [{ contactId: "c-abby", displayName: "Abigail Culbert" }],
  },
  asMember: null,
};

const asMember: MembershipBlock = {
  status: "current",
  expiryDate: "2027-08-31",
  asPayer: null,
  asMember: { payerContactId: "c-cindy", payerDisplayName: "Cindy Culbert" },
};

const renderBlock = (membership: MembershipBlock, canWrite = true) =>
  render(
    <MembershipAccount
      contactId="c-x"
      membership={membership}
      canWrite={canWrite}
      onChanged={() => {}}
    />,
  );

// Feature 068 (FR-018/FR-019): the household is answerable from the record.
describe("MembershipAccount — the household on a record (feature 068)", () => {
  it("a payer's record lists the other members and the level (FR-019)", () => {
    renderBlock(asPayer);
    const region = screen.getByRole("region", { name: /membership/i });
    expect(region.textContent).toMatch(/supporter/i);
    // The name appears both as the member and on its Remove control, so assert on the region's text.
    expect(region.textContent).toMatch(/Abigail Culbert/);
  });

  it("a member's record names the payer and shows no level of its own (FR-018, FR-013)", () => {
    renderBlock(asMember);
    const region = screen.getByRole("region", { name: /membership/i });
    expect(region.textContent).toMatch(/Cindy Culbert/);
    expect(region.textContent).not.toMatch(/supporter|individual|family|student/i);
  });

  it("is labelled distinctly from the shared-email household (FR-020)", () => {
    renderBlock(asPayer);
    // The two households overlap but are different facts; the labels must not blur them.
    const region = screen.getByRole("region", { name: /membership/i });
    expect(region.getAttribute("aria-label")).toMatch(/membership/i);
    expect(region.getAttribute("aria-label")).not.toMatch(/email/i);
  });

  it("shows the status and expiry so lapse is visible on the record", () => {
    renderBlock({ ...asPayer, status: "lapsed" });
    expect(screen.getByRole("region", { name: /membership/i }).textContent).toMatch(/lapsed/i);
  });
});

describe("MembershipAccount — maintaining the household (feature 068)", () => {
  /**
   * The add control must be a SEARCH, not a contact-id box. Ids are internal keys; asking a human to
   * supply one makes the feature unusable — which is exactly how a family account ended up with no
   * practical way to add a family member.
   */
  it("adding a member searches by name and posts the chosen contact (FR-022)", async () => {
    const calls = stub(200, { items: [{ id: "c-found", displayName: "Amy Vail" }] });
    renderBlock(asPayer);

    await userEvent.type(screen.getByPlaceholderText(/search/i), "Amy");
    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/contacts?q="))).toBe(true));

    await userEvent.click(await screen.findByRole("button", { name: /add Amy Vail/i }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.url.includes("/api/contacts/c-x/membership/members") && c.init?.method === "POST",
      );
      expect(String(post!.init?.body)).toContain("c-found");
    });
  });

  it("labels the member search distinctly from the email editor's Add email", () => {
    renderBlock(asPayer);
    // Both blocks sit on the same record and both begin "Add"; the membership one must say what it adds.
    expect(screen.getByLabelText(/add a member to this membership/i)).toBeInTheDocument();
  });

  it("finds a member by a DIFFERENT surname, or by email (no surname assumption)", async () => {
    const calls = stub(200, { items: [{ id: "c-tim", displayName: "Tim Ball" }] });
    renderBlock(asPayer); // payer is a Culbert; the member is a Ball
    await userEvent.type(screen.getByLabelText(/add a member to this membership/i), "Tim Ball");
    await waitFor(() => expect(calls.some((c) => c.url.includes("q=Tim%20Ball"))).toBe(true));
    await userEvent.click(await screen.findByRole("button", { name: /add Tim Ball/i }));
    await waitFor(() => {
      const post = calls.find((c) => c.init?.method === "POST");
      expect(String(post!.init?.body)).toContain("c-tim");
    });
  });

  it("never asks for a contact id — no raw key is exposed in the UI", () => {
    renderBlock(asPayer);
    expect(screen.queryByPlaceholderText(/contact id/i)).toBeNull();
  });

  it("a family account covering only its payer still offers the add control (Amy Vail case)", () => {
    renderBlock({
      status: "current",
      expiryDate: "2027-08-31",
      asPayer: { level: "family", members: [] }, // covers the payer alone, so far
      asMember: null,
    });
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it("removing a member issues a DELETE naming them (FR-022)", async () => {
    const calls = stub();
    renderBlock(asPayer);
    await userEvent.click(screen.getByRole("button", { name: /remove Abigail Culbert/i }));
    await waitFor(() => {
      const del = calls.find((c) => c.init?.method === "DELETE");
      expect(String(del!.init?.body)).toContain("c-abby");
    });
  });

  it("changing the level issues a PATCH (FR-023)", async () => {
    const calls = stub();
    renderBlock(asPayer);
    await userEvent.selectOptions(screen.getByLabelText(/level/i), "family");
    await userEvent.click(screen.getByRole("button", { name: /save level/i }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.endsWith("/api/contacts/c-x/membership") && c.init?.method === "PATCH",
        ),
      ).toBe(true),
    );
  });

  it("surfaces a capacity refusal, naming who would be displaced (FR-003a)", async () => {
    stub(422, {
      error: {
        code: "LEVEL_CAPACITY_EXCEEDED",
        message:
          "A individual membership covers only the payer — Abigail Culbert would no longer be covered. Remove them first.",
      },
    });
    renderBlock(asPayer);
    await userEvent.selectOptions(screen.getByLabelText(/level/i), "individual");
    await userEvent.click(screen.getByRole("button", { name: /save level/i }));
    await waitFor(() =>
      expect(screen.getByText(/Abigail Culbert would no longer be covered/i)).toBeInTheDocument(),
    );
  });

  it("hides every control without membership-write authority (FR-017)", () => {
    renderBlock(asPayer, false);
    // Mel can SEE the household; only the FS/Treasurer may change it.
    expect(screen.getByRole("region", { name: /membership/i }).textContent).toMatch(
      /Abigail Culbert/,
    );
    expect(screen.queryByRole("button", { name: /^add member$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove Abigail/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /save level/i })).toBeNull();
  });

  it("renders nothing for a contact on no account", () => {
    const { container } = renderBlock({
      status: "never",
      expiryDate: null,
      asPayer: null,
      asMember: null,
    });
    expect(container).toBeEmptyDOMElement();
  });
});

// Feature 075: the Level select is a draft seeded at mount. A re-fetch into the SAME instance (e.g. a
// merge from the email block made this contact the payer) must show the account's real level — otherwise
// "Save level" would silently write the stale default back.
describe("MembershipAccount — level follows a re-fetched record (feature 075)", () => {
  it("shows the payer's level when the contact becomes a payer without a remount", () => {
    const { rerender } = renderBlock(asMember);
    rerender(
      <MembershipAccount
        contactId="c-x"
        membership={asPayer}
        canWrite={true}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByRole("combobox", { name: /level/i })).toHaveValue("supporter");
  });
});
