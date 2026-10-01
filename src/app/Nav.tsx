import { getActor } from "@/server/auth/currentStaff";
import { menuFor } from "@/server/auth/nav";
import VolunteerNav from "@/app/VolunteerNav";

/**
 * Volunteer navigation — the server loader (feature 016; restructured for 035, P6-R2).
 *
 * Rendered from the ROOT layout so it appears on every page beneath the public menu, but only when a
 * volunteer is signed in: it loads the actor's grants (nullable — returns null for anonymous visitors,
 * FR-005), offers only the destinations their capabilities permit, and hands them to the client
 * presenter for rendering + active-state. Grants are loaded live per request (FR-014), no caching.
 *
 * ⚠️ Presentation, not a control — the routes enforce authorization regardless. Omitting a link never
 * grants or denies anything; it just declines to invite someone somewhere they would be refused.
 *
 * Feature 083 (B53): it also hands the presenter the signed-in volunteer's name, for the sign-out control
 * to stand beside. The name is resolved here, on the server, so the presenter still loads nothing.
 *
 * Feature 090: rendered by the (admin), (door), dev and (public) layouts — no longer the root, so a
 * volunteer page shows this bar alone. It hands the presenter the actor's menu, grouped by the kind of
 * work (`menuFor`), so the bar and the volunteer home page arrange it the same way.
 */
export default async function Nav() {
  const actor = await getActor();
  if (!actor) return null;
  return <VolunteerNav menu={menuFor(actor)} signedInAs={actor.staff.displayName} />;
}
