// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";

// The volunteer menu's client presenter. usePathname drives the current-page mark; next/link needs the
// Next runtime, so it is stubbed to a plain <a> (the same approach as PublicNav's test).
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
import type { Menu } from "@/server/auth/nav";
import { usePathname } from "next/navigation";

const mockPath = vi.mocked(usePathname);
afterEach(() => mockPath.mockReturnValue("/gate"));

const FLAT: Menu = {
  kind: "flat",
  items: [
    { href: "/organizer", label: "Organizer report" },
    { href: "/contacts", label: "Contacts" },
    { href: "/checkin", label: "Check-in" },
  ],
};

const GROUPED: Menu = {
  kind: "grouped",
  groups: [
    {
      key: "tonight",
      label: "Tonight",
      items: [
        { href: "/gate", label: "Gate money" },
        { href: "/payments", label: "Payments" },
      ],
    },
    {
      key: "reports",
      label: "Reports",
      items: [
        { href: "/organizer", label: "Organizer report" },
        { href: "/treasurer", label: "Gate report" },
      ],
    },
    {
      key: "people",
      label: "People",
      items: [{ href: "/contacts", label: "Contacts" }],
    },
    {
      key: "settings",
      label: "Settings",
      items: [
        { href: "/rate-parameters", label: "Rate parameters" },
        { href: "/door-parameters", label: "Door parameters" },
        { href: "/access", label: "Access control" },
      ],
    },
  ],
};

function show(menu: Menu = GROUPED) {
  const user = userEvent.setup();
  render(<VolunteerNav menu={menu} signedInAs="Meg Door" />);
  return user;
}

const group = (name: string) => screen.getByRole("button", { name });
const panelOf = (button: HTMLElement) => {
  const id = button.getAttribute("aria-controls");
  const panel = id ? document.getElementById(id) : null;
  if (!panel) throw new Error(`no panel for ${button.textContent}`);
  return panel;
};

