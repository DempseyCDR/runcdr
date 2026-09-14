// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HeldMergeChooser from "@/app/(admin)/contacts/_components/HeldMergeChooser";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; init?: RequestInit };
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

export const DETAIL = (over: Record<string, unknown> = {}) => ({
  id: "h1",
  reason: "two_accounts",
  canonical: { id: "c-a", displayName: "Robert Jones" },
  merged: { id: "c-b", displayName: "Rob Jones" },
  answerableBy: "dedup.write",
  canAnswer: true,
  answered: [],
  candidates: [],
  ...over,
});

/** `detail` answers GET; `resolve` answers POST …/resolve; DELETE always succeeds. */
export function stub(
  detail: () => unknown,
  resolve?: () => { body: unknown; status?: number },
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push({ url: u, init });
      if (u.endsWith("/resolve") && resolve) {
        const r = resolve();
        return json(r.body, r.status ?? 200);
      }
      if (method === "DELETE") return json({ ok: true });
      return json(detail());
    }),
  );
  return calls;
}

export const openChooser = (onDone = vi.fn(), onClose = vi.fn()) => {
  render(<HeldMergeChooser holdId="h1" onDone={onDone} onClose={onClose} />);
  return { onDone, onClose };
};

/**
 * Feature 078 (FR-001, FR-006, FR-007). One chooser for every held merge: it asks the hold's actual
 * question, says who can answer it, and — for someone who cannot — shows what is waiting and still lets
 * them decline. Before it, Resolve only opened a contact record.
 */
describe("the held-merge chooser", () => {
  it("names the pair and says whatever is decided can be undone (FR-007)", async () => {
    stub(() => DETAIL());
    openChooser();
    const dialog = await screen.findByRole("dialog", { name: /held merge/i });
    expect(within(dialog).getByText(/Robert Jones/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Rob Jones/)).toBeInTheDocument();
    expect(within(dialog).getByText(/can be undone afterwards/i)).toBeInTheDocument();
  });

  it("shows someone who cannot answer what is waiting, and on whom, with no way to answer (FR-006)", async () => {
    stub(() => DETAIL({ reason: "two_logins", answerableBy: "role.assign", canAnswer: false }));
    openChooser();
    const dialog = await screen.findByRole("dialog", { name: /held merge/i });
    expect(within(dialog).getByText(/both contacts sign in/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/waiting on an officer/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /confirm and merge/i })).toBeNull();
    expect(within(dialog).getByRole("button", { name: /don't merge/i })).toBeInTheDocument();
  });

  it("lists decisions already recorded by someone else", async () => {
    stub(() =>
      DETAIL({ reason: "role_conflict", answerableBy: "role.assign", answered: ["two_accounts"] }),
    );
    openChooser();
    const dialog = await screen.findByRole("dialog", { name: /held merge/i });
    expect(within(dialog).getByText(/already decided/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/which membership account survives/i)).toBeInTheDocument();
  });

  it("declines with Don't merge, and reports it", async () => {
    const calls = stub(() => DETAIL());
    const { onDone } = openChooser();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /don't merge/i }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith("/api/dedup/held/h1") && c.init?.method === "DELETE"),
      ).toBe(true),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.stringMatching(/not merged/i)));
  });
});

const ACCOUNTS = [
  {
    accountId: "acc-1",
    payerDisplayName: "Robert Jones",
    level: "family",
    expiryDate: "2027-08-31",
    lastPaymentDate: "2026-09-01",
    members: ["Robert Jones", "Ann Jones"],
  },
  {
    accountId: "acc-2",
    payerDisplayName: "Rob Jones",
    level: "individual",
    expiryDate: "2026-12-31",
    lastPaymentDate: null,
    members: ["Rob Jones"],
  },
];

