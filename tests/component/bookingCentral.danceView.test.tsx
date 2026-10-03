// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { line, row, setWidth, stubHub, type Row } from "./fixtures/bookingCentral";

/**
 * Feature 091 US1 (contracts/page.md D1–D6) — a card opens its dance.
 *
 * The opened dance fills a phone's screen and offers everything the dance's row does: names that open
 * their booking, letters that advance, gap marks and + that fill a slot, the venue, the notes and the
 * dance's own form. Editors open on top; closing it returns to the card.
 */

const WALTZ: Row = row({
  eventId: "e1",
  date: "2026-10-08",
  label: "Waltz night",
  caller: "Pat Caller",
  note: "Bring the long tables",
  bookings: [line({ performer: "Pat Caller", type: "caller", status: "proposed" })],
});
const ECD: Row = row({
  eventId: "e2",
  date: "2026-10-04",
  label: "English",
  series: "Sunday English Country Dance",
  hasSoundTech: false,
});

const NAME = "2026-10-08 · Thursday Night Contra · Waltz night";
const card = (name: string) => screen.getByRole("button", { name });
const dialogs = () => screen.queryAllByRole("dialog");

async function openWaltz(opts: { bookingWrite?: boolean; eventWrite?: boolean } = {}) {
  setWidth("narrow");
  const calls = stubHub({ rows: [WALTZ, ECD], ...opts });
  render(<BookingCentralPage />);
  await userEvent.click(await screen.findByRole("button", { name: NAME }));
  const dialog = await screen.findByRole("dialog", { name: NAME });
  return { calls, dialog };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Booking Central — the opened dance (091 US1)", () => {
  it("opens the dance in a dialog headed by it, with its sections (D1, D2)", async () => {
    const { dialog } = await openWaltz();
    for (const heading of ["Venue", "Caller", "Music", "Sound", "Notes"]) {
      expect(within(dialog).getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(dialog).toHaveTextContent("Bring the long tables");
    expect(within(dialog).getByRole("button", { name: "German House" })).toBeInTheDocument();
  });

  // Rich, 2026-10-01: the opened dance names its performers as the card does — "P. Caller".
  it("names each performer by first initial and last name, as the card does (D2, FR-002b)", async () => {
    const { dialog } = await openWaltz();
    expect(within(dialog).getByRole("button", { name: "P. Caller" })).toBeInTheDocument();
    expect(within(dialog).queryByText("Pat Caller")).toBeNull();
  });

  it("leaves out Sound for a series that wants no sound tech (D2)", async () => {
    setWidth("narrow");
    stubHub({ rows: [WALTZ, ECD] });
    render(<BookingCentralPage />);
    await userEvent.click(await screen.findByRole("button", { name: /2026-10-04/ }));
    const dialog = await screen.findByRole("dialog", { name: /2026-10-04/ });
    expect(within(dialog).queryByRole("heading", { name: "Sound" })).toBeNull();
  });

  it("advances a letter, and the card shows the new state (D2, FR-004)", async () => {
    const { calls, dialog } = await openWaltz();
    await userEvent.click(within(dialog).getByRole("button", { name: "Pat Caller: proposed" }));

    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "PATCH" && (c.body as { status?: string })?.status === "requested",
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Pat Caller: requested")).toBeInTheDocument(),
    );
  });

  it("opens the booking editor on top of the dance from a gap mark (D2, D4)", async () => {
    const { dialog } = await openWaltz();
    await userEvent.click(within(dialog).getByRole("button", { name: "No music booked" }));
    await waitFor(() => expect(dialogs().length).toBeGreaterThan(1));
  });

  it("opens the dance's own form — Edit dance (D3)", async () => {
    const { dialog } = await openWaltz();
    await userEvent.click(within(dialog).getByRole("button", { name: "Edit dance" }));
    await waitFor(() => expect(dialogs().length).toBeGreaterThan(1));
  });

  it("offers View dance to a volunteer who may not edit it (D3)", async () => {
    const { dialog } = await openWaltz({ eventWrite: false });
    expect(within(dialog).getByRole("button", { name: "View dance" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Edit dance" })).toBeNull();
  });

  it("closes on Close, returning focus to the card (D5, FR-003a)", async () => {
    const { dialog } = await openWaltz();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(dialogs()).toHaveLength(0));
    expect(card(NAME)).toHaveFocus();
  });

  it("closes on Escape, returning focus to the card (D5, FR-003a)", async () => {
    await openWaltz();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialogs()).toHaveLength(0));
    expect(card(NAME)).toHaveFocus();
  });

  it("is read-only for a volunteer who may not book: letters as text, no +, gap marks as marks (D6, FR-005)", async () => {
    const { dialog } = await openWaltz({ bookingWrite: false });
    expect(within(dialog).getByLabelText("Pat Caller: proposed").tagName).not.toBe("BUTTON");
    expect(within(dialog).queryByRole("button", { name: /^Add / })).toBeNull();
    expect(within(dialog).getByRole("img", { name: "No music booked" })).toBeInTheDocument();
  });
});
