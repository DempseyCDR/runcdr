import { describe, it, expect } from "vitest";
import { CAPABILITIES } from "@/server/auth/capabilities";

/**
 * Feature 086 (FR-009, SC-005): the whole role → capability map, pinned entry by entry.
 *
 * This feature changes the map twice — the Booker gains `contact.write`, and `treasurer_report.read` is
 * created and handed to five roles. Two deliberate edits in one feature is exactly the situation where a
 * third, accidental one goes unnoticed, so the map is asserted in full rather than spot-checked.
 *
 * A failure here is not necessarily a bug: it means the map changed. Either the change was intended — in
 * which case update this fixture in the same commit and say why — or it was not, in which case the
 * fixture just caught something no other test would have.
 */
describe("the role → capability map", () => {
  it("is exactly this, and nothing else", () => {
    expect(CAPABILITIES).toEqual({
      door_attendant: {
        "attendance.write": "global",
        "contact.write": "global",
        "contact.pii.read": "global",
      },
      booker: {
        "event.write": "scoped",
        "event.public.write": "scoped",
        "venue.write": "scoped",
        "performer.write": "scoped",
        "booking.write": "scoped",
        "parameter.write": "scoped",
        "contact.pii.read": "global",
        "contact.write": "global",
        "treasurer_report.read": "global",
      },
      financial_secretary: {
        "gate.write": "scoped",
        "performer_payment.write": "scoped",
        "performer.write": "scoped",
        "attendance.write": "scoped",
        "contact.write": "global",
        "membership.write": "global",
        "contact.pii.read": "global",
        "treasurer_report.read": "global",
      },
      treasurer: {
        "gate.write": "global",
        "performer_payment.write": "global",
        "performer.write": "global",
        "attendance.write": "global",
        "contact.write": "global",
        "membership.write": "global",
        "contact.pii.read": "global",
        "treasurer_report.write": "global",
        "treasurer_report.read": "global",
        "parameter.write": "global",
        "venue.write": "global",
      },
      vice_president: {
        "contact.mailing.write": "global",
        "dedup.write": "global",
        "export.read": "global",
        "mailing_list.write": "global",
        "contact.pii.read": "global",
        "role.assign": "global",
        "club_settings.write": "global",
        "volunteer.approve": "global",
        "treasurer_report.read": "global",
      },
      webmaster: {
        "event.public.write": "global",
        "content.write": "global",
      },
      mailing_list_manager: {
        "mailing_list.write": "scoped",
        "export.read": "global",
        "contact.write": "global",
        "contact.mailing.write": "global",
        "dedup.write": "global",
        "contact.pii.read": "global",
        "contact.delete": "global",
      },
      secretary: {
        "export.read": "global",
        "contact.pii.read": "global",
      },
      president: {
        "role.assign": "global",
        "club_settings.write": "global",
        "volunteer.approve": "global",
        "treasurer_report.read": "global",
      },
      super_user: {
        "dev.routes.read": "global",
        "event.write": "global",
        "event.public.write": "global",
        "venue.write": "global",
        "performer.write": "global",
        "booking.write": "global",
        "parameter.write": "global",
        "attendance.write": "global",
        "gate.write": "global",
        "performer_payment.write": "global",
        "treasurer_report.write": "global",
        "treasurer_report.read": "global",
        "contact.write": "global",
        "contact.mailing.write": "global",
        "contact.pii.read": "global",
        "dedup.write": "global",
        "contact.delete": "global",
        "contact.delete.unrestricted": "global",
        "membership.write": "global",
        "export.read": "global",
        "mailing_list.write": "global",
        "role.assign": "global",
        "club_settings.write": "global",
        "volunteer.approve": "global",
        "content.write": "global",
      },
    });
  });

  it("gives no role a capability the Super-user lacks", () => {
    const su = new Set(Object.keys(CAPABILITIES.super_user));
    for (const [role, caps] of Object.entries(CAPABILITIES)) {
      for (const cap of Object.keys(caps)) {
        expect(su.has(cap), `${role} holds ${cap}, which super_user does not`).toBe(true);
      }
    }
  });
});
