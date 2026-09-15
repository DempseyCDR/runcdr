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

const EVENT = {
  id: "e1",
  eventDate: "2020-01-15",
  seriesId: "s-tnc",
  startTime: null,
  label: null,
};
const MATCH = (over: Record<string, unknown> = {}) => ({
  id: "c-ann",
  displayName: "Ann Jones",
  firstName: "Ann",
  lastName: "Jones",
  displayNameOverride: null,
  membershipStatus: "current",
  checkedIn: false,
  emails: ["jones@example.com"],
  reachedVia: null,
  ...over,
});
const OWNED = {
  error: {
    code: "EMAIL_ACTIVE_ELSEWHERE",
    message: "Already active on Ann Jones — review as duplicate.",
    other: { contactId: "c-ann", displayName: "Ann Jones", emailId: "em-ann" },
  },
};

type Post = { body: Record<string, unknown> };
function stub(
  opts: {
    matches?: unknown[];
    respond?: (body: Record<string, unknown>) => { body: unknown; status: number };
  } = {},
) {
  const calls: Call[] = [];
  const postsMade: Post[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (init?.method === "POST" && /\/api\/events\/e1\/attendance$/.test(u)) {
        const body = JSON.parse(String(init.body));
        postsMade.push({ body });
        const r = opts.respond?.(body) ?? { body: { id: "a1" }, status: 201 };
        return json(r.body, r.status);
      }
      if (u.includes("/api/attendance/search"))
        return json({ items: opts.matches ?? [MATCH()], truncated: false });
      if (/\/api\/events\/[^/]+\/attendance/.test(u)) return json({ count: 0, attendees: [] });
      if (u.includes("/api/events")) return json({ items: [EVENT] });
      if (u.includes("/api/series"))
        return json({ items: [{ id: "s-tnc", key: "tnc", name: "Thursday Night Contra" }] });
      return json({ items: [] });
    }),
  );
  return { calls, posts: postsMade };
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: /Thursday Night Contra/ });
  await user.click(screen.getByRole("button", { name: /add contact/i }));
  return screen.findByRole("dialog", { name: /add contact/i });
}

const extras = () => screen.getByRole("group", { name: /extras/i });

/**
 * Feature 079, User Story 2 (FR-013–FR-017): the Add contact dialog. It finds an existing contact before a
 * duplicate is made, and an email that belongs to someone else is a question — never silently dropped.
 */
