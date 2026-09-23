// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContactsPage from "@/app/(admin)/contacts/page";

afterEach(() => vi.unstubAllGlobals());

type Rec = {
  id: string;
  firstName: string;
  lastName: string | null;
  displayName: string;
  displayNameOverride: string | null;
  pronouns: string | null;
  phone: string | null;
  isVolunteer: boolean;
  membershipStatus: string;
  listMember: boolean;
  needsReview: boolean;
  volunteerApprovedAt: string | null;
  volunteerApprovedBy: string | null;
  archivedAt: string | null;
};

const REC = (over: Partial<Rec> = {}): Rec => ({
  id: "c1",
  firstName: "Jon",
  lastName: "Smith",
  displayName: "Jon Smith",
  displayNameOverride: null,
  pronouns: "he/him",
  phone: "+15855551234",
  isVolunteer: false,
  membershipStatus: "current",
  listMember: true,
  needsReview: false,
  volunteerApprovedAt: null,
  volunteerApprovedBy: null,
  archivedAt: null,
  ...over,
});

const summary = (r: Rec) => ({
  id: r.id,
  displayName: r.displayName,
  membershipStatus: r.membershipStatus,
  listMember: r.listMember,
  pronouns: r.pronouns,
  archivedAt: r.archivedAt,
});
// Feature 069: the row projects what the decision depends on (FR-001), so a pair fixture carries it.
const dup = (id: string, name: string) => ({
  id,
  displayName: name,
  membershipStatus: "never",
  membershipLevel: null,
  phone: null,
  emails: [] as string[],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  hasLogin: false,
  hasUnshownAddress: false,
  messageRecipient: null,
});
const pair = (a: string, b: string, ids: [string, string]) => ({
  a: dup(ids[0], a),
  b: dup(ids[1], b),
  similarity: 0.9,
  sharedHousehold: { email: false, account: false },
  rejected: null,
  safeToReject: true,
  safeToMerge: true,
});

type Call = { url: string; init?: RequestInit };
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

// One stub for every endpoint the launcher touches. Order matters (specific paths before generic ones).
function stub(opts: {
  items?: unknown[];
  review?: unknown[];
  pairs?: unknown[];
  record?: Rec;
  counts?: { needsReview: number; duplicates: number };
  caps?: {
    contactWrite?: boolean;
    contactDelete?: boolean;
    contactDeleteUnrestricted?: boolean;
    dedupWrite?: boolean;
  };
  deleteStatus?: number; // 200 ok, or 409 refusal
}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push({ url: u, init });
      if (u.includes("/api/contacts/launcher-counts"))
        return json({
          needsReview: opts.counts?.needsReview ?? 0,
          duplicates: opts.counts?.duplicates ?? 0,
        });
      if (u.includes("/api/me/capabilities"))
        return json({
          contactWrite: opts.caps?.contactWrite ?? false,
          contactDelete: opts.caps?.contactDelete ?? false,
          contactDeleteUnrestricted: opts.caps?.contactDeleteUnrestricted ?? false,
          dedupWrite: opts.caps?.dedupWrite ?? false,
        });
      if (u.includes("/api/dedup/merge")) return json({});
      if (u.includes("/api/dedup/suggestions")) return json({ pairs: opts.pairs ?? [] });
      if (/\/api\/contacts\/[^/?]+\/reviewed$/.test(u)) return json({});
      if (/\/api\/contacts\/[^/?]+\/(archive|restore)$/.test(u)) return json({});
      if (method === "DELETE" && /\/api\/contacts\/[^/?]+/.test(u))
        return (opts.deleteStatus ?? 200) === 200
          ? json({ ok: true })
          : json(
              {
                error: {
                  code: "CONTACT_HAS_REFERENCES",
                  message: "Contact has membership — merge or archive it instead.",
                },
              },
              opts.deleteStatus ?? 409,
            );
      if (u.includes("needsReview=1")) return json({ items: opts.review ?? [] });
      if (u.includes("/api/contacts?")) return json({ items: opts.items ?? [] });
      if (method === "PATCH" && /\/api\/contacts\/[^/?]+$/.test(u))
        return json({ ...(opts.record ?? REC()), ...JSON.parse(String(init?.body)) });
      if (method === "POST" && u.endsWith("/api/contacts")) return json({ id: "new" }, 201);
      if (/\/api\/contacts\/[^/?]+$/.test(u)) return json(opts.record ?? REC());
      return json({ items: [] });
    }),
  );
  return calls;
}

