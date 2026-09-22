// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PerformerForm from "@/app/(admin)/manage/performers/PerformerForm";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };

function stub(opts: { suggestions?: unknown[]; nearMatch?: unknown[] } = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({
        url: u,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (u.includes("/link-suggestions"))
        return { ok: true, status: 200, json: async () => ({ items: opts.suggestions ?? [] }) };
      if (u.includes("/api/contacts") && (init?.method ?? "GET") === "GET")
        return { ok: true, status: 200, json: async () => ({ items: opts.nearMatch ?? [] }) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "c-new", displayName: "Newt Player" }),
      };
    }),
  );
  return calls;
}

const CLARA = {
  id: "p-clara",
  displayName: "Clara Reidlinger",
  bio: null,
  photoUrl: null,
  isPublic: false,
  isCaller: false,
  styles: [],
  links: [],
  contactId: null,
  contactName: null,
  archivedAt: null,
};
const RIEDLINGER = { id: "c-clara", displayName: "Clara Riedlinger", similarity: 0.619 };
const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

/**
 * Feature 084 US4 (FR-021 to FR-027): opening a performer with no contact settles it — link, create, or
 * archive — before anything else. The live case is Clara: performer "Reidlinger", contact "Riedlinger".
 */
describe("the performer with no contact", () => {
  it("asks first, offering all three ways out (FR-021, FR-024)", async () => {
    stub({ suggestions: [RIEDLINGER] });
    render(<PerformerForm performer={CLARA} onSaved={() => {}} onClose={() => {}} />);

    expect(await screen.findByText(/no contact/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Link Clara Riedlinger/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create a contact" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    // FR-024: the rest of the form waits.
    expect(screen.queryByLabelText("Biography")).toBeNull();
  });

  it("offers the likely contact first, misspelling and all (FR-022)", async () => {
    stub({
      suggestions: [RIEDLINGER, { id: "c-other", displayName: "Barbara Clarke", similarity: 0.24 }],
    });
    render(<PerformerForm performer={CLARA} onSaved={() => {}} onClose={() => {}} />);

    const buttons = await screen.findAllByRole("button", { name: /^Link / });
    expect(buttons[0]).toHaveAccessibleName(/Clara Riedlinger/);
  });

  it("links the contact, then offers its spelling for the performer (FR-027)", async () => {
    const calls = stub({ suggestions: [RIEDLINGER] });
    const user = userEvent.setup();
    render(<PerformerForm performer={CLARA} onSaved={() => {}} onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /Link Clara Riedlinger/ }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ contactId: "c-clara" });

    // The names differ — the contact's spelling is offered, and can be declined.
    expect(await screen.findByText(/Clara Riedlinger/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use the contact's spelling" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]!.body).toEqual({ displayName: "Clara Riedlinger" });
  });

  it("asks 'did you mean' before creating a contact that looks like one already there (FR-026)", async () => {
    const calls = stub({ suggestions: [], nearMatch: [RIEDLINGER] });
    const user = userEvent.setup();
    render(<PerformerForm performer={CLARA} onSaved={() => {}} onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: "Create a contact" }));
    expect(await screen.findByText(/did you mean/i)).toBeInTheDocument();
    expect(writes(calls).filter((c) => c.url.endsWith("/api/contacts"))).toHaveLength(0);
  });

  it("never asks a performer who already has a contact (FR-025)", async () => {
    stub();
    render(
      <PerformerForm
        performer={{ ...CLARA, contactId: "c-clara", contactName: "Clara Riedlinger" }}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText(/no contact/i)).toBeNull();
    expect(screen.getByLabelText("Biography")).toBeInTheDocument();
  });
});
