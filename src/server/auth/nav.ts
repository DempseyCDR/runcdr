import type { Actor } from "@/server/auth/actor";
import type { Capability } from "@/server/auth/capabilities";
import { actorCan } from "@/server/auth/can";

/**
 * Role-aware navigation (feature 016, US5; FR-039).
 *
 * ⚠️ Navigation is a COURTESY, not a control. Hiding a link is presentation — the routes enforce
 * authorization regardless, so a destination absent from someone's nav is still refused if they request
 * it directly (US5 scenario 3). Do not let anything here be mistaken for a security boundary.
 *
 * Each item is shown when the actor holds the capability that page is FOR — the primary job of the
 * page, not merely read access. A base volunteer can *read* the gate figures (money is open, FR-015),
 * but the gate page is for entering money, so it appears only for `gate.write` holders. That keeps nav
 * about "what is your job" rather than "what could you look at".
 */

export type NavItem = { href: string; label: string };

/** Destination → the capability that makes it appear. `null` = every authenticated volunteer (base). */
export const NAV: { href: string; label: string; capability: Capability | null }[] = [
  { href: "/organizer/tnc", label: "Organizer report", capability: null }, // oversight — the base
  { href: "/contacts", label: "Contacts", capability: null }, // directory (PII-projected)
  { href: "/checkin", label: "Check-in", capability: "attendance.write" },
  { href: "/gate", label: "Gate money", capability: "gate.write" },
  { href: "/payments", label: "Payments", capability: "performer_payment.write" }, // FS/Treasurer (fixes D1)
  { href: "/events", label: "Events", capability: "event.public.write" }, // Booker + Webmaster
  { href: "/bookings", label: "Bookings", capability: "booking.write" },
  { href: "/bookings-report", label: "Booking report", capability: "booking.write" }, // Booker report (020)
  { href: "/manage/performers", label: "Performers", capability: "performer.write" },
  { href: "/bands", label: "Bands", capability: "performer.write" },
  { href: "/venues", label: "Venues", capability: "venue.write" },
  { href: "/rate-parameters", label: "Rate parameters", capability: "parameter.write" },
  { href: "/admission-pricing", label: "Admission pricing", capability: "parameter.write" }, // feature 054 (P7-R10)
  { href: "/expense-parameters", label: "Expense parameters", capability: "parameter.write" },
  { href: "/door-parameters", label: "Door parameters", capability: "parameter.write" }, // seed float (019 US5)
  // Feature 086 (FR-005): gated on the READ, so the Financial Secretary whose evening it reports is
  // offered it — and the Door Attendant still is not. The route refuses too; this is only the signpost.
  { href: "/treasurer", label: "Treasurer report", capability: "treasurer_report.read" },
  { href: "/exports", label: "Mailing-list exports", capability: "export.read" },
  { href: "/access", label: "Access control", capability: "role.assign" },
  { href: "/content", label: "Content pages", capability: "content.write" }, // feature 051 (P7-R7)
  { href: "/officers", label: "Officers", capability: "content.write" }, // feature 055 (P7-R12)
  { href: "/announcement", label: "Announcement", capability: "content.write" }, // feature 056 (P7-R13)
  { href: "/campaigns", label: "Campaigns", capability: "content.write" }, // feature 057 (P7-R14)
  { href: "/dev/routes", label: "Route index (dev)", capability: "dev.routes.read" },
];

/**
 * The nav destinations this actor should be offered.
 *
 * A pure function of the actor's capabilities, so it is trivially testable without rendering React —
 * which is the whole reason the derivation lives here and not inline in a layout.
 */
export function navItemsFor(actor: Actor): NavItem[] {
  return NAV.filter((item) => item.capability === null || actorCan(actor, item.capability)).map(
    ({ href, label }) => ({ href, label }),
  );
}
