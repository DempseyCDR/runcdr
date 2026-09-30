import type { Viewport } from "next";
import { requireStaff } from "@/server/auth/currentStaff";

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
 * ⚠️ The role-aware volunteer nav moved to the ROOT layout in feature 035 (P6-R2) — it renders on every
 * page when signed in, so it is no longer rendered here.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return <>{children}</>;
}
