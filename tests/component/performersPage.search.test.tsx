// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PerformersPage from "@/app/(admin)/manage/performers/page";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; method: string };

function stub(answer: (q: string) => { items: unknown[]; truncated?: boolean }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? "GET" });
      const q = new URL(u, "http://x").searchParams.get("q") ?? "";
      if (/\/api\/performers\/[^/?]+$/.test(u))
        return { ok: true, status: 200, json: async () => performer("Clara Reidlinger") };
      return { ok: true, status: 200, json: async () => answer(q) };
    }),
  );
  return calls;
}

const performer = (displayName: string) => ({
  id: displayName.toLowerCase().replace(/\W/g, ""),
  displayName,
  bio: null,
  photoUrl: null,
  isPublic: false,
  isCaller: false,
  styles: [],
  links: [],
  contactId: "c1",
  contactName: "Someone",
  archivedAt: null,
});

/**
 * Feature 084 US2 (FR-005 to FR-009): the performers page is reached by searching, as the contact
 * directory is — a roster of several hundred is not something to scroll.
 */
describe("PerformersPage — searching", () => {
  it("opens with the search box focused and no roster listed", async () => {
    const calls = stub(() => ({ items: [performer("Ann Fabray"), performer("Bob Fabinski")] }));
    render(<PerformersPage />);

    const box = await screen.findByLabelText("Search performers");
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.queryByText("Ann Fabray")).toBeNull();
    // FR-005: nothing is fetched until something is typed.
    expect(calls.filter((c) => c.url.includes("/api/performers"))).toHaveLength(0);
  });

  it("lists what matches, in order, once something is typed", async () => {
    stub(() => ({ items: [performer("Ann Fabray"), performer("Bob Fabinski")], truncated: false }));
    const user = userEvent.setup();
    render(<PerformersPage />);

    await user.type(await screen.findByLabelText("Search performers"), "fab");
    expect(await screen.findByText("Ann Fabray")).toBeInTheDocument();
    expect(screen.getByText("Bob Fabinski")).toBeInTheDocument();
  });

  it("says so when more matched than it is showing (FR-007)", async () => {
    stub(() => ({ items: [performer("Ann Fabray")], truncated: true }));
    const user = userEvent.setup();
    render(<PerformersPage />);

    await user.type(await screen.findByLabelText("Search performers"), "a");
    expect(await screen.findByText(/more matched/i)).toBeInTheDocument();
  });

  // Found in the browser walk (T047): the search endpoint answers with SUMMARIES — id and display name —
  // so a row carries no `contactId` and no `archivedAt`. Opening the form on one made every performer look
  // unlinked and archived. The page must load the whole record before it opens the form.
  it("loads the full record before opening the form, not the search summary", async () => {
    const calls = stub(() => ({ items: [{ id: "p-clara", displayName: "Clara Reidlinger" }] }));
    const user = userEvent.setup();
    render(<PerformersPage />);

    await user.type(await screen.findByLabelText("Search performers"), "clara");
    await user.click(await screen.findByRole("button", { name: "Edit" }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/api/performers/p-clara"))).toBe(true),
    );
  });

  it("offers to create the performer when nothing matches, carrying the name (FR-008)", async () => {
    stub(() => ({ items: [], truncated: false }));
    const user = userEvent.setup();
    render(<PerformersPage />);

    await user.type(await screen.findByLabelText("Search performers"), "Newt Player");
    await user.click(await screen.findByRole("button", { name: /Add Newt Player/ }));
    expect(screen.getByLabelText("First name")).toHaveValue("Newt");
    expect(screen.getByLabelText("Last name")).toHaveValue("Player");
  });
});
