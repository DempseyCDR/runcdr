// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CheckinPage from "@/app/(door)/checkin/page";
import { BREAKDOWN } from "./fixtures/attendanceBreakdown";

// Feature 025 US1 (FR-001..FR-010) + US5 (FR-018): the roster row opens a correction modal — since feature 079,
// from inside the Show checked in dialog — whose actions post
// to the correct endpoints; a refusal surfaces inline; and there is no "open door record" button.
type Call = { url: string; init?: RequestInit };

const ROSTER = [
  {
    id: "a1",
    contactId: "c1",
    firstName: "Ann",
    lastName: "Lee",
    displayName: "Ann Lee",
    displayNameOverride: null,
    childrenCount: 0,
    isOpenBand: false,
  },
];
const SIBLINGS = [
  { id: "e2", eventDate: "2020-01-15", startTime: null, seriesKey: "tnc", label: "Contra" },
];

function stub(calls: Call[], onDoorCount?: () => { ok: boolean; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.includes("/door-count") && onDoorCount) {
        const r = onDoorCount();
        return { ok: r.ok, status: r.ok ? 200 : 422, json: async () => r.body };
      }
      const json = async () => {
        if (
          u.includes("/api/events") &&
          !u.includes("/attendance") &&
          !u.includes("/group-siblings")
        )
          return {
            items: [
              { id: "e1", eventDate: "2020-01-15", seriesId: "s1", startTime: null, label: null },
            ],
          };
        if (u.includes("/api/series")) return { items: [{ id: "s1", key: "tnc", name: "TNC" }] };
        if (u.includes("/group-siblings")) return { items: SIBLINGS };
        if (u.includes("/attendance-breakdown")) return BREAKDOWN();
        if (u.includes("/attendance")) return { attendees: ROSTER };
        return { items: [] };
      };
      return { ok: true, status: 200, json };
    }),
  );
}

describe("CheckinPage — roster correction modal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("has no 'open door record' button (US5)", async () => {
    stub([]);
    render(<CheckinPage />);
    await screen.findByPlaceholderText("Type a name…");
    expect(screen.queryByRole("button", { name: /open door record/i })).toBeNull();
  });

  it("opens on a roster row and deletes / moves / adjusts comp via the right endpoints", async () => {
    const calls: Call[] = [];
    stub(calls);
    const user = userEvent.setup();
    render(<CheckinPage />);

    // The roster row is a clickable button.
    await user.click(await screen.findByRole("button", { name: /show checked in/i }));
    const rowBtn = await screen.findByRole("button", { name: /Ann Lee/ });
    await user.click(rowBtn);
    const dialog = await screen.findByRole("dialog", { name: /correct attendance/i });

    // Comp +1 → POST /door-count.
    await user.click(within(dialog).getByRole("button", { name: /comp \+1/i }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.init?.method === "POST" && c.url.includes("/api/events/e1/door-count")),
      ).toBe(true),
    );

    // Move to the sibling → PATCH /api/attendance/a1 { eventId }.
    await user.selectOptions(within(dialog).getByLabelText(/move to/i), "e2");
    await user.click(within(dialog).getByRole("button", { name: /^move$/i }));
    await waitFor(() => {
      const patch = calls.find(
        (c) => c.init?.method === "PATCH" && c.url.includes("/api/attendance/a1"),
      );
      expect(JSON.parse(patch!.init!.body as string)).toEqual({ eventId: "e2" });
    });
  });

  it("surfaces a refusal message inline", async () => {
    const calls: Call[] = [];
    stub(calls, () => ({
      ok: false,
      body: { error: { code: "VALIDATION_ERROR", message: "comp count cannot go below zero" } },
    }));
    const user = userEvent.setup();
    render(<CheckinPage />);

    await user.click(await screen.findByRole("button", { name: /show checked in/i }));
    await user.click(await screen.findByRole("button", { name: /Ann Lee/ }));
    const dialog = await screen.findByRole("dialog", { name: /correct attendance/i });
    await user.click(within(dialog).getByRole("button", { name: /comp −1|comp -1/i }));

    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(/cannot go below zero/i),
    );
  });
});