const search = () => screen.getByPlaceholderText(/search by name/i);
const patchBody = (calls: Call[]) =>
  String(calls.find((c) => c.init?.method === "PATCH")?.init?.body ?? "");

/** Open a record by typing (to surface the search list) then clicking its row; returns the dialog. */
async function openViaSearch(name: RegExp | string) {
  await userEvent.type(search(), "x");
  await userEvent.click(await screen.findByRole("button", { name }));
  return await screen.findByRole("dialog", { name });
}

describe("contacts launcher — initial state (feature 064)", () => {
  it("shows only header + search + task buttons, no lists or create form (C8)", async () => {
    stub({ counts: { needsReview: 3, duplicates: 2 } });
    render(<ContactsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /review queue/i })).toHaveTextContent("(3)"),
    );
    expect(screen.getByRole("button", { name: /add contact/i })).toBeInTheDocument();
    expect(screen.queryByText(/potential duplicates/i)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByPlaceholderText("First name")).toBeNull(); // create form not inline
  });

  it("renders the two counts on the review buttons (C9)", async () => {
    stub({ counts: { needsReview: 5, duplicates: 1 } });
    render(<ContactsPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /review queue/i })).toHaveTextContent("(5)"),
    );
    expect(screen.getByRole("button", { name: /review duplicates/i })).toHaveTextContent("(1)");
  });
});

describe("contacts launcher — review queue (feature 064)", () => {
  it("tapping Review queue lists needs-review contacts; a row opens the editor (C10)", async () => {
    stub({ review: [summary(REC({ needsReview: true }))], record: REC({ needsReview: true }) });
    render(<ContactsPage />);
    await userEvent.click(screen.getByRole("button", { name: /review queue/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Jon Smith/ }));
    expect(await screen.findByRole("dialog", { name: /Jon Smith/ })).toBeInTheDocument();
  });

  it("Mark reviewed clears the flag, drops the count, and the row leaves the queue (C15/C16/C14)", async () => {
    const calls = stub({
      review: [summary(REC({ needsReview: true }))],
      record: REC({ needsReview: true }),
      counts: { needsReview: 1, duplicates: 0 },
    });
    render(<ContactsPage />);
    await userEvent.click(screen.getByRole("button", { name: /review queue/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Jon Smith/ }));
    const dialog = await screen.findByRole("dialog", { name: /Jon Smith/ });
    calls.length = 0; // assert only the post-action calls
    await userEvent.click(within(dialog).getByRole("button", { name: /mark reviewed/i }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/reviewed") && c.init?.method === "POST")).toBe(
        true,
      ),
    );
    // count refreshed + list re-fetched (F1/F2)
    await waitFor(() => expect(calls.some((c) => c.url.includes("launcher-counts"))).toBe(true));
    expect(calls.some((c) => c.url.includes("needsReview=1"))).toBe(true);
  });
});

