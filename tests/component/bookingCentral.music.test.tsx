// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { BookingModal } from "@/app/(admin)/_modals/BookingModal";
import { line, row, stubHub, type Call, type HubStub } from "./fixtures/bookingCentral";

/**
 * Feature 087 walk-through (2026-09-24, Rich), third round:
 *  - booking music is ONE search box, the hub's own — performers and bands together — not a choice of
 *    "band or musician" first;
 *  - editing one member's booking from a band's lineup returns to the lineup, so the next member can be
 *    done;
 *  - a dialog that opens on a search box puts the cursor in it.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

const EMPTY = row({ eventId: "e2", date: "2026-10-08", label: "Open night" });

async function rowFor(text: string) {
  const table = await screen.findByRole("table", { name: /dances/i });
  await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1));
  return within(
    within(table)
      .getAllByRole("row")
      .find((r) => r.textContent?.includes(text)) as HTMLElement,
  );
}

async function openMusic(over: Partial<HubStub> = {}) {
  const calls = stubHub({
    rows: [EMPTY],
    performers: [{ id: "p-ann", displayName: "Ann Fiddle" }],
    bands: [{ id: "band1", name: "The Trio" }],
    ...over,
  });
  render(<BookingCentralPage />);
  await userEvent.click(
    (await rowFor("Open night")).getByRole("button", { name: "No music booked" }),
  );
  const finder = await screen.findByRole("dialog", { name: "Book music for 2026-10-08" });
  return { calls, finder };
}

describe("booking music — one search box", () => {
  it("opens straight on a search for performers and bands, with the cursor in it", async () => {
    const { finder } = await openMusic();
    const box = within(finder).getByRole("searchbox", { name: /find a performer or band/i });
    expect(box).toHaveFocus();
    expect(within(finder).queryByRole("button", { name: /book a band/i })).toBeNull();
    expect(within(finder).queryByRole("button", { name: /book a musician/i })).toBeNull();
    // It offers what can be booked: archived performers and bands are not.
    expect(within(finder).queryByRole("checkbox", { name: /include archived/i })).toBeNull();
  });

  it("books a band picked from the results, in one act", async () => {
    const { calls, finder } = await openMusic({ performers: [] });
    await userEvent.type(within(finder).getByRole("searchbox"), "Trio");
    await userEvent.click(await within(finder).findByRole("button", { name: "The Trio" }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({
      url: "/api/events/e2/book-band",
      body: { bandId: "band1" },
    });
  });

  it("opens the booking for a performer picked from the results, already chosen", async () => {
    const { calls, finder } = await openMusic({ bands: [] });
    await userEvent.type(within(finder).getByRole("searchbox"), "Ann");
    await userEvent.click(await within(finder).findByRole("button", { name: "Ann Fiddle" }));

    const booking = await screen.findByRole("dialog", { name: /^(booking —|book an? )/i });
    expect(within(booking).getByRole("heading")).toHaveTextContent(
      "Book a musician for 2026-10-08",
    );
    expect(within(booking).getByText(/selected: ann fiddle/i)).toBeInTheDocument();
    await userEvent.click(within(booking).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({
      url: "/api/events/e2/bookings",
      body: { performerId: "p-ann", performerType: "musician" },
    });
  });

  it("starts a new performer from what was typed", async () => {
    const { finder } = await openMusic({ performers: [], bands: [] });
    await userEvent.type(within(finder).getByRole("searchbox"), "Zed Quill");
    await userEvent.click(
      await within(finder).findByRole("button", { name: /new performer “zed quill”/i }),
    );

    const booking = await screen.findByRole("dialog", { name: /^(booking —|book an? )/i });
    expect(within(booking).getByRole("searchbox", { name: /find a performer/i })).toHaveValue(
      "Zed Quill",
    );
    expect(
      await within(booking).findByRole("button", { name: /new performer “zed quill”/i }),
    ).toBeInTheDocument();
  });

  it("makes a new band from what was typed, then books it for the dance", async () => {
    const { calls, finder } = await openMusic({ bands: [] });
    await userEvent.type(within(finder).getByRole("searchbox"), "Zed Quill");
    await userEvent.click(
      await within(finder).findByRole("button", { name: /new band “zed quill”/i }),
    );

    const form = await screen.findByRole("dialog", { name: /new band/i });
    await userEvent.type(within(form).getByRole("searchbox", { name: /add a member/i }), "Ann");
    await userEvent.click(await within(form).findByRole("button", { name: /add ann fiddle/i }));
    await userEvent.click(within(form).getByRole("button", { name: /create band/i }));

    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]).toMatchObject({
      url: "/api/events/e2/book-band",
      body: { bandId: "band-new" },
    });
  });

  it("is what the + in a filled music cell opens too", async () => {
    stubHub({
      rows: [
        row({
          eventId: "e1",
          date: "2026-10-01",
          label: "Waltz night",
          bookings: [line({ performer: "Cy Horn", type: "musician" })],
        }),
      ],
    });
    render(<BookingCentralPage />);
    await userEvent.click((await rowFor("Waltz night")).getByRole("button", { name: "Add music" }));
    expect(
      await screen.findByRole("dialog", { name: "Book music for 2026-10-01" }),
    ).toBeInTheDocument();
  });
});

describe("a band's lineup, member by member", () => {
  const DANCE = row({
    eventId: "e1",
    date: "2026-10-01",
    label: "Waltz night",
    band: "The Trio",
    bandId: "band1",
    bookings: [
      line({ performer: "Ann Fiddle", type: "lead_musician", bandId: "band1" }),
      line({ performer: "Bo Piano", type: "musician", bandId: "band1" }),
    ],
  });
  const full = (name: string, type: string) => ({
    id: `b-${name}`,
    performerId: `p-${name}`,
    performerName: name,
    performerType: type,
    payCents: 10000,
    note: null,
    status: "confirmed",
    bandId: "band1",
  });

  it("returns to the lineup after one member's booking is saved, re-read", async () => {
    const calls = stubHub({
      rows: [DANCE],
      eventBookings: { e1: [full("Ann Fiddle", "lead_musician"), full("Bo Piano", "musician")] },
    });
    render(<BookingCentralPage />);
    await userEvent.click((await rowFor("Waltz night")).getByRole("button", { name: "The Trio" }));
    const lineup = await screen.findByRole("dialog", { name: /the trio/i });
    await userEvent.click(within(lineup).getByRole("button", { name: "Bo Piano" }));

    const booking = await screen.findByRole("dialog", { name: /^(booking —|book an? )/i });
    const pay = within(booking).getByLabelText(/^pay/i);
    await userEvent.clear(pay);
    await userEvent.type(pay, "120");
    const readsBefore = calls.filter((c) => c.url === "/api/events/e1/bookings").length;
    await userEvent.click(within(booking).getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /^(booking —|book an? )/i })).toBeNull(),
    );
    expect(screen.getByRole("dialog", { name: /the trio/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.filter((c) => c.url === "/api/events/e1/bookings").length).toBeGreaterThan(
        readsBefore,
      ),
    );
  });

  it("returns to the lineup when a member's booking is closed unsaved", async () => {
    stubHub({
      rows: [DANCE],
      eventBookings: { e1: [full("Ann Fiddle", "lead_musician"), full("Bo Piano", "musician")] },
    });
    render(<BookingCentralPage />);
    await userEvent.click((await rowFor("Waltz night")).getByRole("button", { name: "The Trio" }));
    const lineup = await screen.findByRole("dialog", { name: /the trio/i });
    await userEvent.click(within(lineup).getByRole("button", { name: "Bo Piano" }));
    const booking = await screen.findByRole("dialog", { name: /^(booking —|book an? )/i });
    await userEvent.click(within(booking).getByRole("button", { name: /^close$/i }));

    expect(screen.getByRole("dialog", { name: /the trio/i })).toBeInTheDocument();
  });
});

describe("the cursor goes to the search box", () => {
  it("in the booking editor, when it opens on a search", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) })),
    );
    render(
      <BookingModal
        mode="create"
        eventId="e1"
        eventDate="2026-10-01"
        role="caller"
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("searchbox", { name: /find a performer/i })).toHaveFocus();
  });
});
