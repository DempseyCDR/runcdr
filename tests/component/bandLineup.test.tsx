// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { line, row, stubHub, type Call, type HubStub } from "./fixtures/bookingCentral";

/**
 * Feature 087 US4 — the evening's lineup changes.
 *
 * A fiddler drops out on the Tuesday. The Booker fixes THAT EVENING — declines her, books a substitute —
 * without touching the band, whose membership is who they are, not who played on the 14th (FR-025).
 * The ordinary status click deliberately cannot decline (FR-011); this panel is where declining lives.
 *
 * It also carries what only the bookings report did: re-pointing a dance from one band to another
 * (feature 024 US2), and adding a musician beside a band that is already booked (T058a).
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DANCE = row({
  eventId: "e1",
  date: "2026-10-01",
  label: "Waltz night",
  band: "The Trio",
  bandId: "band1",
  bookings: [
    line({ performer: "Ann Fiddle", type: "lead_musician", bandId: "band1" }),
    line({ performer: "Bo Piano", type: "musician", bandId: "band1" }),
    line({ performer: "Cy Horn", type: "musician" }),
  ],
});

const full = (name: string, type: string, bandId: string | null, payCents: number) => ({
  id: `b-${name}`,
  performerId: `p-${name}`,
  performerName: name,
  performerType: type,
  payCents,
  note: null,
  status: "confirmed",
  bandId,
});

const BOOKINGS = {
  e1: [
    full("Ann Fiddle", "lead_musician", "band1", 10000),
    full("Bo Piano", "musician", "band1", 9000),
    full("Cy Horn", "musician", null, 8000),
  ],
};

async function openLineup(over: Partial<HubStub> = {}) {
  const calls = stubHub({
    rows: [DANCE],
    eventBookings: BOOKINGS,
    bands: [
      { id: "band1", name: "The Trio" },
      { id: "band2", name: "The Reels" },
    ],
    performers: [{ id: "p-dee", displayName: "Dee Bass" }],
    ...over,
  });
  render(<BookingCentralPage />);
  await userEvent.click(await screen.findByRole("button", { name: "The Trio" }));
  const panel = await screen.findByRole("dialog", { name: /The Trio/ });
  return { calls, panel };
}

const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

describe("the lineup for one dance (087 US4)", () => {
  it("lists every musician separately, each with their own state and pay (T055)", async () => {
    const { panel } = await openLineup();
    const list = within(panel).getByRole("list", { name: /lineup/i });
    const items = within(list)
      .getAllByRole("listitem")
      .map((li) => li.textContent);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(/Ann Fiddle.*lead.*confirmed.*\$100\.00/);
    expect(items[1]).toMatch(/Bo Piano.*confirmed.*\$90\.00/);
    // A musician booked beside the band is part of the evening's lineup too.
    expect(items[2]).toMatch(/Cy Horn.*confirmed.*\$80\.00/);
  });

  it("declines ONE member and writes nothing else (T056)", async () => {
    const { calls, panel } = await openLineup();
    await userEvent.click(within(panel).getByRole("button", { name: "Bo Piano" }));

    const modal = await screen.findByRole("dialog", { name: /booking/i });
    await userEvent.selectOptions(within(modal).getByLabelText(/status/i), "declined");
    await userEvent.click(within(modal).getByRole("button", { name: /save/i }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({
      method: "PATCH",
      url: "/api/bookings/b-Bo Piano",
      body: expect.objectContaining({ status: "declined" }),
    });
  });

  it("substitutes for one member and leaves the band's membership alone (T057)", async () => {
    const { calls, panel } = await openLineup();
    await userEvent.click(within(panel).getByRole("button", { name: "Bo Piano" }));

    const modal = await screen.findByRole("dialog", { name: /booking/i });
    await userEvent.type(within(modal).getByLabelText(/substitute performer/i), "Dee");
    await userEvent.click(
      await within(modal).findByRole("button", { name: /substitute in dee bass/i }),
    );

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({
      method: "POST",
      url: "/api/bookings/b-Bo Piano/substitute",
      body: { newPerformerId: "p-dee" },
    });
    expect(calls.some((c) => /\/api\/bands\/[^?]/.test(c.url))).toBe(false);
  });
});

describe("what only the bookings report did (087 US4, T058a)", () => {
  it("re-points the dance from one band to another (feature 024 US2)", async () => {
    const { calls, panel } = await openLineup();
    await userEvent.selectOptions(within(panel).getByLabelText(/re-point the trio to/i), "band2");
    await userEvent.click(within(panel).getByRole("button", { name: /re-point band/i }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({
      method: "POST",
      url: "/api/events/e1/repoint-band",
      body: { fromBandId: "band1", toBandId: "band2" },
    });
  });

  it("does not offer the band being replaced as its own replacement", async () => {
    const { panel } = await openLineup();
    const options = within(within(panel).getByLabelText(/re-point the trio to/i))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).not.toContain("The Trio");
    expect(options).toContain("The Reels");
  });

  it("adds a musician beside the band already booked", async () => {
    const { panel } = await openLineup();
    await userEvent.click(within(panel).getByRole("button", { name: /add a musician/i }));
    expect(
      await screen.findByRole("heading", { name: /book a musician for 2026-10-01/i }),
    ).toBeInTheDocument();
  });

  it("offers neither to a volunteer who may only read", async () => {
    const { panel } = await openLineup({ bookingWrite: false });
    expect(within(panel).queryByLabelText(/re-point/i)).toBeNull();
    expect(within(panel).queryByRole("button", { name: /add a musician/i })).toBeNull();
  });
});