describe("contacts launcher — duplicates view (feature 064)", () => {
  it("tapping Review duplicates shows the global pairs; merge removes it + refreshes counts (C11/C14)", async () => {
    const calls = stub({
      pairs: [pair("Jon Smith", "John Smith", ["a1", "b1"])],
      counts: { needsReview: 0, duplicates: 1 },
      caps: { dedupWrite: true },
    });
    render(<ContactsPage />);
    await userEvent.click(screen.getByRole("button", { name: /review duplicates/i }));
    await screen.findByRole("listitem", { name: /Jon Smith and John Smith/i });
    calls.length = 0;
    await userEvent.click(screen.getByRole("button", { name: /keep jon smith/i }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.includes("/api/dedup/merge") &&
            c.init?.method === "POST" &&
            String(c.init?.body).includes('"canonicalId":"a1"'),
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(calls.some((c) => c.url.includes("launcher-counts"))).toBe(true));
  });

  it("shows an empty state when there are no global pairs", async () => {
    stub({ pairs: [] });
    render(<ContactsPage />);
    await userEvent.click(screen.getByRole("button", { name: /review duplicates/i }));
    expect(await screen.findByText(/no potential duplicates/i)).toBeInTheDocument();
  });
});

describe("contacts launcher — search hybrid + exclusivity (feature 064)", () => {
  it("typing shows single results with query-scoped pairs alongside (C12)", async () => {
    stub({
      items: [summary(REC({ id: "1", displayName: "Jon Smith" }))],
      pairs: [pair("Jon Smith", "John Smith", ["1", "2"])],
    });
    render(<ContactsPage />);
    await userEvent.type(search(), "smith");
    expect(await screen.findByText(/Potential duplicates/i)).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /Jon Smith and John Smith/i })).toBeInTheDocument();
  });

  it("clearing the search box returns to the bare launcher (C12)", async () => {
    stub({ items: [summary(REC({ displayName: "Ada Lovelace" }))] });
    render(<ContactsPage />);
    await userEvent.type(search(), "ada");
    await screen.findByText(/Ada Lovelace/);
    await userEvent.clear(search());
    await waitFor(() => expect(screen.queryByText(/Ada Lovelace/)).toBeNull());
    expect(screen.getByRole("button", { name: /review queue/i })).toBeInTheDocument();
  });
});

describe("contacts launcher — add contact modal (feature 064)", () => {
  it("Add contact opens a modal; submit creates, closes, and refreshes (C13/C14)", async () => {
    const calls = stub({ counts: { needsReview: 0, duplicates: 0 } });
    render(<ContactsPage />);
    await userEvent.click(screen.getByRole("button", { name: /add contact/i }));
    const dialog = await screen.findByRole("dialog", { name: /add contact/i });
    await userEvent.type(within(dialog).getByPlaceholderText("First name"), "Grace");
    calls.length = 0;
    await userEvent.click(within(dialog).getByRole("button", { name: /^create$/i }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/api/contacts") && c.init?.method === "POST")).toBe(
        true,
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /add contact/i })).toBeNull());
    expect(calls.some((c) => c.url.includes("launcher-counts"))).toBe(true);
  });

  it("Cancel closes the create modal without a POST", async () => {
    const calls = stub({});
    render(<ContactsPage />);
    await userEvent.click(screen.getByRole("button", { name: /add contact/i }));
    const dialog = await screen.findByRole("dialog", { name: /add contact/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /add contact/i })).toBeNull());
    expect(calls.some((c) => c.init?.method === "POST")).toBe(false);
  });
});

// Feature 063 editor coverage, adapted to the 064 open-via-search flow.
describe("record editor (feature 063, via launcher)", () => {
  it("opens pre-filled with a formatted phone", async () => {
    stub({ items: [summary(REC())], record: REC() });
    render(<ContactsPage />);
    const dialog = await openViaSearch(/Jon Smith/);
    expect(within(dialog).getByDisplayValue("Jon")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("585-555-1234")).toBeInTheDocument();
    for (const label of ["First name", "Last name", "Display name", "Pronouns", "Phone"])
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
  });

  it("Save issues one PATCH with the edited fields", async () => {
    const calls = stub({ items: [summary(REC())], record: REC() });
    render(<ContactsPage />);
    const dialog = await openViaSearch(/Jon Smith/);
    const last = within(dialog).getByLabelText("Last name");
    await userEvent.clear(last);
    await userEvent.type(last, "Smithe");
    await userEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(patchBody(calls)).toContain('"lastName":"Smithe"'));
  });

  it("Automatic → Set custom name → Save sends the override", async () => {
    const calls = stub({ items: [summary(REC())], record: REC() });
    render(<ContactsPage />);
    const dialog = await openViaSearch(/Jon Smith/);
    await userEvent.click(within(dialog).getByRole("button", { name: /set custom name/i }));
    await userEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(patchBody(calls)).toContain('"displayNameOverride":"Jon Smith"'));
  });

  it("is_volunteer is read-only (no toggle) and never sent on Save", async () => {
    const calls = stub({
      items: [summary(REC({ isVolunteer: true }))],
      record: REC({ isVolunteer: true }),
    });
    render(<ContactsPage />);
    const dialog = await openViaSearch(/Jon Smith/);
    expect(within(dialog).queryByRole("checkbox", { name: /volunteer/i })).toBeNull();
    expect(within(dialog).getByText(/volunteer:/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(patchBody(calls)).not.toContain("isVolunteer"));
  });

  it("Escape closes the editor modal", async () => {
    stub({ items: [summary(REC())], record: REC() });
    render(<ContactsPage />);
    await openViaSearch(/Jon Smith/);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Jon Smith/ })).toBeNull());
  });

  it("shows Mark reviewed only for a flagged contact", async () => {
    stub({ items: [summary(REC({ needsReview: true }))], record: REC({ needsReview: true }) });
    render(<ContactsPage />);
    const dialog = await openViaSearch(/Jon Smith/);
    expect(within(dialog).getByRole("button", { name: /mark reviewed/i })).toBeInTheDocument();
  });
});

