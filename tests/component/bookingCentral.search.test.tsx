// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingCentralPage from "@/app/(admin)/bookings/page";
import { answerReport, row } from "./fixtures/bookingCentral";

/**
 * Feature 087 US3 (FR-017, FR-018) — one search for performers AND bands.
 *
 * The Booker types a name without first deciding whether it is a band or a person. Each result says
 * which it is: there are no name collisions in the club's data today, but a band named after its lead is
 * normal in this music, so the tag has to be there before the collision rather than after.
 */

type Call = { url: string };

function stub() {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push({ url });
      const json = async (): Promise<unknown> => {
        if (url.includes("/api/me/capabilities"))
          return { mySeriesIds: ["s1"], bookingWrite: true };
        if (url.includes("/api/series")) {
          return { items: [{ id: "s1", key: "tnc", name: "Thursday Night Contra" }] };
        }
        if (url.includes("/api/bookings/report")) {
          return answerReport(
            [row({ eventId: "e1", date: "2026-10-01", label: "Waltz night" })],
            url,
          );
        }
        if (url.includes("/api/performers?")) {
          const archived = url.includes("archived=1");
          return {
            items: [
              { id: "p1", displayName: "Glenrose Smith" },
              ...(archived ? [{ id: "p2", displayName: "Glenda Retired" }] : []),
            ],
            truncated: false,
          };
        }
        if (url.includes("/api/bands?")) {
          return { items: [{ id: "band1", name: "Glenrose" }], truncated: false };
        }
        return { items: [] };
      };
      return { ok: true, status: 200, json };
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const results = () => screen.getByRole("list", { name: /search results/i });

describe("Booking Central — one search for performers and bands (087 US3)", () => {
  it("returns both kinds, each saying which it is (T040, FR-017)", async () => {
    stub();
    render(<BookingCentralPage />);

    await userEvent.type(
      await screen.findByRole("searchbox", { name: /find a performer or band/i }),
      "Glen",
    );

    await waitFor(() => expect(within(results()).getAllByRole("listitem")).toHaveLength(2));
    const items = within(results())
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items.some((t) => t?.includes("Glenrose Smith") && /performer/i.test(t))).toBe(true);
    expect(items.some((t) => t?.includes("Glenrose") && /band/i.test(t!))).toBe(true);
  });

  it("leaves archived records out until asked for (T040, FR-018)", async () => {
    const calls = stub();
    render(<BookingCentralPage />);

    const box = await screen.findByRole("searchbox", { name: /find a performer or band/i });
    await userEvent.type(box, "Glen");
    await waitFor(() => expect(within(results()).getAllByRole("listitem")).toHaveLength(2));
    expect(screen.queryByText("Glenda Retired")).toBeNull();

    await userEvent.click(screen.getByRole("checkbox", { name: /include archived/i }));
    expect(await screen.findByText("Glenda Retired")).toBeInTheDocument();
    expect(
      calls.some((c) => c.url.includes("/api/performers?") && c.url.includes("archived=1")),
    ).toBe(true);
  });

  it("asks nothing until something is typed", async () => {
    const calls = stub();
    render(<BookingCentralPage />);
    await screen.findByRole("searchbox", { name: /find a performer or band/i });

    expect(
      calls.some((c) => c.url.includes("/api/performers?") || c.url.includes("/api/bands?")),
    ).toBe(false);
  });
});
