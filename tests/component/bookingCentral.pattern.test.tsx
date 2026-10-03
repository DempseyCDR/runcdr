// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { BookingModal } from "@/app/(admin)/_modals/BookingModal";
import { danceCard, dancesLoaded, line, row, slotOf, stubHub } from "./fixtures/bookingCentral";

/**
 * Feature 087 walk-through (2026-09-24, Rich), second round:
 *  - a band with a musician added beside it reads "<band> feat. <musician>" (091: on a card);
 *  - a band just saved is searched for on the hub, so the Booker sees it;
 *  - the booking editor is titled "Book a <type> for <date>";
 *  - finding a performer to book, or a band, works as the hub's own search does — type, pick a result,
 *    or make a new one from what was typed.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Feature 091: a dance's Music, on its card (the table is retired). */
async function musicOf(text: string) {
  await screen.findByRole("list", { name: "Dances" });
  await dancesLoaded();
  return slotOf(danceCard(text), "Music");
}

describe("a band with a musician beside it", () => {
  const withBand = (extra: ReturnType<typeof line>[]) =>
    row({
      eventId: "e1",
      date: "2026-10-01",
      label: "Waltz night",
      band: "The Trio",
      bandId: "band1",
      bookings: [
        line({ performer: "Ann Fiddle", type: "lead_musician", bandId: "band1" }),
        ...extra,
      ],
    });

  // Feature 091 (FR-002b): on a card, "feat." and first initial and last name.
  it("reads '<band> feat. <musician>'", async () => {
    stubHub({ rows: [withBand([line({ performer: "Cy Horn", type: "musician" })])] });
    render(<BookingCentralPage />);
    const music = await musicOf("Waltz night");
    expect(music.textContent).toMatch(/The Trio.*feat\..*C\. Horn/);
  });

  it("names two added musicians together", async () => {
    stubHub({
      rows: [
        withBand([
          line({ performer: "Cy Horn", type: "musician" }),
          line({ performer: "Dee Bass", type: "musician" }),
        ]),
      ],
    });
    render(<BookingCentralPage />);
    const music = await musicOf("Waltz night");
    expect(music.textContent).toMatch(/The Trio.*feat\..*C\. Horn.*and.*D\. Bass/);
  });

  it("says no 'feat.' for musicians booked without a band", async () => {
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
    const music = await musicOf("Waltz night");
    expect(music.textContent).not.toMatch(/feat\./);
  });
});

describe("a band just saved", () => {
  it("closes, and the hub searches for it by name", async () => {
    const calls = stubHub({
      rows: [row({ eventId: "e1", date: "2026-10-01", label: "Waltz night" })],
      performers: [{ id: "p1", displayName: "Glenrose Smith" }],
      bands: [],
    });
    render(<BookingCentralPage />);
    const search = await screen.findByRole("searchbox", { name: /find a performer or band/i });
    await userEvent.type(search, "Zed Quill");
    await userEvent.click(await screen.findByRole("button", { name: /new band “zed quill”/i }));
    const form = await screen.findByRole("dialog", { name: /new band/i });
    await userEvent.clear(within(form).getByLabelText(/band name/i));
    await userEvent.type(within(form).getByLabelText(/band name/i), "The Quills");
    await userEvent.type(within(form).getByRole("searchbox", { name: /add a member/i }), "Glen");
    await userEvent.click(await within(form).findByRole("button", { name: /add glenrose smith/i }));
    await userEvent.click(within(form).getByRole("button", { name: /create band/i }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /new band/i })).toBeNull());
    expect(search).toHaveValue("The Quills");
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.startsWith("/api/bands?") && c.url.includes("The+Quills")),
      ).toBe(true),
    );
  });
});

describe("the booking editor's title", () => {
  const titled = (role: string) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) })),
    );
    render(
      <BookingModal
        mode="create"
        eventId="e1"
        eventDate="2026-10-01"
        role={role}
        onClose={() => {}}
      />,
    );
  };

  it("reads 'Book a caller for <date>'", () => {
    titled("caller");
    expect(
      screen.getByRole("heading", { name: "Book a caller for 2026-10-01" }),
    ).toBeInTheDocument();
  });

  it("reads 'Book an instructor for <date>'", () => {
    titled("instructor");
    expect(
      screen.getByRole("heading", { name: "Book an instructor for 2026-10-01" }),
    ).toBeInTheDocument();
  });

  it("reads 'Book a sound tech for <date>'", () => {
    titled("sound_tech");
    expect(
      screen.getByRole("heading", { name: "Book a sound tech for 2026-10-01" }),
    ).toBeInTheDocument();
  });
});

describe("finding who to book, as the hub's search does", () => {
  it("lists what matches, and offers a new performer from what was typed — even beside a match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.startsWith("/api/performers?")
            ? { items: [{ id: "p1", displayName: "Oliver Scanlon" }], truncated: false }
            : { items: [] },
      })),
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
    await userEvent.type(screen.getByRole("searchbox", { name: /find a performer/i }), "Oliver");

    const results = await screen.findByRole("list", { name: /search results/i });
    expect(within(results).getByRole("button", { name: "Oliver Scanlon" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new performer “oliver”/i })).toBeInTheDocument();
  });
  // Finding a BAND to book, and making one: see bookingCentral.music.test.tsx — booking music became one
  // search for performers and bands together (087 walk-through, third round).
});