// Feature 065: archive / restore toggle + delete controls, capability-gated.
describe("contacts launcher — archive & delete (feature 065)", () => {
  it("marks archived rows and searches with ?archived=1 when the toggle is on (C10)", async () => {
    const calls = stub({ items: [summary(REC({ archivedAt: "2026-01-01T00:00:00Z" }))] });
    render(<ContactsPage />);
    await userEvent.click(screen.getByRole("button", { name: /\+ archived/i }));
    await userEvent.type(search(), "jon");
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/contacts?") && c.url.includes("archived=1")),
      ).toBe(true),
    );
    expect(await screen.findByText(/· archived/)).toBeInTheDocument(); // the row marker, not the toggle
  });

  it("editor shows Archive for an active contact when contactWrite (C11)", async () => {
    stub({ items: [summary(REC())], record: REC(), caps: { contactWrite: true } });
    render(<ContactsPage />);
    const dialog = await openViaSearch(/Jon Smith/);
    expect(within(dialog).getByRole("button", { name: /^archive$/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^restore$/i })).toBeNull();
  });

  it("editor shows Restore for an archived contact (C11)", async () => {
    const rec = REC({ archivedAt: "2026-01-01T00:00:00Z" });
    stub({ items: [summary(rec)], record: rec, caps: { contactWrite: true } });
    render(<ContactsPage />);
    const dialog = await openViaSearch(/Jon Smith/);
    expect(within(dialog).getByRole("button", { name: /^restore$/i })).toBeInTheDocument();
  });

  it("Delete is gated by contactDelete and requires an explicit confirm (C12)", async () => {
    const noDelete = stub({ items: [summary(REC())], record: REC(), caps: { contactWrite: true } });
    const { unmount } = render(<ContactsPage />);
    let dialog = await openViaSearch(/Jon Smith/);
    expect(within(dialog).queryByRole("button", { name: /^delete$/i })).toBeNull();
    unmount();
    noDelete.length = 0;

    const calls = stub({ items: [summary(REC())], record: REC(), caps: { contactDelete: true } });
    render(<ContactsPage />);
    dialog = await openViaSearch(/Jon Smith/);
    await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    // No DELETE yet — a confirm step is required first.
    expect(calls.some((c) => c.init?.method === "DELETE")).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: /confirm delete/i }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "DELETE")).toBe(true));
  });

  // Feature 067 follow-up: the refusal used to render ~100 lines of JSX below the button, after the
  // whole read-only context list — so on a scrolling modal Mel clicked Confirm delete and saw nothing.
  it("shows the refusal ABOVE the record fields, where the action was taken", async () => {
    stub({
      items: [summary(REC())],
      record: REC(),
      caps: { contactDelete: true },
      deleteStatus: 409,
    });
    render(<ContactsPage />);
    const dialog = await openViaSearch(/Jon Smith/);
    await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await userEvent.click(within(dialog).getByRole("button", { name: /confirm delete/i }));

    const reason = await within(dialog).findByText(/merge or archive/i);
    const firstField = within(dialog).getByDisplayValue("Jon");
    // DOCUMENT_POSITION_FOLLOWING === 4: the reason comes before the form fields.
    expect(reason.compareDocumentPosition(firstField) & 4).toBeTruthy();
  });

  // Feature 068 follow-up: the record shows WHETHER someone is a volunteer, which anyone viewing needs;
  // the annual approval audit trail is governance detail that does not belong on this screen.
  it("does not show volunteer-approval detail on the record", async () => {
    stub({ items: [summary(REC())], record: REC(), caps: { contactWrite: true } });
    render(<ContactsPage />);
    const dialog = await openViaSearch(/Jon Smith/);
    expect(within(dialog).queryByText(/volunteer approved/i)).toBeNull();
  });

  it("a refused safe delete shows the reason; a super-user gets a force option (C13)", async () => {
    const calls = stub({
      items: [summary(REC())],
      record: REC(),
      caps: { contactDelete: true, contactDeleteUnrestricted: true },
      deleteStatus: 409,
    });
    render(<ContactsPage />);
    const dialog = await openViaSearch(/Jon Smith/);
    await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await userEvent.click(within(dialog).getByRole("button", { name: /confirm delete/i }));
    await waitFor(() => expect(within(dialog).getByText(/merge or archive/i)).toBeInTheDocument());
    const force = within(dialog).getByRole("button", { name: /force delete/i });
    calls.length = 0;
    await userEvent.click(force);
    await waitFor(() =>
      expect(calls.some((c) => c.init?.method === "DELETE" && c.url.includes("force=1"))).toBe(
        true,
      ),
    );
  });
});

