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

/**
 * Feature 090 (FR-004): the kinds of work the menu groups its destinations by, in the order shown.
 * Tonight — the door and the money on the evening — always comes first.
 */
export const MENU_GROUPS = [
  { key: "tonight", label: "Tonight" },
  { key: "booking", label: "Booking" },
  { key: "reports", label: "Reports" },
  { key: "people", label: "People" },
  { key: "settings", label: "Settings" },
  { key: "website", label: "Website" },
] as const;

export type MenuGroupKey = (typeof MENU_GROUPS)[number]["key"];
export type MenuGroup = { key: MenuGroupKey; label: string; items: NavItem[] };

/** Six or fewer destinations stay a flat row; more are grouped (FR-005). */
export type Menu = { kind: "flat"; items: NavItem[] } | { kind: "grouped"; groups: MenuGroup[] };

/** More destinations than this are grouped; this many or fewer stay flat (FR-005). */
const FLAT_UP_TO = 6;

/** Destination → the capability that makes it appear. `null` = every authenticated volunteer (base). */
export const NAV: {
  href: string;
  label: string;
  capability: Capability | null;
  group: MenuGroupKey;
}[] = [
  { href: "/organizer", label: "Organizer report", capability: null, group: "reports" }, // oversight — the base
  { href: "/contacts", label: "Contacts", capability: null, group: "people" }, // directory (PII-projected)
  { href: "/checkin", label: "Check-in", capability: "attendance.write", group: "tonight" },
  { href: "/gate", label: "Gate money", capability: "gate.write", group: "tonight" },
  { href: "/payments", label: "Payments", capability: "performer_payment.write", group: "tonight" }, // FS/Treasurer (fixes D1)
  { href: "/events", label: "Events", capability: "event.public.write", group: "booking" }, // Booker + Webmaster
  // Feature 087: the Booker's hub. It absorbed the bookings report, performers and bands — four entries
  // became one. The FS and Treasurer edit performers from Payments now (FR-030a).
  { href: "/bookings", label: "Booking Central", capability: "booking.write", group: "booking" },
  { href: "/venues", label: "Venues", capability: "venue.write", group: "booking" },
  {
    href: "/rate-parameters",
    label: "Rate parameters",
    capability: "parameter.write",
    group: "settings",
  },
  {
    href: "/admission-pricing",
    label: "Admission pricing",
    capability: "parameter.write",
    group: "settings",
  }, // feature 054 (P7-R10)
  {
    href: "/expense-parameters",
    label: "Expense parameters",
    capability: "parameter.write",
    group: "settings",
  },
  {
    href: "/door-parameters",
    label: "Door parameters",
    capability: "parameter.write",
    group: "settings",
  }, // seed float (019 US5)
  // Feature 086 (FR-005): gated on the READ, so the Financial Secretary whose evening it reports is
  // offered it — and the Door Attendant still is not. The route refuses too; this is only the signpost.
  {
    href: "/treasurer",
    label: "Gate report",
    capability: "treasurer_report.read",
    group: "reports",
  },
  { href: "/exports", label: "Mailing-list exports", capability: "export.read", group: "people" },
  { href: "/access", label: "Access control", capability: "role.assign", group: "settings" },
  { href: "/content", label: "Content pages", capability: "content.write", group: "website" }, // feature 051 (P7-R7)
  { href: "/officers", label: "Officers", capability: "content.write", group: "website" }, // feature 055 (P7-R12)
  { href: "/announcement", label: "Announcement", capability: "content.write", group: "website" }, // feature 056 (P7-R13)
  { href: "/campaigns", label: "Campaigns", capability: "content.write", group: "website" }, // feature 057 (P7-R14)
  {
    href: "/dev/routes",
    label: "Route index (dev)",
    capability: "dev.routes.read",
    group: "settings",
  },
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

/**
 * Feature 090 (FR-004, FR-005, FR-007): the volunteer's destinations, arranged for the menu and the
 * volunteer home page — exactly `navItemsFor(actor)`, grouped by the kind of work. Six or fewer stay a
 * flat row; more are grouped in `MENU_GROUPS` order, a group the volunteer holds nothing in is dropped,
 * and a group of one is kept (the presenter draws it as a plain link).
 */
export function menuFor(actor: Actor): Menu {
  const offered = NAV.filter(
    (item) => item.capability === null || actorCan(actor, item.capability),
  );
  const strip = ({ href, label }: NavItem): NavItem => ({ href, label });
  if (offered.length <= FLAT_UP_TO) return { kind: "flat", items: offered.map(strip) };
  const groups = MENU_GROUPS.map(({ key, label }) => ({
    key,
    label,
    items: offered.filter((item) => item.group === key).map(strip),
  })).filter((group) => group.items.length > 0);
  return { kind: "grouped", groups };
}
