// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { row, stubHub, type HubStub } from "./fixtures/bookingCentral";

/**
 * Feature 087 US5 (FR-026, FR-027, FR-001c) — the performers who need a contact, offered from the hub.
 *
 * The count is an invitation, not an alarm: it sits above the table with the three other things there
 * (and nothing else), opens the list, and each name opens the performer — where the question that
 * settles the link is already waiting.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NEEDING = {
  count: 3,
  items: [
    { id: "p1", displayName: "Catherine Sloboda", reason: "archived" },
    { id: "p2", displayName: "Merged Mo", reason: "merged" },
    { id: "p3", displayName: "Nobody Ned", reason: "none" },
  ],
};

function hub(over: Partial<HubStub> = {}) {
  const calls = stubHub({
    rows: [row({ eventId: "e1", date: "2026-10-01", label: "Waltz night" })],
    performers: [{ id: "c-live", displayName: "Catherine McCallen" }],
    needingContact: NEEDING,
    ...over,
  });
  render(<BookingCentralPage />);
  return calls;
}

const countButton = () => screen.findByRole("button", { name: /3 performers need a contact/i });

describe("the performers needing a contact (087 US5)", () => {
  it("counts them above the table (T063, FR-026)", async () => {
    hub();
    expect(await countButton()).toBeInTheDocument();
  });

  it("says nothing when there are none — an invitation, not a permanent notice", async () => {
    hub({ needingContact: { count: 0, items: [] } });
    await screen.findByRole("table", { name: /dances/i });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /need a contact/i })).toBeNull(),
    );
  });

  it("lists them with why, each opening the performer (T063)", async () => {
    hub({ performer: { displayName: "Catherine Sloboda" } });
    await userEvent.click(await countButton());

    const list = await screen.findByRole("list", { name: /need a contact/i });
    const items = within(list)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items[0]).toMatch(/Catherine Sloboda.*archived/);
    expect(items[1]).toMatch(/Merged Mo.*merged/);
    expect(items[2]).toMatch(/Nobody Ned.*no contact/);

    await userEvent.click(within(list).getByRole("button", { name: "Catherine Sloboda" }));
    expect(await screen.findByRole("dialog", { name: "Catherine Sloboda" })).toBeInTheDocument();
  });

  it("puts exactly four things above the table, and nothing else (FR-001c)", async () => {
    hub();
    await countButton();
    const table = screen.getByRole("table", { name: /dances/i });
    const before = Array.from(
      document.querySelectorAll<HTMLElement>("main input, main button, main select, main a"),
    ).filter((el) => el.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING);

    // Each control's name: its aria-label, else the <label> around it, else its own text.
    const name = (el: HTMLElement) =>
      el.getAttribute("aria-label") ??
      el.closest("label")?.textContent?.trim() ??
      el.textContent?.trim();
    expect(before.map(name)).toEqual([
      "Showing dances from",
      "Find a performer or band",
      "Include archived",
      "3 performers need a contact",
    ]);
  });
});

describe("a performer whose contact is retired (087 US5, FR-027, B58)", () => {
  it("raises the settle-it question, worded for a retired link (T064)", async () => {
    const calls = hub({
      performer: {
        displayName: "Catherine Sloboda",
        contactId: "c-old",
        contactName: "Catherine Sloboda",
        contactRetired: "archived",
      },
    });
    await userEvent.click(await countButton());
    const list = await screen.findByRole("list", { name: /need a contact/i });
    await userEvent.click(within(list).getByRole("button", { name: "Catherine Sloboda" }));

    const card = await screen.findByRole("dialog", { name: "Catherine Sloboda" });
    expect(
      await within(card).findByText(/linked to a contact that has been archived/i),
    ).toBeInTheDocument();
    expect(within(card).queryByText(/has no contact/i)).toBeNull();

    await userEvent.click(within(card).getByRole("button", { name: /link catherine mccallen/i }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === "PATCH" && c.url === "/api/performers/p1")?.body,
      ).toEqual({ contactId: "c-live" }),
    );
  });

  it("keeps the no-contact wording for a performer with none (B57)", async () => {
    hub({ performer: { displayName: "Nobody Ned", contactId: null, contactName: null } });
    await userEvent.click(await countButton());
    const list = await screen.findByRole("list", { name: /need a contact/i });
    await userEvent.click(within(list).getByRole("button", { name: "Nobody Ned" }));

    const card = await screen.findByRole("dialog", { name: "Nobody Ned" });
    expect(await within(card).findByText(/has no contact/i)).toBeInTheDocument();
  });
});
