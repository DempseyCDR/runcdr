// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookingModal } from "@/app/(admin)/_modals/BookingModal";

// Feature 024 US3 (component, jsdom, stubbed fetch): the booking modal's substitute action POSTs substitute,
// and a re-point refused as paid surfaces the server's inline "settled by a live check" message. Split out
// of the bookings report's test when feature 087 deleted that page — these never depended on it.
type Call = { url: string; init?: RequestInit };

const BOOKING = {
  id: "b1",
  performerId: "p1",
  performer: "Booked Bo",
  type: "musician",
  payCents: 12500,
  note: null,
  status: "confirmed",
};

describe("BookingModal — substitute + paid refusal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("substitutes a performer via the substitute endpoint", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const json = async () =>
          url.includes("/api/performers?q=")
            ? { items: [{ id: "sub9", displayName: "Sub Sue" }] }
            : {};
        return { ok: true, status: 200, json };
      }),
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <BookingModal
        mode="edit"
        eventId="e1"
        eventDate="2026-06-18"
        booking={BOOKING}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );

    await user.type(screen.getByLabelText(/substitute performer/i), "sue");
    await waitFor(() => screen.getByRole("button", { name: /Substitute in Sub Sue/ }));
    await user.click(screen.getByRole("button", { name: /Substitute in Sub Sue/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const post = calls.find(
      (c) => c.init?.method === "POST" && c.url.includes("/api/bookings/b1/substitute"),
    )!;
    expect(post).toBeTruthy();
    expect(JSON.parse(post.init!.body as string)).toEqual({ newPerformerId: "sub9" });
  });

  it("surfaces the paid-refusal message inline when a re-point Save is refused (422)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return {
            ok: false,
            status: 422,
            json: async () => ({
              error: {
                code: "VALIDATION_ERROR",
                message:
                  "This booking is settled by a live check — void it first, or substitute the performer.",
              },
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );
    const user = userEvent.setup();
    render(
      <BookingModal
        mode="edit"
        eventId="e1"
        eventDate="2026-06-18"
        booking={BOOKING}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/settled by a live check/i),
    );
  });
});
