// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { EventModal } from "@/app/(admin)/_modals/EventModal";
import { row, stubHub } from "./fixtures/bookingCentral";

/**
 * Feature 087 T029 (FR-014, FR-016): the dance's note is written in the hub's dance editor — and ONLY
 * there.
 *
 * The events page shares this editor with the hub. The blurb is shared between the Booker and the
 * Webmaster; the note is the Booker's private scheduling note. So the editor shows the note only when the
 * hub asks for it, and the events page never does — otherwise the Webmaster would be reading the
 * Booker's notes.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DANCE = row({
  eventId: "e1",
  date: "2026-10-01",
  label: "Waltz night",
  note: "ask Dave first",
});

describe("Booking Central — a dance's note (087 T029)", () => {
  it("shows the note in the hub's dance editor, and saving sends it", async () => {
    const calls = stubHub({ rows: [DANCE] });
    render(<BookingCentralPage />);
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("button", { name: "Waltz night" }));
    const dialog = await screen.findByRole("dialog", { name: /event/i });
    const note = within(dialog).getByLabelText("Note");
    expect(note).toHaveValue("ask Dave first");

    await userEvent.clear(note);
    await userEvent.type(note, "try Chuck");
    await userEvent.click(within(dialog).getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === "PATCH" &&
            c.url.endsWith("/api/events/e1") &&
            (c.body as { note?: string }).note === "try Chuck",
        ),
      ).toBe(true),
    );
  });

  it("never shows the note when the editor is used without asking for it — the events page", async () => {
    stubHub({ rows: [DANCE] });
    render(
      <EventModal
        mode="edit"
        event={{
          id: "e1",
          seriesKey: "tnc",
          eventDate: "2026-10-01",
          startTime: null,
          venueId: null,
          rentCents: null,
          label: "Waltz night",
          description: "A public blurb",
          note: "ask Dave first",
        }}
        venues={[]}
        onClose={() => {}}
      />,
    );

    expect(screen.queryByLabelText("Note")).toBeNull();
    expect(screen.queryByDisplayValue("ask Dave first")).toBeNull();
  });
});

/** Feature 087 walk-through: cancelling a dance, from the dance itself, on the hub. */
describe("Booking Central — cancelling a dance", () => {
  it("offers to cancel or delete a dance from its editor, and sends the cancel", async () => {
    const calls = stubHub({ rows: [DANCE] });
    render(<BookingCentralPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Waltz night" }));
    const dialog = await screen.findByRole("dialog", { name: /event/i });

    expect(within(dialog).getByRole("button", { name: /delete this dance/i })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /cancel this dance/i }));
    await userEvent.click(within(dialog).getByRole("button", { name: /yes, cancel the dance/i }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === "PATCH" && c.url === "/api/events/e1")?.body).toEqual({
        status: "cancelled",
      }),
    );
  });

  it("offers to revive a cancelled dance", async () => {
    stubHub({
      rows: [row({ eventId: "e2", date: "2026-10-08", label: "Gone night", cancelled: true })],
    });
    render(<BookingCentralPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Gone night" }));
    const dialog = await screen.findByRole("dialog", { name: /event/i });
    expect(within(dialog).getByRole("button", { name: /revive this dance/i })).toBeInTheDocument();
  });
});
