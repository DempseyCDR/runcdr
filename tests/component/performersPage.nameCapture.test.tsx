// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PerformersPage from "@/app/(admin)/manage/performers/page";

// Feature 026 US2 (FR-004): the performers-page create form captures structured first/last/display and POSTs
// them — no single `displayName`.
type Call = { url: string; init?: RequestInit };

function stub(calls: Call[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 201,
        json: async () =>
          String(url).includes("/api/performers") && init?.method !== "POST"
            ? { items: [] }
            : { id: "p1", displayName: "Chuck Abell" },
      };
    }),
  );
}

describe("PerformersPage — structured name capture", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts firstName/lastName/displayNameOverride, not a single displayName", async () => {
    const calls: Call[] = [];
    stub(calls);
    const user = userEvent.setup();
    render(<PerformersPage />);

    // Feature 084: creating opens the one form the page also edits with (FR-002).
    await user.click(await screen.findByRole("button", { name: "Add a performer" }));
    await user.type(await screen.findByLabelText(/first name/i), "Charles");
    await user.type(screen.getByLabelText(/last name/i), "Abell");
    await user.type(screen.getByLabelText(/display name/i), "Chuck Abell");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      const post = calls.find(
        (c) => c.init?.method === "POST" && c.url.includes("/api/performers"),
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(post!.init!.body as string);
      expect(body).toMatchObject({
        firstName: "Charles",
        lastName: "Abell",
        displayNameOverride: "Chuck Abell",
      });
      expect(body.displayName).toBeUndefined();
    });
  });
});
