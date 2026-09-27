// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { line, row, stubHub, type HubStub } from "./fixtures/bookingCentral";

/**
 * Feature 087 walk-through (2026-09-24, Rich): "After I have booked one musician for a dance, how do I
 * book another?" — he could not. The gap mark was the only way in, and it goes once a slot is filled. The
 * same held for a second caller or sound tech, and an INSTRUCTOR could not be booked at all: that slot is
 * never marked (FR-004a). A "+" in a filled cell adds another to it.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DANCE = row({
  eventId: "e1",
  date: "2026-10-01",
  label: "Waltz night",
  bookings: [
    line({ performer: "Pat Caller", type: "caller" }),
    line({ performer: "Ann Fiddle", type: "musician" }),
    line({ performer: "Sam Sound", type: "sound_tech" }),
  ],
});
const EMPTY = row({ eventId: "e2", date: "2026-10-08", label: "Open night" });

function hub(over: Partial<HubStub> = {}) {
  stubHub({ rows: [DANCE, EMPTY], ...over });
  render(<BookingCentralPage />);
}

const rowFor = async (text: string) => {
  const table = await screen.findByRole("table", { name: /dances/i });
  await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(2));
  return within(
    within(table)
      .getAllByRole("row")
      .find((r) => r.textContent?.includes(text)) as HTMLElement,
  );
};

describe("Booking Central — adding another to a filled slot", () => {
  it("books a second musician beside the first", async () => {
    hub();
    await userEvent.click((await rowFor("Waltz night")).getByRole("button", { name: "Add music" }));
    // The one music search (087 walk-through), where a second musician is found and picked.
    const finder = await screen.findByRole("dialog", { name: "Book music for 2026-10-01" });
    expect(
      within(finder).getByRole("searchbox", { name: /find a performer or band/i }),
    ).toHaveFocus();
  });

  it("books an instructor — or a second caller — from the caller cell", async () => {
    hub();
    await userEvent.click(
      (await rowFor("Waltz night")).getByRole("button", { name: "Add a caller or instructor" }),
    );
    const chooser = await screen.findByRole("dialog", { name: /caller or instructor/i });
    expect(within(chooser).getByRole("button", { name: /book a caller/i })).toBeInTheDocument();
    await userEvent.click(within(chooser).getByRole("button", { name: /book an instructor/i }));
    expect(
      await screen.findByRole("heading", { name: "Book an instructor for 2026-10-01" }),
    ).toBeInTheDocument();
  });

  it("books another sound tech", async () => {
    hub();
    await userEvent.click(
      (await rowFor("Waltz night")).getByRole("button", { name: "Add a sound tech" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Book a sound tech for 2026-10-01" }),
    ).toBeInTheDocument();
  });

  it("offers no + where the slot is empty — the gap mark is the way in there", async () => {
    hub();
    const empty = await rowFor("Open night");
    expect(empty.queryByRole("button", { name: /^add /i })).toBeNull();
    expect(empty.getByRole("button", { name: "No music booked" })).toBeInTheDocument();
  });

  it("offers no + to a volunteer who may only read", async () => {
    hub({ bookingWrite: false });
    const r = await rowFor("Waltz night");
    expect(r.queryByRole("button", { name: /^add /i })).toBeNull();
  });
});
