// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventModal } from "@/app/(admin)/_modals/EventModal";

/**
 * Feature 087 walk-through — cancelling a dance from Booking Central.
 *
 * Cancelling a dance is Booker work (feature 018) that lived only on the events page, and the event form's
 * own "Cancel" button meant "close without saving" — two different acts under one word. The form's button
 * is now "Close"; cancelling, reviving and deleting the DANCE are separate, confirmed actions, offered only
 * where the host asks for them (the hub). The events page keeps its own controls unchanged.
 */

type Call = { url: string; method: string; body: unknown };
type Reply = { status: number; body?: unknown };

function stub(reply: (url: string, method: string, n: number) => Reply = () => ({ status: 200 })) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const n = calls.filter((c) => c.method === method).length;
      const r = method === "GET" ? { status: 200, body: { rentCents: 0 } } : reply(url, method, n);
      return { ok: r.status < 400, status: r.status, json: async () => r.body ?? {} };
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EVENT = {
  id: "e1",
  seriesKey: "tnc",
  eventDate: "2026-10-01",
  startTime: "19:30:00",
  venueId: null,
  rentCents: null,
  label: "Waltz night",
  description: "",
  note: null,
  status: "scheduled" as const,
};

const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

function open(over: Partial<typeof EVENT> | { status: "cancelled" } = {}, withStatus = true) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <EventModal
      mode="edit"
      event={{ ...EVENT, ...over }}
      venues={[]}
      withNote
      withStatus={withStatus}
      onSaved={onSaved}
      onClose={onClose}
    />,
  );
  return { onSaved, onClose };
}

describe("the event form — closing is not cancelling", () => {
  it("names its own button Close, never Cancel", () => {
    stub();
    open();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).toBeNull();
  });
});

describe("cancelling a dance from the hub", () => {
  it("cancels the dance only after asking, and keeps it on asking again", async () => {
    const calls = stub();
    const { onSaved } = open();

    await userEvent.click(screen.getByRole("button", { name: /cancel this dance/i }));
    expect(writes(calls)).toHaveLength(0);
    expect(screen.getByText(/its bookings are kept/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /keep it/i }));
    expect(writes(calls)).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: /cancel this dance/i }));
    await userEvent.click(screen.getByRole("button", { name: /yes, cancel the dance/i }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toEqual({
      url: "/api/events/e1",
      method: "PATCH",
      body: { status: "cancelled" },
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("revives a cancelled dance", async () => {
    const calls = stub();
    open({ status: "cancelled" });
    expect(screen.queryByRole("button", { name: /cancel this dance/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /revive this dance/i }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ method: "PATCH", body: { status: "scheduled" } });
  });

  it("deletes a dance made by mistake, after asking", async () => {
    const calls = stub(() => ({ status: 204 }));
    const { onSaved } = open();

    await userEvent.click(screen.getByRole("button", { name: /delete this dance/i }));
    expect(writes(calls)).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: /yes, delete it/i }));

    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ url: "/api/events/e1", method: "DELETE" });
    expect(onSaved).toHaveBeenCalled();
  });

  it("says what stands in the way when a dance has history — cancel it instead", async () => {
    stub(() => ({
      status: 409,
      body: { error: { code: "EVENT_HAS_HISTORY", detail: "3 bookings" } },
    }));
    const { onSaved } = open();

    await userEvent.click(screen.getByRole("button", { name: /delete this dance/i }));
    await userEvent.click(screen.getByRole("button", { name: /yes, delete it/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/3 bookings.*cancel it instead/i);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("asks again before discarding check-ins, then deletes with that confirmed", async () => {
    const calls = stub((_url, method, n) =>
      method === "DELETE" && n === 1
        ? { status: 409, body: { error: { code: "EVENT_HAS_ATTENDANCE", detail: 12 } } }
        : { status: 204 },
    );
    open();

    await userEvent.click(screen.getByRole("button", { name: /delete this dance/i }));
    await userEvent.click(screen.getByRole("button", { name: /yes, delete it/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /delete and discard 12 check-ins/i }),
    );

    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    expect(writes(calls)[1]!.url).toBe("/api/events/e1?confirmDiscardAttendance=true");
  });

  it("offers none of it where the host does not ask — the events page keeps its own", () => {
    stub();
    open({}, false);
    expect(screen.queryByRole("button", { name: /cancel this dance/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete this dance/i })).toBeNull();
  });

  it("offers none of it read-only", () => {
    stub();
    render(<EventModal mode="readonly" event={EVENT} venues={[]} withStatus onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /cancel this dance/i })).toBeNull();
  });

  // 087 walk-through, second round: one row at the foot of the form. Feature 089 made that row the
  // dialog's action bar: Close first, the dance's own actions, and Save last — bottom right.
  it("puts close, cancel, delete and save in the action bar, in that order (089)", () => {
    stub();
    open();
    const bar = within(screen.getByRole("dialog")).getByRole("group", { name: "Actions" });
    expect(
      within(bar)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Close", "Cancel this dance…", "Delete this dance…", "Save"]);
  });
});
