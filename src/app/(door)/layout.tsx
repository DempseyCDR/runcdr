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
 * Protects /checkin and /gate (feature 015, FR-004).
 *
 * The layout establishes only that someone is signed in. The Door Attendant vs Financial Secretary
 * boundary — Door Attendant must NOT write /gate — is enforced by the routes and the gate service
 * (feature 016), not here.
 *
 * Feature 090: the volunteer bar is rendered here — and the public bar is not — so a volunteer page shows
 * one bar, the volunteer's (it had moved to the root layout in feature 035).
 */
export default async function DoorLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return (
    <>
      <Nav />
      {children}
    </>
  );
}