/** Feature 078, User Story 1 (FR-002): the mailing-list manager answers the question that is hers. */
describe("the two-accounts panel", () => {
  it("shows both accounts in full and says what happens to the one not chosen", async () => {
    stub(() => DETAIL({ candidates: ACCOUNTS }));
    openChooser();
    const dialog = await screen.findByRole("dialog", { name: /held merge/i });
    expect(within(dialog).getByText(/family/)).toBeInTheDocument();
    expect(within(dialog).getByText(/2027-08-31/)).toBeInTheDocument();
    expect(within(dialog).getByText(/2026-09-01/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Ann Jones/)).toBeInTheDocument();
    expect(within(dialog).getByText(/not chosen is deleted/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/moves to the chosen/i)).toBeInTheDocument();
  });

  it("posts the chosen account, and reports a completed merge", async () => {
    const calls = stub(
      () => DETAIL({ candidates: ACCOUNTS }),
      () => ({ body: { outcome: "completed", canonicalId: "c-a", moved: {} } }),
    );
    const { onDone } = openChooser();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /Rob Jones/ }));
    await user.click(screen.getByRole("button", { name: /confirm and merge/i }));

    const post = calls.find((c) => c.url.endsWith("/resolve"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ survivingAccountId: "acc-2" });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.stringMatching(/merged/i)));
  });

  it("shows the next question straight away when the merge needs another decision (FR-008)", async () => {
    let answered = false;
    stub(
      () =>
        answered
          ? DETAIL({
              reason: "role_conflict",
              answerableBy: "role.assign",
              canAnswer: false,
              answered: ["two_accounts"],
            })
          : DETAIL({ candidates: ACCOUNTS }),
      () => {
        answered = true;
        return { body: { outcome: "held", reason: "role_conflict", heldMergeId: "h1" } };
      },
    );
    const { onDone } = openChooser();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /Robert Jones/ }));
    await user.click(screen.getByRole("button", { name: /confirm and merge/i }));

    const dialog = await screen.findByRole("dialog", { name: /held merge/i });
    expect(
      await within(dialog).findByText(/two offices that must stay separate/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/waiting on an officer/i)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});

const SIGN_INS = [
  {
    contactId: "c-a",
    contactDisplayName: "Robert Jones",
    loginEmailId: "e-a",
    loginEmail: "robert@example.com",
    identityId: "i-a",
    lastSignInAt: "2026-09-01T12:00:00.000Z",
  },
  {
    contactId: "c-b",
    contactDisplayName: "Rob Jones",
    loginEmailId: "e-b",
    loginEmail: "rob@example.com",
    identityId: null,
    lastSignInAt: null,
  },
];

const GRANTS = [
  {
    grantId: "g-1",
    role: "treasurer",
    scope: "club-wide",
    heldBy: "merged",
    conflict: "exclusive",
  },
  {
    grantId: "g-2",
    role: "vice_president",
    scope: "club-wide",
    heldBy: "merged",
    conflict: "role_assign",
  },
  { grantId: "g-3", role: "booker", scope: "Contra Dance", heldBy: "merged", conflict: null },
];

