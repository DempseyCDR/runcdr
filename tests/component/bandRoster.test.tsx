// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BandRoster from "@/app/(admin)/bookings/BandRoster";

/**
 * Feature 087 US3 (FR-021 to FR-024) — a band's roster, edited from the hub.
 *
 * The page this replaces listed EVERY performer with a checkbox beside each; a band showed as the few
 * that happened to be ticked among hundreds. Here a band lists its members and only its members: a
 * checkbox to take one off, a radio to pick the lead, and a search to add someone.
 */

type Member = {
  performerId: string;
  performerName: string;
  isLead: boolean;
  instrument: string | null;
};
type Call = { url: string; method: string; body?: unknown };

const ANN: Member = {
  performerId: "p1",
  performerName: "Ann Lead",
  isLead: true,
  instrument: "fiddle",
};
const BO: Member = {
  performerId: "p2",
  performerName: "Bo Piano",
  isLead: false,
  instrument: null,
};
const CY: Member = {
  performerId: "p3",
  performerName: "Cy Guitar",
  isLead: false,
  instrument: null,
};

function stub(members: Member[], emails: Record<string, string | null> = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const json = async (): Promise<unknown> => {
        const mailto = url.match(/\/api\/performers\/([^/]+)\/mailto/);
        if (mailto) return { email: emails[mailto[1]!] ?? null };
        if (url.includes("/api/performers?")) {
          return { items: [{ id: "p4", displayName: "Dee Bass" }], truncated: false };
        }
        if (url.includes("/api/bands/band1") && method === "GET") {
          return {
            id: "band1",
            name: "Glenrose",
            bio: null,
            photoUrl: null,
            isPublic: false,
            styles: [],
            links: [],
            archivedAt: null,
            members,
          };
        }
        return {};
      };
      return { ok: true, status: 200, json };
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const members = () => screen.getByRole("group", { name: /members/i });
const saved = (calls: Call[]) =>
  calls.find((c) => c.url.includes("/api/bands/band1") && c.method === "PATCH")?.body as
    | { members: { performerId: string; isLead: boolean }[] }
    | undefined;

async function open(ms: Member[], emails?: Record<string, string | null>) {
  const calls = stub(ms, emails);
  render(<BandRoster bandId="band1" onSaved={() => {}} onClose={() => {}} />);
  await screen.findByRole("checkbox", { name: ms[0]!.performerName });
  return calls;
}

describe("BandRoster — members, not the whole directory (087 US3, FR-021)", () => {
  it("lists the band's members, each ticked, and nobody else (T042)", async () => {
    await open([ANN, BO, CY]);
    const boxes = within(members()).getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Ann Lead",
      "Bo Piano",
      "Cy Guitar",
    ]);
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
  });

  it("marks the lead with a radio (T042, FR-022)", async () => {
    await open([ANN, BO, CY]);
    expect(within(members()).getByRole("radio", { name: /lead: ann lead/i })).toBeChecked();
    expect(within(members()).getByRole("radio", { name: /lead: bo piano/i })).not.toBeChecked();
  });

  it("takes a member off when unticked, and keeps everyone else (T042)", async () => {
    const calls = await open([ANN, BO, CY]);
    await userEvent.click(screen.getByRole("checkbox", { name: "Bo Piano" }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(saved(calls)).toBeDefined());
    expect(saved(calls)!.members.map((m) => m.performerId)).toEqual(["p1", "p3"]);
    expect(saved(calls)!.members.find((m) => m.performerId === "p1")?.isLead).toBe(true);
  });

  it("adds a performer found by searching (T042)", async () => {
    const calls = await open([ANN, BO]);
    await userEvent.type(screen.getByRole("searchbox", { name: /add a member/i }), "Dee");
    await userEvent.click(await screen.findByRole("button", { name: /add dee bass/i }));
    expect(within(members()).getByRole("checkbox", { name: "Dee Bass" })).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(saved(calls)).toBeDefined());
    expect(saved(calls)!.members).toContainEqual(
      expect.objectContaining({ performerId: "p4", isLead: false }),
    );
  });

  it("moves the lead when another member's radio is chosen (T042, FR-022)", async () => {
    const calls = await open([ANN, BO]);
    await userEvent.click(screen.getByRole("radio", { name: /lead: bo piano/i }));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(saved(calls)).toBeDefined());
    expect(
      saved(calls)!
        .members.filter((m) => m.isLead)
        .map((m) => m.performerId),
    ).toEqual(["p2"]);
  });
});

describe("BandRoster — removing the lead (087 US3, FR-023)", () => {
  it("leaves the band with no lead, said plainly — never a lead who is not a member (T043)", async () => {
    const calls = await open([ANN, BO, CY]);
    await userEvent.click(screen.getByRole("checkbox", { name: "Ann Lead" }));

    expect(screen.getByText(/this band has no lead/i)).toBeInTheDocument();
    expect(within(members()).queryAllByRole("radio", { checked: true })).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(saved(calls)).toBeDefined());
    expect(saved(calls)!.members.map((m) => m.performerId)).toEqual(["p2", "p3"]);
    expect(saved(calls)!.members.some((m) => m.isLead)).toBe(false);
  });
});

describe("BandRoster — a band with no lead (087 US3, FR-024)", () => {
  it("offers the members who have an email address, and only them (T044)", async () => {
    await open([{ ...ANN, isLead: false }, BO, CY], {
      p1: "ann@example.org",
      p2: "bo@example.org",
      p3: null,
    });

    const contact = await screen.findByRole("list", { name: /contact a member/i });
    const links = within(contact).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Ann Lead", "Bo Piano"]);
    expect(links[1]).toHaveAttribute("href", expect.stringContaining("mailto:bo@example.org"));
  });

  it("says so plainly when no member has an email address (T044)", async () => {
    await open([{ ...ANN, isLead: false }, BO], {});
    expect(await screen.findByText(/no member has an email address/i)).toBeInTheDocument();
  });

  it("asks for nobody's email while the band has a lead", async () => {
    const calls = await open([ANN, BO]);
    expect(calls.some((c) => c.url.includes("/mailto"))).toBe(false);
  });
});
