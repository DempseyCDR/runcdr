// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// The public bar is its own component with its own tests; here it only has to be present.
vi.mock("@/app/PublicNav", () => ({ default: () => <nav aria-label="Site" /> }));

import LoginPage from "@/app/login/page";

async function show(params: { error?: string; next?: string } = {}) {
  render(await LoginPage({ searchParams: Promise.resolve(params) }));
}

/** Feature 090 US4 (FR-016–FR-020, contracts/pages.md): a sign-in page that looks like the club's. */
describe("the sign-in page (090 US4)", () => {
  it("wears the public bar and the club's logotype (FR-016)", async () => {
    await show();
    expect(screen.getByRole("navigation", { name: "Site" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Country Dancers of Rochester" })).toHaveAttribute(
      "src",
      "/CDR_Logotype_4Color.svg",
    );
  });

  it('says "Volunteer", not "Staff" (FR-017)', async () => {
    await show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Volunteer sign-in");
    expect(
      screen.getByText("Volunteer areas require a CDR volunteer account."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/staff/i)).toBeNull();
  });

  it("says who it is for, reminds a shared phone to sign out, and offers help (FR-018)", async () => {
    await show();
    expect(
      screen.getByText("For club volunteers. Dancers don't need to sign in."),
    ).toBeInTheDocument();
    expect(screen.getByText("On a shared phone, sign out when you're done.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Can't sign in?" })).toHaveAttribute(
      "href",
      "/contact-us",
    );
  });

  it("offers Google's own sign-in button, with its G mark (FR-019)", async () => {
    await show();
    const button = screen.getByRole("link", { name: "Sign in with Google" });
    expect(button).toHaveAttribute("href", "/api/auth/google");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("carries the page the sign-in started from", async () => {
    await show({ next: "/payments" });
    expect(screen.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute(
      "href",
      "/api/auth/google?next=%2Fpayments",
    );
  });

  it("reports a refused sign-in generically, naming no reason (FR-020)", async () => {
    await show({ error: "access_denied" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn't sign you in with that account.",
    );
  });
});
