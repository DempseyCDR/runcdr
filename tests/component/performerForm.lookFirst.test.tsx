// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PerformerForm from "@/app/(admin)/_performers/PerformerForm";

/**
 * Feature 087 walk-through (2026-09-24, Rich): making a performer for someone already in the directory.
 *
 * Oliver Scanlon was a contact, with his email, but not a performer. Creating him as a performer with that
 * email was refused (the address belongs to his contact); creating him without it succeeded — and made a
 * SECOND contact for him, which now has to be deduplicated. The form never looked for him first.
 *
 * It now looks, by name and by the email typed, as the unlinked-performer question already does (084
 * FR-026): a person who is already a contact is offered, and linking makes no new record.
 */

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
const OLIVER = { id: "c-oliver", displayName: "Oliver Scanlon" };

function stub(byQuery: (q: string) => { id: string; displayName: string }[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = async () => {
        if (url.startsWith("/api/contacts?")) {
          const q = new URL(url, "http://x").searchParams.get("q") ?? "";
          return { items: byQuery(q), truncated: false };
        }
        return { id: "p-new", displayName: "Oliver Scanlon" };
      };
      return { ok: true, status: method === "POST" ? 201 : 200, json };
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

async function fillAndCreate(email?: string) {
  const onSaved = vi.fn();
  render(<PerformerForm initialName="Oliver Scanlon" onSaved={onSaved} onClose={() => {}} />);
  if (email) await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.click(screen.getByLabelText(/calls/i));
  await userEvent.click(screen.getByRole("button", { name: /^create$/i }));
  return { onSaved };
}

describe("PerformerForm — look before creating a contact (087 walk-through)", () => {
  it("offers the contact who is already there, and links him instead of making a second", async () => {
    const calls = stub((q) => (/scanlon/i.test(q) ? [OLIVER] : []));
    const { onSaved } = await fillAndCreate();

    expect(await screen.findByText(/already in the directory/i)).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: /use oliver scanlon/i }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ url: "/api/performers", method: "POST" });
    expect(writes(calls)[0]!.body).toMatchObject({ contactId: "c-oliver", isCaller: true });
    expect(writes(calls)[0]!.body).not.toHaveProperty("firstName");
    expect(onSaved).toHaveBeenCalled();
  });

  it("finds him by the email typed, even under another name", async () => {
    const calls = stub((q) => (q === "oliver@example.org" ? [OLIVER] : []));
    await fillAndCreate("oliver@example.org");

    expect(await screen.findByRole("button", { name: /use oliver scanlon/i })).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("q=oliver%40example.org"))).toBe(true);
  });

  it("creates a new contact when told it is someone else", async () => {
    const calls = stub(() => [OLIVER]);
    await fillAndCreate();
    await userEvent.click(
      await screen.findByRole("button", { name: /no — create a new contact/i }),
    );

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toMatchObject({ firstName: "Oliver", lastName: "Scanlon" });
  });

  it("creates straight away when nobody matches", async () => {
    const calls = stub(() => []);
    await fillAndCreate();

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toMatchObject({ firstName: "Oliver", lastName: "Scanlon" });
  });
});
