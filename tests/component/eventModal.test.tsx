// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventModal } from "@/app/(admin)/_modals/EventModal";

type Call = { url: string; init?: RequestInit };
function stubFetch(calls: Call[], body: (url: string) => unknown) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => body(url) };
  });
}

const VENUES = [
  { id: "v1", name: "German House", shortName: "GH" },
  { id: "v2", name: "The Rose Room", shortName: "TRR" },
];

describe("EventModal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("edit: shows fields and the resolved rent default; re-defaults when the venue changes", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch(calls, (url) => {
        if (url.includes("/rent-preview") && url.includes("venueId=v2"))
          return { rentCents: 35000 };
        if (url.includes("/rent-preview")) return { rentCents: 20000 };
        return {};
      }),
    );
    const user = userEvent.setup();
    const event = {
      id: "e1",
      seriesKey: "tnc",
      eventDate: "2026-06-18",
      startTime: "19:30",
      venueId: "v1",
      rentCents: null,
      label: "",
      description: "",
    };
    render(
      <EventModal
        mode="edit"
        event={event}
        venues={VENUES}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    // Rent shows the resolved default (never blank).
    await waitFor(() =>
      expect((screen.getByLabelText(/rent/i) as HTMLInputElement).value).toBe("200"),
    );
    // Change the venue → rent re-defaults to the new venue's rate.
    await user.selectOptions(screen.getByLabelText(/venue/i), "v2");
    await waitFor(() =>
      expect((screen.getByLabelText(/rent/i) as HTMLInputElement).value).toBe("350"),
    );
  });

  it("Save sends rentCents:null when left at the default, the typed value otherwise (Option A)", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch(calls, (url) => (url.includes("/rent-preview") ? { rentCents: 20000 } : {})),
    );
    const user = userEvent.setup();
    // The DB `time` column renders "HH:MM:SS" — the modal must normalise to "HH:MM" or the event PATCH
    // (which validates HH:MM) 422s on an unchanged start time.
    const event = {
      id: "e1",
      seriesKey: "tnc",
      eventDate: "2026-06-18",
      startTime: "19:30:00",
      venueId: "v1",
      rentCents: null,
      label: "",
      description: "",
    };

    const { rerender } = render(
      <EventModal
        mode="edit"
        event={event}
        venues={VENUES}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText(/rent/i) as HTMLInputElement).value).toBe("200"),
    );
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    // Feature 084 (FR-028): a save carries only what changed. Nothing was touched here, so nothing is
    // sent at all — which also makes the 422 this test once guarded (an unchanged "19:30:00" start time
    // failing HH:MM validation) impossible rather than merely handled.
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.some((c) => c.init?.method === "PATCH")).toBe(false);

    // Type a different rent → the override is sent.
    calls.length = 0;
    rerender(
      <EventModal
        mode="edit"
        event={event}
        venues={VENUES}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText(/rent/i) as HTMLInputElement).value).toBe("200"),
    );
    await user.clear(screen.getByLabelText(/rent/i));
    await user.type(screen.getByLabelText(/rent/i), "150");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    const patch2 = calls.find((c) => c.init?.method === "PATCH")!;
    expect(JSON.parse(patch2.init!.body as string).rentCents).toBe(15000);
  });

  // Feature 084 US1 (FR-001, FR-028): the label, description and start time an event holds are editable
  // here — `/events` collected them on creation and then offered no way to change them.
  it("edits the label, description and start time, sending only what changed", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      stubFetch(calls, (url) => (url.includes("/rent-preview") ? { rentCents: 20000 } : {})),
    );
    const user = userEvent.setup();
    render(
      <EventModal
        mode="edit"
        event={{
          id: "e1",
          seriesKey: "tnc",
          eventDate: "2026-06-18",
          startTime: "19:30:00",
          venueId: "v1",
          rentCents: null,
          label: "",
          description: "",
        }}
        venues={VENUES}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText(/rent/i) as HTMLInputElement).value).toBe("200"),
    );

    await user.type(screen.getByLabelText(/label/i), "Afternoon");
    await user.type(screen.getByLabelText(/description/i), "Live band, beginners welcome");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    const body = JSON.parse(calls.find((c) => c.init?.method === "PATCH")!.init!.body as string);
    expect(body).toEqual({ label: "Afternoon", description: "Live band, beginners welcome" });
  });

  it("read-only: Close only", () => {
    vi.stubGlobal(
      "fetch",
      stubFetch([], () => ({ rentCents: 0 })),
    );
    const event = {
      id: "e1",
      seriesKey: "tnc",
      eventDate: "2026-06-18",
      startTime: null,
      venueId: null,
      rentCents: null,
      label: "",
      description: "",
    };
    render(<EventModal mode="readonly" event={event} venues={VENUES} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /^Close$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save$/ })).not.toBeInTheDocument();
  });
});
