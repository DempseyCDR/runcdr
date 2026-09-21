// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Feature 035 (P6-R2): the volunteer menu's client presenter. usePathname drives active-state (FR-008);
// next/link needs the Next runtime, so stub it to a plain <a> (same approach as PublicNav's test).
vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => "/gate") }));
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

import VolunteerNav from "@/app/VolunteerNav";
import { usePathname } from "next/navigation";

const mockPath = vi.mocked(usePathname);
const ITEMS = [
  { href: "/gate", label: "Gate money" },
  { href: "/payments", label: "Payments" },
];

afterEach(() => mockPath.mockReturnValue("/gate"));

describe("VolunteerNav — presenter", () => {
  it("renders a Main nav landmark with one link per item, in order", () => {
    render(<VolunteerNav items={ITEMS} signedInAs="Meg Door" />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Gate money", "Payments"]);
    expect(screen.getByRole("link", { name: "Payments" })).toHaveAttribute("href", "/payments");
  });

  it("marks the current section active (aria-current) and only that one", () => {
    mockPath.mockReturnValue("/payments");
    render(<VolunteerNav items={ITEMS} signedInAs="Meg Door" />);
    expect(screen.getByRole("link", { name: "Payments" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Gate money" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the parent section active on a sub-path", () => {
    mockPath.mockReturnValue("/payments/anything");
    render(<VolunteerNav items={ITEMS} signedInAs="Meg Door" />);
    expect(screen.getByRole("link", { name: "Payments" })).toHaveAttribute("aria-current", "page");
  });

  it("renders no links when items is empty", () => {
    render(<VolunteerNav items={[]} signedInAs="Meg Door" />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

/**
 * Feature 083 (B53): the sign-out control. The route is POST-only by design — a GET sign-out is
 * CSRF-triggerable — so the control is a real form submission, which also means it works with no
 * JavaScript and lets the page's unsaved-work warning fire (research R5).
 */
describe("VolunteerNav — signing out", () => {
  it("offers a Sign out button that submits a POST to the sign-out route (FR-001, FR-006)", () => {
    render(<VolunteerNav items={ITEMS} signedInAs="Meg Door" />);
    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button).toHaveAttribute("type", "submit");
    const form = button.closest("form");
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/auth/signout");
  });

  it("puts it after every destination, where a thumb does not land while working", () => {
    render(<VolunteerNav items={ITEMS} signedInAs="Meg Door" />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const form = screen.getByRole("button", { name: "Sign out" }).closest("form");
    expect(nav.lastElementChild).toBe(form);
  });

  it("gives the button the phone touch target the project asks for (FR-007)", () => {
    render(<VolunteerNav items={ITEMS} signedInAs="Meg Door" />);
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveStyle({
      minHeight: "2.75rem",
    });
  });

  // FR-005: the door phone is shared, and what a volunteer records is attributed to whoever is signed in.
  it("says whose session the device holds, beside the control", () => {
    render(<VolunteerNav items={ITEMS} signedInAs="Meg Door" />);
    expect(screen.getByText("Signed in as Meg Door")).toBeInTheDocument();
  });
});