/**
 * Feature 069 (FR-001a / FR-005 / FR-007). The review queue's rows carry what "is this complete?" rests
 * on, and offer their one action only when they do. A sparse record — the very thing that lands in this
 * queue — has nothing on the row to judge, so it sends Mel to the record instead.
 */
describe("contacts review queue — rows show and adapt (feature 069)", () => {
  const reviewRow = (over: Partial<Record<string, unknown>> = {}) => ({
    id: "r1",
    displayName: "Dana Ash",
    membershipStatus: "never",
    listMember: false,
    pronouns: null,
    archivedAt: null,
    phone: "+15855550100",
    emails: ["dana@example.com"],
    createdAt: "2019-04-02T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    safeToClear: true,
    ...over,
  });

  const openReview = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(await screen.findByRole("button", { name: /review queue/i }));

  it("shows how the contact is reached and how old the record is", async () => {
    stub({ review: [reviewRow()], counts: { needsReview: 1, duplicates: 0 } });
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openReview(user);
    expect(await screen.findByText(/dana@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/555.*0100/)).toBeInTheDocument();
    expect(screen.getByText(/2019-04-02/)).toBeInTheDocument();
  });

  it("offers Clear on a complete row and Open to resolve on a sparse one", async () => {
    stub({
      review: [
        reviewRow(),
        reviewRow({
          id: "r2",
          displayName: "Nameonly",
          phone: null,
          emails: [],
          safeToClear: false,
        }),
      ],
      counts: { needsReview: 2, duplicates: 0 },
    });
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openReview(user);

    const complete = await screen.findByRole("listitem", { name: /Dana Ash/i });
    expect(within(complete).getByRole("button", { name: /^clear$/i })).toBeInTheDocument();

    const sparse = screen.getByRole("listitem", { name: /Nameonly/i });
    expect(within(sparse).getByRole("button", { name: /open to resolve/i })).toBeInTheDocument();
    expect(within(sparse).queryByRole("button", { name: /^clear$/i })).toBeNull();
  });

  it("clears a complete row in place without opening it", async () => {
    const calls = stub({ review: [reviewRow()], counts: { needsReview: 1, duplicates: 0 } });
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openReview(user);
    await user.click(await screen.findByRole("button", { name: /^clear$/i }));
    expect(calls.some((c) => /\/api\/contacts\/r1\/reviewed$/.test(c.url))).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

/**
 * Feature 069 (FR-014). The needs-review queue renders two kinds of task. A held merge is not a flagged
 * contact: it names both contacts and why it stopped, and — for the sign-in case — says plainly that it
 * is waiting on someone else, so Mel is not left tapping an action she cannot complete (FR-013).
 */
describe("held merges in the review queue (feature 069)", () => {
  // Feature 078 (research R8): the server says who can answer each hold; the page no longer derives it.
  const HELD = (over: Partial<Record<string, unknown>> = {}) => ({
    id: "h1",
    reason: "two_logins",
    answerableBy: "role.assign",
    canAnswer: false,
    canonicalId: "c-terry",
    canonicalDisplayName: "Terry Vale",
    mergedId: "c-terri",
    mergedDisplayName: "Terri Vale",
    ...over,
  });

  function stubWithHeld(held: unknown[], roleAssign: boolean) {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? "GET";
        calls.push({ url: u, init });
        if (u.includes("/api/contacts/launcher-counts"))
          return json({ needsReview: 1, duplicates: 0 });
        if (u.includes("/api/me/capabilities"))
          return json({ contactWrite: true, roleAssign, dedupWrite: true });
        if (/\/api\/dedup\/held\/[^/]+$/.test(u) && method === "GET") {
          const h = (held as { id: string }[]).find((x) => u.endsWith(`/${x.id}`)) as Record<
            string,
            unknown
          >;
          return json({
            ...h,
            canonical: { id: h.canonicalId, displayName: h.canonicalDisplayName },
            merged: { id: h.mergedId, displayName: h.mergedDisplayName },
            answered: [],
            candidates: [],
          });
        }
        if (u.includes("/api/dedup/held"))
          return json(method === "DELETE" ? { ok: true } : { held });
        if (u.includes("needsReview=1")) return json({ items: [] });
        return json({ items: [] });
      }),
    );
    return calls;
  }

  const openReview = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(await screen.findByRole("button", { name: /review queue/i }));

  /**
   * Feature 072 (FR-018) — found in the manual pass. A held merge returns 200 with `outcome: "held"`,
   * and the page treated any 200 as success: the list silently refreshed and Mel saw nothing at all. She
   * only discovered the merge had stopped by later noticing an item in the review queue.
   */
  it("tells the user immediately when a merge is HELD rather than completing", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        calls.push({ url: u, init });
        if (u.includes("/api/contacts/launcher-counts"))
          return json({ needsReview: 0, duplicates: 1 });
        if (u.includes("/api/me/capabilities"))
          return json({ contactWrite: true, roleAssign: false, dedupWrite: true });
        if (u.includes("/api/dedup/merge"))
          return json({ outcome: "held", reason: "role_conflict", heldMergeId: "h9" });
        if (u.includes("/api/dedup/suggestions"))
          return json({ pairs: [pair("Jon Smith", "John Smith", ["a1", "b1"])], suppressed: 0 });
        return json({ items: [] });
      }),
    );
    const user = userEvent.setup();
    render(<ContactsPage />);
    await user.click(await screen.findByRole("button", { name: /review duplicates/i }));
    await user.click(await screen.findByRole("button", { name: /keep Jon Smith/i }));

    expect(await screen.findByText(/not merged/i)).toBeInTheDocument();
  });

  it("lets a dedup worker WITHDRAW a held merge without resolving it (FR-017)", async () => {
    const calls = stubWithHeld([HELD()], false);
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openReview(user);

    const row = await screen.findByRole("listitem", { name: /held merge/i });
    // She cannot answer the question — but she may withdraw it, rather than leaving an item she can
    // never clear sitting in her queue.
    expect(within(row).queryByRole("button", { name: /resolve/i })).toBeNull();
    await user.click(within(row).getByRole("button", { name: /don't merge|withdraw/i }));

    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/dedup/held/h1") && c.init?.method === "DELETE"),
      ).toBe(true),
    );
  });

  it("names both contacts and the reason it stopped", async () => {
    stubWithHeld([HELD()], true);
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openReview(user);

    const row = await screen.findByRole("listitem", {
      name: /held merge: Terry Vale and Terri Vale/i,
    });
    expect(within(row).getByText(/both contacts sign in/i)).toBeInTheDocument();
  });

  it("offers the resolution only to whoever may make it (FR-013)", async () => {
    stubWithHeld([HELD()], false);
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openReview(user);

    const row = await screen.findByRole("listitem", { name: /held merge/i });
    expect(within(row).queryByRole("button", { name: /resolve/i })).toBeNull();
    expect(within(row).getByText(/waiting on an officer/i)).toBeInTheDocument();
  });

  it("lets a dedup worker resolve a two-account hold", async () => {
    stubWithHeld(
      [HELD({ id: "h2", reason: "two_accounts", answerableBy: "dedup.write", canAnswer: true })],
      false,
    );
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openReview(user);

    const row = await screen.findByRole("listitem", { name: /held merge/i });
    expect(
      within(row).getByText(/both contacts pay for a membership account/i),
    ).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /resolve/i })).toBeInTheDocument();
  });

  /**
   * Feature 078 (FR-001). Resolve used to open the canonical contact's RECORD — there was no screen that
   * asked the hold's question, so the only thing anyone could do with a hold was decline it.
   */
  it("opens the hold's chooser from Resolve, not a contact record", async () => {
    const calls = stubWithHeld(
      [HELD({ id: "h2", reason: "two_accounts", answerableBy: "dedup.write", canAnswer: true })],
      false,
    );
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openReview(user);

    const row = await screen.findByRole("listitem", { name: /held merge/i });
    await user.click(within(row).getByRole("button", { name: /resolve/i }));

    expect(await screen.findByRole("dialog", { name: /held merge/i })).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/api/dedup/held/h2"))).toBe(true);
    expect(calls.some((c) => /\/api\/contacts\/c-terry$/.test(c.url))).toBe(false);
  });

  it("lets someone who cannot answer still open the hold to see what is waiting (FR-006)", async () => {
    const calls = stubWithHeld([HELD()], false);
    const user = userEvent.setup();
    render(<ContactsPage />);
    await openReview(user);

    const row = await screen.findByRole("listitem", { name: /held merge/i });
    await user.click(within(row).getByRole("button", { name: /view/i }));
    expect(await screen.findByRole("dialog", { name: /held merge/i })).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/api/dedup/held/h1"))).toBe(true);
  });
});

