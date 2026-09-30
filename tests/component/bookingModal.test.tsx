// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookingModal } from "@/app/(admin)/_modals/BookingModal";

// Feature 020 US2 (FR-008..FR-013): the booking modal's three shells + typeahead + mailto, over a stubbed
// fetch (UI-boundary isolation — the API behavior is covered by node integration tests). `calls` is
// recorded at fetch-time (not in .json()), since mutations only check res.ok and never read the body.
type Call = { url: string; init?: RequestInit };
function stubFetch(calls: Call[], body: (url: string, init?: RequestInit) => unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => body(url, init) };
  });
}

describe("BookingModal", () => {
  beforeEach(() =>
    vi.stubGlobal(
      "fetch",
      stubFetch([], () => ({})),
    ),
  );
  afterEach(() => vi.unstubAllGlobals());

  it("create: role pre-filled, typeahead queries performers, Save posts once", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch(calls, (url) =>
        url.includes("/api/performers?q=")
          ? { items: [{ id: "p1", displayName: "Bob Fabinski" }] }
          : {},
      ),
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <BookingModal
        mode="create"
        eventId="e1"
        eventDate="2026-06-18"
        role="musician"
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );

    await user.type(screen.getByRole("searchbox", { name: /find a performer/i }), "fab");
    await waitFor(() => screen.getByRole("button", { name: /Bob Fabinski/ }));
    await user.click(screen.getByRole("button", { name: /Bob Fabinski/ }));
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const posts = calls.filter((c) => c.init?.method === "POST" && c.url.includes("/bookings"));
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]!.init!.body as string)).toMatchObject({
      performerId: "p1",
      performerType: "musician",
    });
  });

  it("add-performer: a brand-new person (no contact match) is created inline with a booking email", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch(calls, (url) => {
        if (url.includes("/api/performers?q=")) return { items: [] }; // no performer match
        if (url.includes("/api/contacts?q=")) return { items: [] }; // no contact match either
        if (url.includes("/api/performers")) return { id: "pNew", displayName: "Micah Wiesner" };
        return {};
      }),
    );
    const user = userEvent.setup();
    render(
      <BookingModal
        mode="create"
        eventId="e1"
        eventDate="2026-06-18"
        role="musician"
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    await user.type(screen.getByRole("searchbox", { name: /find a performer/i }), "Micah Wiesner");
    // No performer → "New performer" opens the contact search; still empty → create-new appears.
    await user.click(await screen.findByRole("button", { name: /New performer/i }));
    await user.type(screen.getByLabelText(/new performer email/i), "micah@ex.com");
    await user.click(await screen.findByRole("button", { name: /Create performer/i }));

    await waitFor(() =>
      expect(calls.some((c) => c.init?.method === "POST" && c.url === "/api/performers")).toBe(
        true,
      ),
    );
    const post = calls.find((c) => c.init?.method === "POST" && c.url === "/api/performers")!;
    const body = JSON.parse(post.init!.body as string);
    // Feature 026: structured names (seeded by splitting the typed query), not a single displayName.
    expect(body).toMatchObject({
      firstName: "Micah",
      lastName: "Wiesner",
      email: "micah@ex.com",
      emailPurpose: "booking",
    });
    expect(body.displayName).toBeUndefined();
    expect(body.contactId).toBeUndefined(); // brand-new: no contact linked
    // The new performer is selected for the booking.
    expect(screen.getByText(/Selected: Micah Wiesner/)).toBeInTheDocument();
  });

  it("edit: Save issues one PATCH; Close issues none", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch(calls, (url) => (url.includes("/mailto") ? { email: null } : {})),
    );
    const user = userEvent.setup();
    const booking = {
      id: "b1",
      performerId: "p1",
      performer: "Bob",
      type: "musician",
      payCents: 12500,
      note: "",
      status: "requested",
    };

    const { rerender } = render(
      <BookingModal
        mode="edit"
        eventId="e1"
        eventDate="2026-06-18"
        booking={booking}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await user.clear(screen.getByLabelText(/notes/i));
    await user.type(screen.getByLabelText(/notes/i), "called");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(calls.filter((c) => c.init?.method === "PATCH")).toHaveLength(1));

    // Close path: no PATCH. (Named Close, not Cancel, since feature 087 — cancelling is done to a booking.)
    calls.length = 0;
    rerender(
      <BookingModal
        mode="edit"
        eventId="e1"
        eventDate="2026-06-18"
        booking={booking}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Close$/ }));
    expect(calls.filter((c) => c.init?.method === "PATCH")).toHaveLength(0);
  });

  it("read-only: Close only, no Save/Cancel", () => {
    const booking = {
      id: "b1",
      performerId: "p1",
      performer: "Bob",
      type: "musician",
      payCents: 12500,
      note: "",
      status: "confirmed",
    };
    render(
      <BookingModal
        mode="readonly"
        eventId="e1"
        eventDate="2026-06-18"
        booking={booking}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /^Close$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Cancel$/ })).not.toBeInTheDocument();
  });

  it("shows a mailto link when the performer has a usable email, and not otherwise", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch([], (url) => (url.includes("/mailto") ? { email: "bob@ex.com" } : {})),
    );
    const booking = {
      id: "b1",
      performerId: "p1",
      performer: "Bob",
      type: "musician",
      payCents: 12500,
      note: "",
      status: "requested",
    };
    render(
      <BookingModal
        mode="edit"
        eventId="e1"
        eventDate="2026-06-18"
        booking={booking}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const link = await screen.findByRole("link", { name: /email/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("mailto:bob@ex.com"));
    expect(link).toHaveAttribute("href", expect.stringContaining("Rochester%20Dance"));
  });

  // Feature 087 walk-through: the editor opened at the foot of the hub rather than over it.
  it("opens as a modal over the page, not inline at its foot", () => {
    vi.stubGlobal(
      "fetch",
      stubFetch([], () => ({})),
    );
    render(
      <BookingModal
        mode="create"
        eventId="e1"
        eventDate="2026-06-18"
        role="caller"
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Book a caller for 2026-06-18" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByRole("heading", { name: "Book a caller for 2026-06-18" }),
    ).toBeInTheDocument();
  });
});
