// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Feature 046 (P7-R2, US3): the public bar (aria-label "Site") and the volunteer bar (aria-label "Main")
// coexist as two distinct navigation landmarks. Visual non-overlap at 375px is browser-verified; this
// guards that both render together and stay distinguishable.
vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => "/whats-on") }));
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

import PublicNav from "@/app/PublicNav";
import VolunteerNav from "@/app/VolunteerNav";

describe("public + volunteer nav stack (US3)", () => {
  it("renders two distinct navigation landmarks", () => {
    render(
      <>
        <PublicNav />
        <VolunteerNav items={[{ href: "/gate", label: "Gate" }]} signedInAs="Meg Door" />
      </>,
    );
    expect(screen.getByRole("navigation", { name: "Site" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    // Both bars' destinations are reachable.
    expect(screen.getByRole("link", { name: "Join" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gate" })).toBeInTheDocument();
  });
});
