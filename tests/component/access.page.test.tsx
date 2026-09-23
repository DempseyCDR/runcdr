// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import AccessPage from "@/app/(admin)/access/page";

/**
 * Feature 086 US5 (FR-007, FR-008a, research R3): the screen tells the truth about series.
 *
 * Two causes, and the first is the one nobody suspected. The screen printed the bare words
 * "series-scoped" and never named WHICH series, so a Booker for TNC and a Booker for ECD rendered
 * identically — a second grant looked like a duplicate, and the club concluded a volunteer could hold
 * only one. Multi-series has always worked. It was invisible.
 *
 * The second cause is the grant form's free-text series key: adding a series meant knowing how it is
 * spelt, and a typo produced a grant matching nothing at all.
 */
const SERIES = [
  { id: "s1", key: "tnc", name: "Thursday Night Contra" },
  { id: "s2", key: "ecd", name: "Sunday English Country Dance" },
];

const VOLUNTEERS = [
  {
    contactId: "v1",
    displayName: "Peggy Dempsey",
    approvedAt: "2026-09-01T00:00:00.000Z",
    overdue: false,
    concentrationOfDuties: false,
    grants: [
      {
        id: "g1",
        role: "financial_secretary",
        seriesId: "s2",
        groupId: null,
        seriesKey: "ecd",
        seriesName: "Sunday English Country Dance",
      },
      {
        id: "g2",
        role: "booker",
        seriesId: "s1",
        groupId: null,
        seriesKey: "tnc",
        seriesName: "Thursday Night Contra",
      },
    ],
  },
  {
    contactId: "v2",
    displayName: "Michael Pallischeck",
    approvedAt: "2026-09-01T00:00:00.000Z",
    overdue: false,
    concentrationOfDuties: false,
    grants: [
      {
        id: "g3",
        role: "treasurer",
        seriesId: null,
        groupId: null,
        seriesKey: null,
        seriesName: null,
      },
    ],
  },
];

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = async () => {
        if (u.includes("/api/access/volunteers")) return { volunteers: VOLUNTEERS };
        if (u.includes("/api/series")) return { items: SERIES };
        return { items: [] };
      };
      return { ok: true, status: 200, json };
    }),
  );
}

const rowFor = (name: string) => screen.getByText(name).closest("tr") as HTMLTableRowElement;

describe("AccessPage — the series a grant covers (086)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("names the series each role covers, rather than 'series-scoped' (FR-007)", async () => {
    stub();
    render(<AccessPage />);

    await waitFor(() => expect(screen.getByText("Peggy Dempsey")).toBeInTheDocument());
    const row = within(rowFor("Peggy Dempsey"));

    expect(row.getByText(/financial_secretary/)).toHaveTextContent("Sunday English Country Dance");
    expect(row.getByText(/booker/)).toHaveTextContent("Thursday Night Contra");
    expect(rowFor("Peggy Dempsey").textContent).not.toMatch(/series-scoped/);
  });

  it("shows two series for one volunteer as two distinct grants (FR-007)", async () => {
    stub();
    render(<AccessPage />);
    await waitFor(() => expect(screen.getByText("Peggy Dempsey")).toBeInTheDocument());

    const text = rowFor("Peggy Dempsey").textContent ?? "";
    expect(text).toContain("Thursday Night Contra");
    expect(text).toContain("Sunday English Country Dance");
  });

  it("reads a club-wide role as covering every series, not as a nameless one", async () => {
    stub();
    render(<AccessPage />);
    await waitFor(() => expect(screen.getByText("Michael Pallischeck")).toBeInTheDocument());

    const text = rowFor("Michael Pallischeck").textContent ?? "";
    expect(text).toContain("club-wide");
    expect(text).not.toMatch(/series-scoped/);
  });

  it("offers the club's real series to grant against, and no free-text key (FR-008a)", async () => {
    stub();
    render(<AccessPage />);
    await waitFor(() => expect(screen.getByText("Peggy Dempsey")).toBeInTheDocument());

    const scope = screen.getByLabelText("Scope") as HTMLSelectElement;
    const options = Array.from(scope.options).map((o) => o.textContent);
    expect(options).toContain("Thursday Night Contra");
    expect(options).toContain("Sunday English Country Dance");
    // "club-wide" stays an explicit choice, and a key can no longer be mistyped into nothing.
    expect(options.some((o) => /club-wide/i.test(o ?? ""))).toBe(true);
    expect(screen.queryByPlaceholderText(/series key/i)).toBeNull();
  });
});
