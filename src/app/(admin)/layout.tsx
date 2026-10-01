import type { Viewport } from "next";
import { requireStaff } from "@/server/auth/currentStaff";
import Nav from "@/app/Nav";

/**
 * Feature 089 (research R8): on Android the page shrinks when the keyboard opens, so a pinned action bar
 * rises above the keyboard instead of hiding under it; on an iPhone the page runs under the home
 * indicator, so the bar can pad itself clear of it. The public site keeps the default.
 */
export const viewport: Viewport = { interactiveWidget: "resizes-content", viewportFit: "cover" };

/**
 * Protects every admin page in one place (feature 015, FR-004).
 *
 * Attached at the route-GROUP level deliberately: a per-page check is easy to forget when someone
 * adds the next page. Anything under `(admin)` is staff-only by construction.
 *
 * Feature 090: the volunteer bar is rendered here — and the public bar is not — so a volunteer page shows
 * one bar, the volunteer's (it had moved to the root layout in feature 035).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return (
    <>
      <Nav />
      {children}
    </>
  );
}
