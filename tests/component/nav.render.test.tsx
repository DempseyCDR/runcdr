// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Feature 035 (P6-R2): Nav is the server loader rendered from the ROOT layout on every page. It must
// return null for anonymous visitors (FR-005) and render the role-filtered presenter when signed in.
// The presenter (VolunteerNav, already tested) and the grants loader are stubbed here.
vi.mock("@/server/auth/currentStaff", () => ({ getActor: vi.fn() }));
vi.mock("@/server/auth/nav", () => ({
  navItemsFor: vi.fn(() => [{ href: "/gate", label: "Gate money" }]),
}));
vi.mock("@/app/VolunteerNav", () => ({
  default: ({ items, signedInAs }: { items: { href: string }[]; signedInAs: string }) => (
    <nav data-testid="vnav">
      {items.length} items for {signedInAs}
    </nav>
  ),
}));

/** An actor as `getActor` resolves one: the signed-in person, plus their grants (feature 016). */
const ACTOR = { staff: { displayName: "Meg Door" }, grants: [] } as unknown as NonNullable<
  Awaited<ReturnType<typeof getActor>>
>;

import Nav from "@/app/Nav";
import { getActor } from "@/server/auth/currentStaff";

const mockActor = vi.mocked(getActor);

describe("Nav — root-layout server loader", () => {
  beforeEach(() => mockActor.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("renders nothing for an anonymous visitor", async () => {
    mockActor.mockResolvedValue(null);
    const result = await Nav();
    expect(result).toBeNull();
  });

  it("renders the volunteer presenter with role-filtered items when signed in", async () => {
    mockActor.mockResolvedValue(ACTOR);
    render(await Nav());
    expect(screen.getByTestId("vnav")).toHaveTextContent("1 items");
  });

  // Feature 083 (FR-005): the presenter shows whose session it is; the name comes from the server, so
  // the menu still makes no authorization decision and loads nothing itself.
  it("passes the signed-in volunteer's display name to the presenter", async () => {
    mockActor.mockResolvedValue(ACTOR);
    render(await Nav());
    expect(screen.getByTestId("vnav")).toHaveTextContent("for Meg Door");
  });
});
