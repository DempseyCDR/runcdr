import { redirect } from "next/navigation";
import { db } from "@/server/db/client";
import { series } from "@/server/db/schema";
import { getActor } from "@/server/auth/currentStaff";
import { mySeries, organizerLandingKey } from "@/server/auth/mySeries";

/**
 * Feature 090 US5 (FR-021, research R9): "Organizer report" in the menu comes here, and goes on to the
 * volunteer's own series' report — or Thursday Night Contra's, as it always has. A redirect, so every link
 * and bookmark to `/organizer/{key}` keeps working. Staff only: the (admin) layout requires a volunteer.
 */
export default async function OrganizerLanding(): Promise<never> {
  const actor = await getActor();
  const all = await db.select({ id: series.id, key: series.key }).from(series);
  redirect(`/organizer/${organizerLandingKey(actor ? mySeries(actor) : [], all)}`);
}
