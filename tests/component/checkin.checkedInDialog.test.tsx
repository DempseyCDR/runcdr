// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CheckinPage from "@/app/(door)/checkin/page";
import { BREAKDOWN } from "./fixtures/attendanceBreakdown";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; init?: RequestInit };
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

const ATTENDEES = [
  {
    id: "a1",
    contactId: "c1",
    firstName: "Robert",
    lastName: "Frost",
    displayName: "Zed",
    displayNameOverride: "Zed",
    childrenCount: 2,
    isOpenBand: false,
  },
  {
    id: "a2",
    contactId: null,
    firstName: null,
    lastName: null,
    displayName: null,
    displayNameOverride: null,
    childrenCount: 0,
    isOpenBand: false,
  },
];

function stub(): { calls: Call[]; setPaying: (n: number) => void } {
  const calls: Call[] = [];
  let paying = 33;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.includes("/attendance-breakdown")) return json(BREAKDOWN({ paying }));
      if (u.includes("/group-siblings")) return json({ items: [] });
      if (/\/api\/attendance\/a1$/.test(u)) return json({ id: "a1" });
      if (/\/api\/events\/e1\/attendance\?/.test(u))
        return json({ count: 2, attendees: ATTENDEES });
      if (u.includes("/api/attendance/search")) return json({ items: [], truncated: false });
      if (u.includes("/api/events"))
        return json({
          items: [
            { id: "e1", eventDate: "2020-01-15", seriesId: "s1", startTime: null, label: null },
          ],
        });
      if (u.includes("/api/series"))
        return json({ items: [{ id: "s1", key: "tnc", name: "TNC" }] });
      return json({ items: [] });
    }),
  );
  return { calls, setPaying: (n) => (paying = n) };
}

const rosterCalls = (calls: Call[]) =>
  calls.filter((c) => /\/api\/events\/e1\/attendance\?sort=/.test(c.url) && !c.init?.method);
/** The breakdown region's text, once it has loaded — its labels and numbers are separate elements. */
const breakdownShows = (dialog: HTMLElement, text: RegExp) =>
  waitFor(() =>
    expect(within(dialog).getByRole("region", { name: /attendance/i })).toHaveTextContent(text),
  );
const breakdownCalls = (calls: Call[]) =>
  calls.filter((c) => c.url.includes("/attendance-breakdown"));

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: /TNC/ });
  await user.click(screen.getByRole("button", { name: /show checked in/i }));
  return screen.findByRole("dialog", { name: /checked in/i });
}

/**
 * Feature 079, User Story 3 (FR-018–FR-021): who is in, with the evening's breakdown at the top, sortable three
 * ways, and every correction made from the list.
 */
describe("the checked-in dialog (079)", () => {
  it("lists check-ins by display name by default, and sorts by first or last name", async () => {
    const { calls } = stub();
    const user = userEvent.setup();
    render(<CheckinPage />);
    const dialog = await openDialog(user);

    await waitFor(() => expect(rosterCalls(calls).at(-1)?.url).toMatch(/sort=display/));
    const list = await within(dialog).findByRole("list", { name: /checked in/i });
    const [zed, anon] = within(list).getAllByRole("listitem");
    expect(within(zed!).getByText(/^Zed/)).toBeInTheDocument();
    expect(within(zed!).getByText("Robert Frost")).toBeInTheDocument();
    expect(zed).toHaveTextContent(/\+2/);
    expect(anon).toHaveTextContent(/anonymous/i);

    await user.click(within(dialog).getByRole("button", { name: /^first name$/i }));
    await waitFor(() => expect(rosterCalls(calls).at(-1)?.url).toMatch(/sort=first/));
    await user.click(within(dialog).getByRole("button", { name: /^last name$/i }));
    await waitFor(() => expect(rosterCalls(calls).at(-1)?.url).toMatch(/sort=last/));
  });

  it("shows the attendance breakdown at the top", async () => {
    stub();
    const user = userEvent.setup();
    render(<CheckinPage />);
    const dialog = await openDialog(user);
    const breakdown = await within(dialog).findByRole("region", { name: /attendance/i });
    expect(breakdown).toHaveTextContent(/Paying 33/);
    const list = within(dialog).getByRole("list", { name: /checked in/i });
    expect(breakdown.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens the correction dialog from an attendee, and refreshes list and breakdown after a change", async () => {
    const { calls, setPaying } = stub();
    const user = userEvent.setup();
    render(<CheckinPage />);
    const dialog = await openDialog(user);
    await breakdownShows(dialog, /Paying 33/);
    const rosterBefore = rosterCalls(calls).length;
    const breakdownBefore = breakdownCalls(calls).length;

    await user.click(within(dialog).getByRole("button", { name: /Zed/ }));
    const correction = await screen.findByRole("dialog", { name: /correct attendance/i });
    await user.clear(within(correction).getByLabelText(/edit children/i));
    await user.type(within(correction).getByLabelText(/edit children/i), "1");
    setPaying(32);
    await user.click(within(correction).getByRole("button", { name: /save children/i }));

    await waitFor(() => expect(rosterCalls(calls).length).toBeGreaterThan(rosterBefore));
    await waitFor(() => expect(breakdownCalls(calls).length).toBeGreaterThan(breakdownBefore));
    await breakdownShows(screen.getByRole("dialog", { name: /checked in/i }), /Paying 32/);
  });

  it("fetches fresh data each time it is opened (FR-021)", async () => {
    const { calls } = stub();
    const user = userEvent.setup();
    render(<CheckinPage />);
    const dialog = await openDialog(user);
    await breakdownShows(dialog, /Paying 33/);
    const first = breakdownCalls(calls).length;
    await user.click(within(dialog).getByRole("button", { name: /^close$/i }));
    expect(screen.queryByRole("dialog", { name: /checked in/i })).toBeNull();

    await openDialog(user);
    await waitFor(() => expect(breakdownCalls(calls).length).toBeGreaterThan(first));
  });
});
