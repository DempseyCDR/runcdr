// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import VolunteerHome from "@/app/(admin)/volunteer/VolunteerHome";
import type { Menu } from "@/server/auth/nav";

/**
 * Feature 090 US3 (FR-014, contracts/pages.md): the volunteer home page is the volunteer's own menu laid
 * out as a page — the same groups in the same order, Tonight first, each destination a tap target.
 */
describe("the volunteer home page (090 US3)", () => {
  it("shows each group as a section under its heading, Tonight first", () => {
    const menu: Menu = {
      kind: "grouped",
      groups: [
        { key: "tonight", label: "Tonight", items: [{ href: "/gate", label: "Gate money" }] },
        {
          key: "reports",
          label: "Reports",
          items: [
            { href: "/organizer", label: "Organizer report" },
            { href: "/treasurer", label: "Gate report" },
          ],
        },
      ],
    };
    render(<VolunteerHome menu={menu} />);
    const sections = screen.getAllByRole("region");
    expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual(["Tonight", "Reports"]);
    expect(within(sections[1]!).getByRole("link", { name: "Gate report" })).toHaveAttribute(
      "href",
      "/treasurer",
    );
  });

  it("shows a flat menu as one list of links", () => {
    render(
      <VolunteerHome
        menu={{
          kind: "flat",
          items: [
            { href: "/checkin", label: "Check-in" },
            { href: "/contacts", label: "Contacts" },
          ],
        }}
      />,
    );
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["Check-in", "Contacts"]);
  });
});
