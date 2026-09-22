// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PerformerForm from "@/app/(admin)/manage/performers/PerformerForm";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };

function stub(over: Record<string, unknown> = {}): Call[] {
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
      if (u.includes("/mailto"))
        return { ok: true, status: 200, json: async () => ({ email: over.email ?? null }) };
      return { ok: true, status: 200, json: async () => ({ id: "p1", items: [] }) };
    }),
  );
  return calls;
}

const PAT = {
  id: "p1",
  displayName: "Pat Caller",
  bio: "Calls contras and squares",
  photoUrl: null,
  isPublic: true,
  isCaller: true,
  styles: ["contra"],
  links: [],
  contactId: "c-pat",
  contactName: "Patricia Caller",
  archivedAt: null,
};

const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

/**
 * Feature 084 US1 (FR-001 to FR-003, FR-018, FR-019, FR-028): the performer form, used to create and to
 * edit. Email and telephone belong to the linked CONTACT, so they are never editable here.
 */
describe("PerformerForm", () => {
  it("offers every field the performer holds, filled in, when editing", () => {
    stub();
    render(<PerformerForm performer={PAT} onSaved={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText("Display name")).toHaveValue("Pat Caller");
    expect(screen.getByLabelText("Biography")).toHaveValue("Calls contras and squares");
    expect(screen.getByRole("checkbox", { name: "Shown on the public site" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Calls" })).toBeChecked();
  });

  it("sends only the field that changed (FR-028)", async () => {
    const calls = stub();
    const user = userEvent.setup();
    render(<PerformerForm performer={PAT} onSaved={() => {}} onClose={() => {}} />);

    const bio = screen.getByLabelText("Biography");
    await user.clear(bio);
    await user.type(bio, "Calls for the Thursday series");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.method).toBe("PATCH");
    expect(writes(calls)[0]!.url).toContain("/api/performers/p1");
    expect(writes(calls)[0]!.body).toEqual({ bio: "Calls for the Thursday series" });
  });

  it("points at the contact record for email and telephone, and never offers to change them (FR-018)", () => {
    stub();
    render(<PerformerForm performer={PAT} onSaved={() => {}} onClose={() => {}} />);
    const link = screen.getByRole("link", { name: /Patricia Caller/ });
    expect(link).toHaveAttribute("href", "/contacts?contactId=c-pat");
    expect(screen.getByText(/email and telephone/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Telephone")).toBeNull();
  });

  it("says nothing about email or telephone when no contact is linked (FR-019)", () => {
    stub();
    render(
      <PerformerForm
        performer={{ ...PAT, contactId: null, contactName: null }}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText(/email and telephone/i)).toBeNull();
  });

  it("shows the performer read-only to someone who may not change them (FR-003)", () => {
    stub();
    render(<PerformerForm performer={PAT} readOnly onSaved={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText("Display name")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
