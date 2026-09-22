// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VenueRents from "@/app/(admin)/venues/VenueRents";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };

function stub(rents: unknown[], opts: { refuseDelete?: boolean } = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u.includes("/api/series"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [{ id: "s1", key: "tnc", name: "Thursday Night Contra" }] }),
        };
      if (method === "DELETE" && opts.refuseDelete)
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: {
              code: "STILL_IN_USE",
              message:
                "That rent still has 2 dates to come, the next on 2026-10-08. Archive anyway?",
            },
          }),
        };
      if (method === "DELETE") return { ok: true, status: 204, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ items: rents }) };
    }),
  );
  return calls;
}

const RENT = {
  id: "r1",
  venueId: "v1",
  seriesId: "s1",
  amountCents: 25000,
  effectiveDate: "2026-01-01",
};

/** Feature 084 US5 (FR-015, FR-029, FR-030): a venue's rents, managed where the venue is. */
describe("VenueRents", () => {
  it("lists each rent with its series and the date it takes effect", async () => {
    stub([RENT]);
    render(<VenueRents venueId="v1" />);
    // The rent reads as one line: what it costs, whose series it is, and from when.
    const row = await screen.findByRole("listitem");
    expect(row).toHaveTextContent("$250.00");
    expect(row).toHaveTextContent("Thursday Night Contra");
    expect(row).toHaveTextContent("from 2026-01-01");
  });

  it("says none set rather than showing a misleading zero", async () => {
    stub([]);
    render(<VenueRents venueId="v1" />);
    expect(await screen.findByText("None set.")).toBeInTheDocument();
  });

  it("changes a rent by adding a new one from a date (FR-029)", async () => {
    const calls = stub([RENT]);
    const user = userEvent.setup();
    render(<VenueRents venueId="v1" />);

    await user.type(await screen.findByLabelText("Amount"), "300");
    await user.type(screen.getByLabelText("From"), "2026-08-01");
    await user.click(screen.getByRole("button", { name: "Add this rent" }));

    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url.includes("/api/venue-rents"))).toBe(
        true,
      ),
    );
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ venueId: "v1", amount: 300, effectiveDate: "2026-08-01" });
    // No existing amount was rewritten.
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("removes a rent nothing has used", async () => {
    const calls = stub([RENT]);
    const user = userEvent.setup();
    render(<VenueRents venueId="v1" />);

    await user.click(
      await screen.findByRole("button", { name: /Remove the rent from 2026-01-01/ }),
    );
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });

  it("says what uses a rent it may not remove (FR-030)", async () => {
    stub([RENT], { refuseDelete: true });
    const user = userEvent.setup();
    render(<VenueRents venueId="v1" />);

    await user.click(
      await screen.findByRole("button", { name: /Remove the rent from 2026-01-01/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("still has 2 dates to come");
  });
});