/** Feature 090 (contracts/menu.md): one coloured bar, the destinations grouped by the kind of work. */
describe("VolunteerNav — the bar (090)", () => {
  it('is the "Main" landmark, with a way home and a way back to the club\'s site (FR-003)', () => {
    show();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Volunteer" })).toHaveAttribute(
      "href",
      "/volunteer",
    );
    expect(within(nav).getByRole("link", { name: "Club site" })).toHaveAttribute("href", "/");
  });

  it("shows a flat menu as links, with no groups (FR-005)", () => {
    show(FLAT);
    for (const label of ["Organizer report", "Contacts", "Check-in"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /Reports|People|Settings/ })).toBeNull();
  });

  it("keeps Tonight's links flat and makes each other group of two or more a disclosure (FR-004)", () => {
    show();
    expect(screen.getByRole("link", { name: "Gate money" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tonight" })).toBeNull();
    const reports = group("Reports");
    expect(reports).toHaveAttribute("aria-expanded", "false");
    expect(within(panelOf(reports)).getByRole("link", { name: "Gate report" })).toBeInTheDocument();
  });

  it("draws a group of one as a plain link (FR-005)", () => {
    show();
    expect(screen.queryByRole("button", { name: "People" })).toBeNull();
    expect(screen.getByRole("link", { name: "Contacts" })).toBeInTheDocument();
  });

  it("marks the current page, and only that one (FR-009)", () => {
    show();
    expect(screen.getByRole("link", { name: "Gate money" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Payments" })).not.toHaveAttribute("aria-current");
  });
});

describe("VolunteerNav — groups open by mouse and keyboard (FR-008)", () => {
  it("opens a group on click, and only one at a time (M1)", async () => {
    const user = show();
    await user.click(group("Reports"));
    expect(group("Reports")).toHaveAttribute("aria-expanded", "true");
    await user.click(group("Settings"));
    expect(group("Settings")).toHaveAttribute("aria-expanded", "true");
    expect(group("Reports")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens with Enter and with Space (M1)", async () => {
    const user = show();
    group("Reports").focus();
    await user.keyboard("{Enter}");
    expect(group("Reports")).toHaveAttribute("aria-expanded", "true");
    group("Settings").focus();
    await user.keyboard(" ");
    expect(group("Settings")).toHaveAttribute("aria-expanded", "true");
  });

  it("moves with Down, Up, Home and End within the open group (M2)", async () => {
    const user = show();
    await user.click(group("Settings"));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("link", { name: "Rate parameters" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("link", { name: "Door parameters" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("link", { name: "Rate parameters" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("link", { name: "Access control" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("link", { name: "Rate parameters" })).toHaveFocus();
  });

  it("closes on Escape and puts focus back on the group's button (M3)", async () => {
    const user = show();
    await user.click(group("Settings"));
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Escape}");
    expect(group("Settings")).toHaveAttribute("aria-expanded", "false");
    expect(group("Settings")).toHaveFocus();
  });

  it("closes when a link in it is chosen, or on a click outside the bar (M4)", async () => {
    const user = show();
    await user.click(group("Reports"));
    await user.click(screen.getByRole("link", { name: "Gate report" }));
    expect(group("Reports")).toHaveAttribute("aria-expanded", "false");

    await user.click(group("Reports"));
    await user.click(document.body);
    expect(group("Reports")).toHaveAttribute("aria-expanded", "false");
  });

  // A <noscript>'s contents exist only in the server's HTML, so this reads the server rendering.
  it("shows every group open without JavaScript (M7)", () => {
    const html = renderToStaticMarkup(<VolunteerNav menu={GROUPED} signedInAs="Meg Door" />);
    expect(html).toMatch(/<noscript><style>[^<]*\[data-group-panel\]\{display:block/);
  });
});

/**
 * Feature 090 US2 (FR-010–FR-012, contracts/menu.md M5–M9): below 48rem the bar is the volunteer's name
 * and a Menu button. The Menu lists Tonight's pages first, open; then each other group collapsed, opened
 * by a tap (Rich, 2026-10-01: a long menu all open is too long on a phone); then Sign out and Club site.
 * A flat menu lists everything. (Which part shows at which width is the stylesheet's; the structure and
 * state are tested here.)
 */
describe("VolunteerNav — the Menu on a phone (090 US2)", () => {
  const menuButton = () => screen.getByRole("button", { name: "Menu" });

  it("shows the volunteer's name on its own, beside a Menu button (FR-010, FR-011)", () => {
    show();
    expect(screen.getByText("Meg Door")).toBeInTheDocument();
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("puts Tonight's pages first, then the groups, then Sign out and Club site (FR-010, FR-012)", () => {
    show();
    const panel = panelOf(menuButton());
    expect(within(panel).getAllByRole("heading")[0]).toHaveTextContent("Tonight");
    expect(within(panel).getByRole("link", { name: "Gate money" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Club site" })).toBeInTheDocument();
  });

  it("lists each other group collapsed, and a tap opens it (FR-012, M9)", async () => {
    const user = show();
    await user.click(menuButton());
    const panel = panelOf(menuButton());
    for (const name of ["Reports", "Settings"]) {
      expect(within(panel).getByRole("button", { name })).toHaveAttribute("aria-expanded", "false");
    }
    // A group of one is not worth a tap: it stays a plain link.
    expect(within(panel).queryByRole("button", { name: "People" })).toBeNull();
    expect(within(panel).getByRole("link", { name: "Contacts" })).toBeInTheDocument();

    await user.click(group("Settings"));
    expect(group("Settings")).toHaveAttribute("aria-expanded", "true");
    expect(panelOf(group("Settings")).className).toMatch(/open/);
    expect(menuButton()).toHaveAttribute("aria-expanded", "true"); // the Menu stays open
  });

  it("reopens with every group collapsed after the Menu is closed (M5)", async () => {
    const user = show();
    await user.click(menuButton());
    await user.click(group("Settings"));
    await user.click(menuButton());
    await user.click(menuButton());
    expect(group("Settings")).toHaveAttribute("aria-expanded", "false");
  });

  it("closes an open group on the first Escape and the Menu on the second (M3, M6, M9)", async () => {
    const user = show();
    await user.click(menuButton());
    await user.click(group("Settings"));
    await user.keyboard("{Escape}");
    expect(group("Settings")).toHaveAttribute("aria-expanded", "false");
    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens and closes on the Menu button (M5)", async () => {
    const user = show();
    await user.click(menuButton());
    expect(menuButton()).toHaveAttribute("aria-expanded", "true");
    await user.click(menuButton());
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape, with focus back on the Menu button (M6)", async () => {
    const user = show();
    await user.click(menuButton());
    await user.keyboard("{Escape}");
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
    expect(menuButton()).toHaveFocus();
  });

  it("closes when a destination is chosen (FR-012)", async () => {
    const user = show();
    await user.click(menuButton());
    await user.click(screen.getByRole("link", { name: "Payments" }));
    expect(menuButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the Menu's contents without JavaScript (M7)", () => {
    const html = renderToStaticMarkup(<VolunteerNav menu={GROUPED} signedInAs="Meg Door" />);
    expect(html).toMatch(/\[data-menu-panel\]\{display:flex/);
  });
});

/**
 * Feature 083 (B53): the sign-out control. The route is POST-only by design — a GET sign-out is
 * CSRF-triggerable — so the control is a real form submission, which also means it works with no
 * JavaScript and lets the page's unsaved-work warning fire (research R5).
 */
describe("VolunteerNav — signing out", () => {
  it("offers a Sign out button that submits a POST to the sign-out route (FR-001, FR-006)", () => {
    show();
    const button = screen.getByRole("button", { name: "Sign out" });
    expect(button).toHaveAttribute("type", "submit");
    const form = button.closest("form");
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/auth/signout");
  });

  it("puts it after every destination, where a thumb does not land while working", () => {
    show();
    const form = screen.getByRole("button", { name: "Sign out" }).closest("form");
    if (!form) throw new Error("no sign-out form");
    for (const link of screen.getAllByRole("link")) {
      if (link.textContent === "Volunteer" || link.textContent === "Club site") continue;
      expect(
        link.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING,
        link.textContent ?? "",
      ).toBeTruthy();
    }
  });

  // FR-005 (083): the door phone is shared, and what a volunteer records is attributed to whoever is
  // signed in.
  it("says whose session the device holds", () => {
    show();
    expect(screen.getByText("Signed in as Meg Door")).toBeInTheDocument();
  });
});
