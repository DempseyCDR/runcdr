import { getActor } from "@/server/auth/currentStaff";
import { navItemsFor } from "@/server/auth/nav";
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
 */
export default async function Nav() {
  const actor = await getActor();
  if (!actor) return null;
  return <VolunteerNav items={navItemsFor(actor)} signedInAs={actor.staff.displayName} />;
}