/**
 * Feature 086 US4 (FR-003, FR-004): a link that names a contact opens it.
 *
 * Feature 084 gave the performer form a link to the contact behind it — `/contacts?contactId=…` — and
 * the directory read no parameter at all, so it landed on the unfiltered list as though nothing had
 * been asked for. Arriving by link now converges on the very path a clicked row takes.
 */
describe("ContactsPage — a contact named in the address (086)", () => {
  const withAddress = (search: string) => {
    window.history.replaceState({}, "", `/contacts${search}`);
  };
  afterEach(() => window.history.replaceState({}, "", "/contacts"));

  it("opens the named contact on arrival (FR-003)", async () => {
    stub({ record: REC({ id: "c9", displayName: "Clara Riedlinger" }) });
    withAddress("?contactId=c9");
    render(<ContactsPage />);

    expect(await screen.findByRole("dialog")).toHaveTextContent("Clara Riedlinger");
  });

  it("opens an ARCHIVED contact and says that it is archived (FR-003)", async () => {
    stub({
      record: REC({
        id: "c9",
        displayName: "Retired Ruth",
        archivedAt: "2026-01-01T00:00:00.000Z",
      }),
    });
    withAddress("?contactId=c9");
    render(<ContactsPage />);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Retired Ruth");
    expect(dialog).toHaveTextContent(/archived/i);
  });

  it("says so when the named contact cannot be found (FR-004)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/api/contacts/launcher-counts"))
          return json({ needsReview: 0, duplicates: 0 });
        if (u.includes("/api/me/capabilities")) return json({});
        if (/\/api\/contacts\/[^/?]+$/.test(u)) return json({ error: { code: "NOT_FOUND" } }, 404);
        return json({ items: [] });
      }),
    );
    withAddress("?contactId=gone");
    render(<ContactsPage />);

    // Not a silent unfiltered list: the directory says the request could not be met, and still works.
    expect(await screen.findByText(/could not be opened|not found/i)).toBeInTheDocument();
    expect(search()).toBeInTheDocument();
  });

  it("is untouched when no contact is named", async () => {
    stub({ items: [] });
    render(<ContactsPage />);

    await waitFor(() => expect(search()).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
