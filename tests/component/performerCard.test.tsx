// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { row, stubHub, type HubStub } from "./fixtures/bookingCentral";

/**
 * Feature 087 US3 (FR-019, FR-020, FR-030b) — a performer's card on the hub, and what the search opens.
 *
 * The card replaces the performers page. It is the same form the page used, with two questions added
 * that the old report answered with filters: where has this person played, and which bands are they in.
 * Everything the performers page did is carried over — the full record, not the search summary, and a
 * new performer made from a name that matched nobody (T047a).
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROWS = [row({ eventId: "e1", date: "2026-10-01", label: "Waltz night" })];

function hub(over: Partial<HubStub> = {}) {
  const calls = stubHub({
    rows: ROWS,
    performers: [{ id: "p1", displayName: "Glenrose Smith" }],
    bands: [],
    ...over,
  });
  render(<BookingCentralPage />);
  return calls;
}

async function search(text: string) {
  await userEvent.type(
    await screen.findByRole("searchbox", { name: /find a performer or band/i }),
    text,
  );
}

async function openGlenrose() {
  await search("Glen");
  await userEvent.click(await screen.findByRole("button", { name: "Glenrose Smith" }));
  return screen.findByRole("dialog", { name: "Glenrose Smith" });
}

describe("the performer card (087 US3)", () => {
  it("opens on the WHOLE record, fetched, never the search summary (T047a)", async () => {
    const calls = hub({ performer: { bio: "Calls from Syracuse" } });
    const card = await openGlenrose();

    expect(calls.some((c) => c.url.endsWith("/api/performers/p1") && c.method === "GET")).toBe(
      true,
    );
    expect(await within(card).findByDisplayValue("Calls from Syracuse")).toBeInTheDocument();
  });

  it("lists the dances they have played and are booked for (T048, FR-019)", async () => {
    hub({
      history: [
        {
          eventId: "e9",
          date: "2027-01-14",
          startTime: "19:30:00",
          label: null,
          series: "Thursday Night Contra",
          role: "caller",
          status: "tentative",
          cancelled: false,
        },
        {
          eventId: "e8",
          date: "2020-06-30",
          startTime: "19:30:00",
          label: "Midsummer",
          series: "Thursday Night Contra",
          role: "caller",
          status: "confirmed",
          cancelled: false,
        },
      ],
    });
    const card = await openGlenrose();
    await userEvent.click(within(card).getByRole("button", { name: /dances/i }));

    const list = await within(card).findByRole("list", { name: /dances/i });
    const items = within(list)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatch(/2027-01-14.*Thursday Night Contra.*caller.*tentative/);
    expect(items[1]).toMatch(/2020-06-30.*Midsummer/);
  });

  it("lists their bands, each leading to that band (T048, FR-020)", async () => {
    hub({
      performerBands: [
        { id: "band2", name: "Old Timers", isLead: false, archived: true },
        { id: "band1", name: "The Reels", isLead: true, archived: false },
      ],
      band: { name: "The Reels" },
    });
    const card = await openGlenrose();
    await userEvent.click(within(card).getByRole("button", { name: /bands/i }));

    const list = await within(card).findByRole("list", { name: /bands/i });
    expect(list).toHaveTextContent(/Old Timers.*archived/);
    expect(list).toHaveTextContent(/The Reels.*lead/);

    await userEvent.click(within(list).getByRole("button", { name: "The Reels" }));
    expect(await screen.findByRole("dialog", { name: "The Reels" })).toBeInTheDocument();
  });

  it("is read-only to a volunteer who may not edit performers (FR-030b)", async () => {
    hub({ performerWrite: false });
    const card = await openGlenrose();
    await within(card).findByDisplayValue("Glenrose Smith");
    expect(within(card).queryByRole("button", { name: /^save/i })).toBeNull();
  });
});

describe("making what the search did not find (087 US3, T046a, T047a)", () => {
  it("offers a new performer carrying the typed name", async () => {
    hub({ performers: [] });
    await search("Zed Quill");
    await userEvent.click(
      await screen.findByRole("button", { name: /new performer “zed quill”/i }),
    );

    const form = await screen.findByRole("dialog", { name: /new performer/i });
    expect(within(form).getByLabelText(/first name/i)).toHaveValue("Zed");
    expect(within(form).getByLabelText(/last name/i)).toHaveValue("Quill");
  });

  it("offers a new band carrying the typed name, and creates it", async () => {
    // The stub's performer search answers Glenrose whatever is typed — here that is the member added.
    const calls = hub();
    await search("Zed Quill");
    await userEvent.click(await screen.findByRole("button", { name: /new band “zed quill”/i }));

    const form = await screen.findByRole("dialog", { name: /new band/i });
    expect(within(form).getByLabelText(/band name/i)).toHaveValue("Zed Quill");
    await userEvent.type(within(form).getByRole("searchbox", { name: /add a member/i }), "Glen");
    await userEvent.click(await within(form).findByRole("button", { name: /add glenrose smith/i }));
    await userEvent.click(within(form).getByRole("button", { name: /create band/i }));

    await waitFor(() =>
      expect(calls.find((c) => c.url === "/api/bands" && c.method === "POST")?.body).toMatchObject({
        name: "Zed Quill",
        members: [{ performerId: "p1", isLead: false }],
      }),
    );
  });

  it("offers neither to a volunteer who may not edit performers (FR-030b)", async () => {
    hub({ performers: [], performerWrite: false });
    await search("Zed Quill");
    await screen.findByRole("searchbox", { name: /find a performer or band/i });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /new performer/i })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: /new band/i })).toBeNull();
  });

  it("says when more matched than it is showing", async () => {
    hub({ truncated: true });
    await search("Glen");
    expect(await screen.findByText(/more matched — narrow the search/i)).toBeInTheDocument();
  });
});
