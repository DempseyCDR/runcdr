// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookingModal } from "@/app/(admin)/_modals/BookingModal";

// Feature 026 US2 (FR-004/FR-005): in the booking add-performer flow, linking an EXISTING contact posts only
// `{ contactId }` (no name captured). (The create-brand-new structured path is covered in bookingModal.test.tsx.)
type Call = { url: string; init?: RequestInit };

function stub(calls: Call[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      const json = async () => {
        if (u.includes("/api/performers?q=")) return { items: [] }; // no performer match
        if (u.includes("/api/contacts?q="))
          return { items: [{ id: "c9", displayName: "Ada Lovelace" }] };
        if (u.includes("/api/performers")) return { id: "pNew", displayName: "Ada Lovelace" };
        return {};
      };
      return { ok: true, status: 201, json };
    }),
  );
}

describe("BookingModal add-performer — link existing contact", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("linking an existing contact posts only { contactId } (no name)", async () => {
    const calls: Call[] = [];
    stub(calls);
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

    await user.type(screen.getByRole("searchbox", { name: /find a performer/i }), "Ada");
    await user.click(await screen.findByRole("button", { name: /New performer/i }));
    await user.click(await screen.findByRole("button", { name: /Link Ada Lovelace/i }));

    const post = calls.find((c) => c.init?.method === "POST" && c.url === "/api/performers")!;
    expect(post).toBeTruthy();
    const body = JSON.parse(post.init!.body as string);
    expect(body).toEqual({ contactId: "c9" });
    expect(body.displayName).toBeUndefined();
  });
});