describe("the Add contact dialog (079)", () => {
  it("asks for names, email and phone — no pronouns — and shows the extras it will apply", async () => {
    stub();
    const user = userEvent.setup();
    render(<CheckinPage />);
    await screen.findByRole("heading", { name: /Thursday Night Contra/ });
    await user.type(within(extras()).getByLabelText(/children/i), "2");
    await user.click(within(extras()).getByLabelText(/comp/i));
    const dialog = await openDialog(user);

    for (const label of [/first name/i, /last name/i, /display name/i, /email/i, /phone/i]) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
    expect(within(dialog).queryByLabelText(/pronoun/i)).toBeNull();
    expect(within(dialog).getByText(/with: 2 children · comp/i)).toBeInTheDocument();
  });

  it("suggests existing contacts as Meg types, and checks one in instead (FR-014)", async () => {
    const { calls, posts } = stub({
      matches: [MATCH(), MATCH({ id: "c-al", displayName: "Al Jones", checkedIn: true })],
    });
    const user = userEvent.setup();
    render(<CheckinPage />);
    await screen.findByRole("heading", { name: /Thursday Night Contra/ });
    await user.click(within(extras()).getByLabelText(/gift card/i));
    const dialog = await openDialog(user);

    await user.type(within(dialog).getByLabelText(/last name/i), "Jones");
    const suggestions = await within(dialog).findByRole("list", { name: /did you mean/i });
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/attendance/search") && c.url.includes("eventId=e1")),
      ).toBe(true),
    );
    const [ann, al] = within(suggestions).getAllByRole("listitem");
    expect(within(al!).getByLabelText(/already checked in/i)).toBeInTheDocument();

    await user.click(within(ann!).getByRole("button", { name: /check in/i }));
    await waitFor(() =>
      expect(posts.map((p) => p.body)).toEqual([{ contactId: "c-ann", redeemedGiftCard: true }]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /add contact/i })).toBeNull());
  });

  it("lists at most five suggestions", async () => {
    stub({
      matches: Array.from({ length: 8 }, (_, i) => MATCH({ id: `c${i}`, displayName: `Jo ${i}` })),
    });
    const user = userEvent.setup();
    render(<CheckinPage />);
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText(/first name/i), "Jo");
    const suggestions = await within(dialog).findByRole("list", { name: /did you mean/i });
    expect(within(suggestions).getAllByRole("listitem")).toHaveLength(5);
  });

  it("creates and checks in a new contact, then closes and resets the extras row", async () => {
    const { posts } = stub({ matches: [] });
    const user = userEvent.setup();
    render(<CheckinPage />);
    await screen.findByRole("heading", { name: /Thursday Night Contra/ });
    await user.click(within(extras()).getByLabelText(/comp/i));
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText(/first name/i), "Sam");
    await user.type(within(dialog).getByLabelText(/last name/i), "Reel");
    await user.click(within(dialog).getByRole("button", { name: /add and check in/i }));

    await waitFor(() =>
      expect(posts.map((p) => p.body)).toEqual([
        { newContact: { firstName: "Sam", lastName: "Reel" }, isComp: true },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /add contact/i })).toBeNull());
    expect(within(extras()).getByLabelText(/comp/i)).not.toBeChecked();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("searchbox")));
  });

  describe("when the email belongs to someone else (FR-016)", () => {
    async function submitOwnedEmail(user: ReturnType<typeof userEvent.setup>) {
      const dialog = await openDialog(user);
      await user.type(within(dialog).getByLabelText(/first name/i), "Sam");
      await user.type(within(dialog).getByLabelText(/email/i), "jones@example.com");
      await user.click(within(dialog).getByRole("button", { name: /add and check in/i }));
      await within(dialog).findByText(/already belongs to Ann Jones/i);
      return dialog;
    }

    it("offers three answers naming the owner, and creates nothing yet", async () => {
      const { posts } = stub({ matches: [], respond: () => ({ body: OWNED, status: 409 }) });
      const user = userEvent.setup();
      render(<CheckinPage />);
      const dialog = await submitOwnedEmail(user);
      expect(within(dialog).getByRole("button", { name: /it's ann jones/i })).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: /different person sharing it/i }),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: /fix the email/i })).toBeInTheDocument();
      expect(posts).toHaveLength(1);
    });

    it("It's {owner} checks the owner in instead", async () => {
      const { posts } = stub({
        matches: [],
        respond: (b) =>
          b.newContact ? { body: OWNED, status: 409 } : { body: { id: "a1" }, status: 201 },
      });
      const user = userEvent.setup();
      render(<CheckinPage />);
      const dialog = await submitOwnedEmail(user);
      await user.click(within(dialog).getByRole("button", { name: /it's ann jones/i }));
      await waitFor(() => expect(posts.at(-1)?.body).toEqual({ contactId: "c-ann" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: /add contact/i })).toBeNull(),
      );
    });

    it("says so, and offers to close, when that person is already checked in", async () => {
      stub({
        matches: [],
        respond: (b) =>
          b.newContact
            ? { body: OWNED, status: 409 }
            : {
                body: { error: { code: "ALREADY_CHECKED_IN", message: "Already checked in." } },
                status: 409,
              },
      });
      const user = userEvent.setup();
      render(<CheckinPage />);
      await screen.findByRole("heading", { name: /Thursday Night Contra/ });
      await user.click(within(extras()).getByLabelText(/gift card/i));
      const dialog = await submitOwnedEmail(user);
      await user.click(within(dialog).getByRole("button", { name: /it's ann jones/i }));
      expect(
        await within(dialog).findByText(/Ann Jones is already checked in/i),
      ).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: /^close$/i }));
      expect(screen.queryByRole("dialog", { name: /add contact/i })).toBeNull();
      expect(within(extras()).getByLabelText(/gift card/i)).toBeChecked();
    });

    it("Different person sharing it resubmits with shareEmail", async () => {
      const { posts } = stub({
        matches: [],
        respond: (b) =>
          (b.newContact as { shareEmail?: boolean }).shareEmail
            ? { body: { id: "a1" }, status: 201 }
            : { body: OWNED, status: 409 },
      });
      const user = userEvent.setup();
      render(<CheckinPage />);
      const dialog = await submitOwnedEmail(user);
      await user.click(
        within(dialog).getByRole("button", { name: /different person sharing it/i }),
      );
      await waitFor(() =>
        expect(posts.at(-1)?.body).toEqual({
          newContact: { firstName: "Sam", email: "jones@example.com", shareEmail: true },
        }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: /add contact/i })).toBeNull(),
      );
    });

    it("Fix the email returns to the form with the email focused, and sends nothing", async () => {
      const { posts } = stub({ matches: [], respond: () => ({ body: OWNED, status: 409 }) });
      const user = userEvent.setup();
      render(<CheckinPage />);
      const dialog = await submitOwnedEmail(user);
      await user.click(within(dialog).getByRole("button", { name: /fix the email/i }));
      await waitFor(() =>
        expect(document.activeElement).toBe(within(dialog).getByLabelText(/email/i)),
      );
      expect(within(dialog).queryByRole("button", { name: /it's ann jones/i })).toBeNull();
      expect(posts).toHaveLength(1);
    });
  });
});
