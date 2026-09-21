"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/server/auth/nav";

/**
 * Volunteer navigation menu — the client presenter (feature 035, P6-R2).
 *
 * Rendered by the server component `Nav`, which resolves the role-filtered `items` (authorization stays
 * on the server). A client component only because active-state (FR-008) needs the current path. Landmark
 * `aria-label="Main"` is distinct from the public menu's `aria-label="Site"` (FR-009).
 *
 * ⚠️ Presentation, not a control (FR-004): it renders whatever items it is given; each destination
 * enforces its own authorization.
 *
 * Feature 083 (B53): it also carries the **Sign out** control, last, after the destinations — the menu
 * renders only when someone is signed in, so this is the one place the control belongs. A plain form
 * submission, never `fetch`: the route is POST-only because a GET sign-out is CSRF-triggerable, and a
 * real submission works with no JavaScript and lets a page's unsaved-work warning fire (research R5).
 */
export default function VolunteerNav({
  items,
  signedInAs,
}: {
  items: NavItem[];
  /** Whose session this device holds — shown beside Sign out, so a shared phone says who it is. */
  signedInAs: string;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    !!pathname && (pathname === href || pathname.startsWith(href + "/"));
  return (
    <nav
      aria-label="Main"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        padding: "8px 24px",
        borderBottom: "1px solid #eee",
      }}
    >
      {items.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            style={{ textDecoration: "none", color: "inherit", fontWeight: active ? 600 : 400 }}
          >
            {item.label}
          </Link>
        );
      })}
      {/* A label, not a target: it takes the button's line rather than a tall row of its own. */}
      <span style={{ alignSelf: "center", color: "#555" }}>Signed in as {signedInAs}</span>
      <form action="/api/auth/signout" method="post">
        <button
          type="submit"
          style={{
            background: "none",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            font: "inherit",
            minHeight: "2.75rem",
            padding: 0,
            textDecoration: "underline",
          }}
        >
          Sign out
        </button>
      </form>
    </nav>
  );
}
