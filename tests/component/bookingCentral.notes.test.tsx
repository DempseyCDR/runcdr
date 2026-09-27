// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { line, row, stubHub, type Call, type HubStub } from "./fixtures/bookingCentral";

/**
 * Feature 087 walk-through (2026-09-25, Rich): notes on performers' bookings, seen on the table.
 *
 * A band's booking is one booking per member, so a band note needs a home: it is the LEAD's booking note
 * ("we can overload the field"), entered on the band's own form — its lineup. Performers' notes are shown
 * in the dance's note line, after the dance's own note, so a note is read where the booking is.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

async function rowsFor(text: string) {
  const table = await screen.findByRole("table", { name: /dances/i });
  await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1));
  return within(table)
    .getAllByRole("row")
    .filter((r) => r.textContent?.includes(text));
}

describe("the note line — the dance's note, then its performers'", () => {
  it("shows the dance note first, then each performer's, the band's under the band's name", async () => {
    stubHub({
      rows: [
        row({
          eventId: "e1",
          date: "2026-10-01",
          label: "Waltz night",
          note: "Hall opens late",
          band: "The Trio",
          bandId: "band1",
          bookings: [
            line({ performer: "Pat Caller", type: "caller", note: "needs a mic" }),
            line({
              performer: "Ann Fiddle",
              type: "lead_musician",
              bandId: "band1",
              note: "arriving 7:00",
            }),
            line({ performer: "Bo Piano", type: "musician", bandId: "band1" }),
          ],
        }),
      ],
    });
    render(<BookingCentralPage />);
    const noteRow = (await rowsFor("Hall opens late"))[0]!;
    expect(noteRow.textContent).toMatch(
      /Hall opens late.*Pat Caller: needs a mic.*The Trio: arriving 7:00/,
    );
    expect(noteRow.textContent).not.toMatch(/Ann Fiddle/);
  });

  it("shows a performer's note even when the dance has none", async () => {
    stubHub({
      rows: [
        row({
          eventId: "e1",
          date: "2026-10-01",
          label: "Waltz night",
          bookings: [line({ performer: "Pat Caller", type: "caller", note: "needs a mic" })],
        }),
      ],
    });
    render(<BookingCentralPage />);
    expect(await screen.findByText(/needs a mic/)).toBeInTheDocument();
  });
});

describe("the band note, on the band's lineup", () => {
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
  const full = (name: string, type: string, note: string | null) => ({
    id: `b-${name}`,
    performerId: `p-${name}`,
    performerName: name,
    performerType: type,
    payCents: 10000,
    note,
    status: "confirmed",
    bandId: "band1",
  });

  async function openLineup(over: Partial<HubStub> = {}) {
    const calls = stubHub({
      rows: [DANCE],
      eventBookings: {
        e1: [
          full("Ann Fiddle", "lead_musician", "arriving 7:00"),
          full("Bo Piano", "musician", null),
        ],
      },
      ...over,
    });
    render(<BookingCentralPage />);
    await userEvent.click(
      within((await rowsFor("Waltz night"))[0]!).getByRole("button", { name: "The Trio" }),
    );
    return { calls, lineup: await screen.findByRole("dialog", { name: /the trio/i }) };
  }

  it("shows the band note — the lead's booking note — and saves it there", async () => {
    const { calls, lineup } = await openLineup();
    const note = within(lineup).getByLabelText("Band note");
    expect(note).toHaveValue("arriving 7:00");

    await userEvent.clear(note);
    await userEvent.type(note, "arriving 6:45, bring the stand");
    await userEvent.click(within(lineup).getByRole("button", { name: /save band note/i }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({
      method: "PATCH",
      url: "/api/bookings/b-Ann Fiddle",
      body: { note: "arriving 6:45, bring the stand" },
    });
  });

  it("offers the note read-only to a volunteer who may not book", async () => {
    const { lineup } = await openLineup({ bookingWrite: false });
    expect(within(lineup).getByText("arriving 7:00")).toBeInTheDocument();
    expect(within(lineup).queryByRole("button", { name: /save band note/i })).toBeNull();
  });
});