/** Feature 078, User Story 2 (FR-003, FR-004, FR-006): the officer's questions. */
describe("the sign-in and role panels", () => {
  it("chooses one contact's sign-in whole: its address and Google account together (FR-003)", async () => {
    const calls = stub(
      () => DETAIL({ reason: "two_logins", answerableBy: "role.assign", candidates: SIGN_INS }),
      () => ({ body: { outcome: "completed", canonicalId: "c-a", moved: {} } }),
    );
    openChooser();
    const user = userEvent.setup();
    const dialog = await screen.findByRole("dialog", { name: /held merge/i });
    expect(within(dialog).getByText(/robert@example\.com/)).toBeInTheDocument();
    expect(within(dialog).getByText(/no Google account/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/discarded/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("radio", { name: /Robert Jones/ }));
    await user.click(within(dialog).getByRole("button", { name: /confirm and merge/i }));
    const post = calls.find((c) => c.url.endsWith("/resolve"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      survivingLoginEmailId: "e-a",
      survivingIdentityId: "i-a",
    });
  });

  it("posts only what the chosen contact has", async () => {
    const calls = stub(
      () => DETAIL({ reason: "two_logins", answerableBy: "role.assign", candidates: SIGN_INS }),
      () => ({ body: { outcome: "completed", canonicalId: "c-a", moved: {} } }),
    );
    openChooser();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /Rob Jones/ }));
    await user.click(screen.getByRole("button", { name: /confirm and merge/i }));
    const post = calls.find((c) => c.url.endsWith("/resolve"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ survivingLoginEmailId: "e-b" });
  });

  it("lists every role with why it conflicts, and moving none is an answer (FR-004)", async () => {
    const calls = stub(
      () => DETAIL({ reason: "role_conflict", answerableBy: "role.assign", candidates: GRANTS }),
      () => ({ body: { outcome: "completed", canonicalId: "c-a", moved: {} } }),
    );
    openChooser();
    const user = userEvent.setup();
    const dialog = await screen.findByRole("dialog", { name: /held merge/i });
    expect(within(dialog).getByRole("checkbox", { name: /treasurer/i })).not.toBeChecked();
    expect(
      within(dialog).getByText(/two offices that must stay separate/i, { selector: "li *, li" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/authority to assign roles/i, { selector: "li *, li" }),
    ).toBeInTheDocument();
    // An uncontested role moves unless someone unticks it — leaving it off would drop it silently.
    expect(within(dialog).getByRole("checkbox", { name: /booker/i })).toBeChecked();
    expect(within(dialog).getByText(/Contra Dance/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("checkbox", { name: /booker/i }));
    await user.click(within(dialog).getByRole("button", { name: /confirm and merge/i }));
    const post = calls.find((c) => c.url.endsWith("/resolve"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ keepGrantIds: [] });
  });

  it("shows Mel both questions read-only, waiting on an officer (FR-006)", async () => {
    for (const [reason, candidates] of [
      ["two_logins", SIGN_INS],
      ["role_conflict", GRANTS],
    ] as const) {
      stub(() => DETAIL({ reason, answerableBy: "role.assign", canAnswer: false, candidates }));
      const { unmount } = render(
        <HeldMergeChooser holdId="h1" onDone={vi.fn()} onClose={vi.fn()} />,
      );
      const dialog = await screen.findByRole("dialog", { name: /held merge/i });
      expect(within(dialog).getByText(/waiting on an officer/i)).toBeInTheDocument();
      expect(within(dialog).queryByRole("button", { name: /confirm and merge/i })).toBeNull();
      for (const control of [
        ...within(dialog).queryAllByRole("radio"),
        ...within(dialog).queryAllByRole("checkbox"),
      ]) {
        expect(control).toBeDisabled();
      }
      expect(
        within(dialog).queryAllByRole("radio").length +
          within(dialog).queryAllByRole("checkbox").length,
        "Mel should still see what is being decided",
      ).toBeGreaterThan(0);
      unmount();
    }
  });
});

/** Feature 078, User Story 3 (FR-011, FR-012). */
describe("the volunteer panel", () => {
  const VOLUNTEER = { approvedAt: "2026-03-01T15:00:00.000Z", approvedBy: "Pat Approver" };

  it("says completing makes the kept contact a volunteer, shows the approval carried, and posts the carry", async () => {
    const calls = stub(
      () =>
        DETAIL({ reason: "volunteer_status", answerableBy: "role.assign", candidates: VOLUNTEER }),
      () => ({ body: { outcome: "completed", canonicalId: "c-a", moved: {} } }),
    );
    openChooser();
    const user = userEvent.setup();
    const dialog = await screen.findByRole("dialog", { name: /held merge/i });
    expect(within(dialog).getByText(/makes Robert Jones a volunteer/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/2026-03-01/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Pat Approver/)).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: /carry volunteer status and merge/i }),
    );
    const post = calls.find((c) => c.url.endsWith("/resolve"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ carryVolunteer: true });
  });

  it("shows Mel the question waiting on an officer, with no way to answer", async () => {
    stub(() =>
      DETAIL({
        reason: "volunteer_status",
        answerableBy: "role.assign",
        canAnswer: false,
        candidates: VOLUNTEER,
      }),
    );
    openChooser();
    const dialog = await screen.findByRole("dialog", { name: /held merge/i });
    expect(within(dialog).getByText(/Pat Approver/)).toBeInTheDocument();
    expect(within(dialog).getByText(/waiting on an officer/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /carry volunteer/i })).toBeNull();
  });
});

/** Feature 078, User Story 4 (FR-015). */
describe("the super-user panel", () => {
  it("shows the command-line instruction and Don't merge, and no answer — even to an officer", async () => {
    stub(() =>
      DETAIL({
        reason: "super_user",
        answerableBy: "command_line",
        canAnswer: false,
        candidates: {
          instruction:
            "Super-user can only be granted at the command line. Run pnpm auth:bootstrap.",
        },
      }),
    );
    openChooser();
    const dialog = await screen.findByRole("dialog", { name: /held merge/i });
    expect(within(dialog).getByText(/pnpm auth:bootstrap/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /don't merge/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("radio")).toBeNull();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Don't merge", "Close"]);
  });
});
