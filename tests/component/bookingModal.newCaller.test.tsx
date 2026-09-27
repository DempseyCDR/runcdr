// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookingModal } from "@/app/(admin)/_modals/BookingModal";

/**
 * Feature 087 walk-through (2026-09-24, Rich): booking a caller who is new to the club.
 *
 * He typed Michael Karcher, chose to add him, filled in the new person, then pay and a note, and pressed
 * Save — and nothing appeared to happen. Nothing reached the server: the new performer had not been
 * created (that needed its own button), so Save refused with a message printed at the TOP of a dialog
 * scrolled to its foot. And the note would have been dropped anyway — creating never sent it.
 */

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };

function stub() {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = async () => {
        if (url === "/api/performers" && method === "POST") {
          return { id: "p-mk", displayName: "Michael Karcher" };
        }
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

function open() {
  const onSaved = vi.fn();
  render(
    <BookingModal
      mode="create"
      eventId="e1"
      eventDate="2026-12-31"
      role="caller"
      onSaved={onSaved}
      onClose={() => {}}
    />,
  );
  return { onSaved };
}

async function startNewPerson() {
  await userEvent.type(
    screen.getByRole("searchbox", { name: /find a performer/i }),
    "Michael Karcher",
  );
  await userEvent.click(
    await screen.findByRole("button", { name: /new performer “michael karcher”/i }),
  );
  await screen.findByLabelText("New performer first name");
}

describe("BookingModal — a caller new to the club", () => {
  it("sends the note with a new booking", async () => {
    const calls = stub();
    open();
    await startNewPerson();
    await userEvent.click(screen.getByRole("button", { name: /create performer/i }));
    await userEvent.type(screen.getByLabelText("Notes"), "flying in from Boston");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]).toMatchObject({
      url: "/api/events/e1/bookings",
      body: { performerId: "p-mk", performerType: "caller", note: "flying in from Boston" },
    });
  });

  it("creates the new person on Save when they were filled in but not yet created", async () => {
    const calls = stub();
    const { onSaved } = open();
    await startNewPerson();
    await userEvent.type(screen.getByLabelText("New performer email"), "mk@example.org");
    await userEvent.type(screen.getByLabelText(/^pay/i), "150");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[0]).toMatchObject({
      url: "/api/performers",
      body: { firstName: "Michael", lastName: "Karcher", email: "mk@example.org" },
    });
    expect(writes(calls)[1]).toMatchObject({
      url: "/api/events/e1/bookings",
      body: { performerId: "p-mk", pay: 150 },
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("says why it will not save beside the Save button, where the eye is", async () => {
    stub();
    open();
    const save = screen.getByRole("button", { name: /^save$/i });
    await userEvent.click(save);

    const actions = save.parentElement!;
    expect(within(actions).getByRole("alert")).toHaveTextContent(/choose a performer/i);
  });
});
