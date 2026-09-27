// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookingModal } from "@/app/(admin)/_modals/BookingModal";

/**
 * Feature 087 walk-through (2026-09-25, Rich): booking someone new to the club when the directory holds a
 * similar — but wrong — contact.
 *
 * The editor offered to link the similar contact and nothing else: no way to say "no, a new person", and
 * the new-person fields stayed hidden. Save then created a new contact anyway, from those hidden fields,
 * with no word that it had. Now it asks plainly, writes nothing until answered, and says what it made.
 */

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
const SIMILAR = { id: "c-hughes", displayName: "Catherine Hughes" };

function stub(contacts: { id: string; displayName: string }[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = async () => {
        if (url === "/api/performers" && method === "POST") {
          return { id: "p-new", displayName: "Catherine Holt" };
        }
        if (url.startsWith("/api/contacts?")) return { items: contacts };
        return { items: [] };
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

async function startNew(contacts: { id: string; displayName: string }[]) {
  const calls = stub(contacts);
  render(
    <BookingModal
      mode="create"
      eventId="e1"
      eventDate="2026-10-01"
      role="caller"
      onClose={() => {}}
    />,
  );
  await userEvent.type(
    screen.getByRole("searchbox", { name: /find a performer/i }),
    "Catherine Holt",
  );
  await userEvent.click(
    await screen.findByRole("button", { name: /new performer “catherine holt”/i }),
  );
  return calls;
}

describe("BookingModal — a new person, or one already in the directory?", () => {
  it("writes nothing when New performer is pressed — it only looks", async () => {
    const calls = await startNew([SIMILAR]);
    await screen.findByRole("button", { name: /link catherine hughes/i });
    expect(writes(calls)).toHaveLength(0);
  });

  it("asks plainly, offering the match AND a new contact", async () => {
    await startNew([SIMILAR]);
    expect(await screen.findByText(/already in the directory/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /link catherine hughes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /no — create a new contact/i })).toBeInTheDocument();
    // The new-person fields wait for that answer.
    expect(screen.queryByLabelText("New performer first name")).toBeNull();
  });

  it("will not save until the question is answered — and says so beside Save", async () => {
    const calls = await startNew([SIMILAR]);
    await screen.findByRole("button", { name: /link catherine hughes/i });
    const save = screen.getByRole("button", { name: /^save$/i });
    await userEvent.click(save);

    expect(within(save.parentElement!).getByRole("alert")).toHaveTextContent(
      /link .* or create a new contact/i,
    );
    expect(writes(calls)).toHaveLength(0);
  });

  it("makes a new contact when told to, and says it did", async () => {
    const calls = await startNew([SIMILAR]);
    await userEvent.click(
      await screen.findByRole("button", { name: /no — create a new contact/i }),
    );

    expect(screen.getByLabelText("New performer first name")).toHaveValue("Catherine");
    expect(screen.getByLabelText("New performer last name")).toHaveValue("Holt");
    await userEvent.click(screen.getByRole("button", { name: /create performer/i }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toMatchObject({ firstName: "Catherine", lastName: "Holt" });
    expect(await screen.findByRole("status")).toHaveTextContent(
      /created catherine holt — a new performer and contact/i,
    );
  });

  it("links the match when that is the answer, and says it did", async () => {
    const calls = await startNew([SIMILAR]);
    await userEvent.click(await screen.findByRole("button", { name: /link catherine hughes/i }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toEqual({ contactId: "c-hughes" });
    expect(await screen.findByRole("status")).toHaveTextContent(/linked/i);
  });

  it("goes straight to the new-person fields when nobody matches", async () => {
    await startNew([]);
    expect(await screen.findByLabelText("New performer first name")).toHaveValue("Catherine");
  });
});
