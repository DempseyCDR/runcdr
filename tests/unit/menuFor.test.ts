import { describe, expect, it } from "vitest";
import type { Actor, Grant } from "@/server/auth/actor";
import { menuFor, navItemsFor, type Menu } from "@/server/auth/nav";

/**
 * Feature 090 (data-model.md, spec FR-004, FR-005, FR-007): the volunteer menu, grouped by the kind of
 * work. The same destinations `navItemsFor` has always offered — only their arrangement changes.
 */
function actor(...grants: Grant["role"][]): Actor {
  return {
    staff: { identityId: "i", contactId: "c", displayName: "Pat", email: "pat@example.org" },
    grants: grants.map((role) => ({ role, seriesId: null, groupId: null })),
  };
}

const labels = (menu: Menu) =>
  menu.kind === "flat"
    ? menu.items.map((i) => i.label)
    : menu.groups.flatMap((g) => g.items.map((i) => i.label));

describe("menuFor (090)", () => {
  it("offers exactly what navItemsFor offers, for every role (FR-007, SC-003)", () => {
    for (const a of [
      actor(),
      actor("door_attendant"),
      actor("financial_secretary"),
      actor("booker"),
      actor("super_user"),
    ]) {
      expect(labels(menuFor(a)).sort()).toEqual(
        navItemsFor(a)
          .map((i) => i.label)
          .sort(),
      );
    }
  });

  it("keeps six or fewer destinations flat — a Door Attendant's three (FR-005)", () => {
    const menu = menuFor(actor("door_attendant"));
    expect(menu.kind).toBe("flat");
    expect(labels(menu)).toHaveLength(3);
  });

  it("groups more than six, Tonight first, in the fixed order, dropping empty groups (FR-004)", () => {
    const menu = menuFor(actor("super_user"));
    if (menu.kind !== "grouped") throw new Error("expected a grouped menu");
    expect(menu.groups.map((g) => g.label)).toEqual([
      "Tonight",
      "Booking",
      "Reports",
      "People",
      "Settings",
      "Website",
    ]);
    expect(menu.groups[0]!.items.map((i) => i.label)).toEqual([
      "Check-in",
      "Gate money",
      "Payments",
    ]);
    expect(menu.groups[2]!.items.map((i) => i.label)).toEqual(["Organizer report", "Gate report"]);
  });

  it("drops a group the volunteer holds nothing in, and keeps a group of one (FR-005)", () => {
    const menu = menuFor(actor("booker"));
    if (menu.kind !== "grouped") throw new Error("expected a grouped menu");
    const keys = menu.groups.map((g) => g.key);
    expect(keys).not.toContain("tonight");
    expect(keys).not.toContain("website");
  });

  it('calls the gate report "Gate report", not "Treasurer report" (FR-006)', () => {
    const all = labels(menuFor(actor("super_user")));
    expect(all).toContain("Gate report");
    expect(all).not.toContain("Treasurer report");
  });
});
