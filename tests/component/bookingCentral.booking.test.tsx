// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { line, row, stubHub } from "./fixtures/bookingCentral";

/**
 * Feature 087 T028 (FR-015): a booking's note is written in the EXISTING booking editor.
 *
 * This verifies reuse, not new behaviour. `bookings.note` already existed and `BookingModal` already had
 * a Notes box writing it; the plan first proposed a second column beside it, which would have given every
 * booking two notes. The hub opens the editor that was already there.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Booking Central — a booking's note (087 T028)", () => {
  it("opens the existing booking editor, whose Notes box carries the booking's note", async () => {
    stubHub({
      rows: [
        row({
          eventId: "e1",
          date: "2026-10-01",
          label: "Waltz night",
          bookings: [line({ performer: "Pat Caller", type: "caller" })],
        }),
      ],
      eventBookings: {
        e1: [
          {
            id: "b-Pat Caller",
            performerId: "p-Pat Caller",
            performerName: "Pat Caller",
            performerType: "caller",
            payCents: 15000,
            note: "prefers the long set",
            status: "confirmed",
            bandId: null,
          },
        ],
      },
    });
    render(<BookingCentralPage />);
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("button", { name: "P. Caller" }));

    const dialog = await screen.findByRole("dialog", { name: /^(booking —|book an? )/i });
    expect(within(dialog).getByLabelText("Notes")).toHaveValue("prefers the long set");
  });
});
