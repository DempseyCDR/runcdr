import AdminPage from "@/app/(admin)/_components/AdminPage";
import { getActor } from "@/server/auth/currentStaff";
import { menuFor } from "@/server/auth/nav";
import VolunteerHome from "./VolunteerHome";

/**
 * Feature 090 US3 (FR-014, FR-015): the volunteer home page — where signing in lands, and where the bar's
 * "Volunteer" link goes. Staff only: the (admin) layout requires a signed-in volunteer.
 */
export default async function VolunteerHomePage() {
  const actor = await getActor();
  return (
    <AdminPage title="Volunteer home">{actor && <VolunteerHome menu={menuFor(actor)} />}</AdminPage>
  );
}
