import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth/withAuth";
import { actorCan } from "@/server/auth/can";

// Feature 020 (FR-021): the report/modals render read-only for a viewer without write capability, with no
// edit affordance. The client learns which affordances to show from this small self-check. `actorCan` is
// layer-1 (holds the capability at SOME scope) — enough to decide whether to OFFER a control; the write
// itself is still scope-checked server-side, so this never grants anything.
export const GET = withAuth({ requires: "base" }, async (_req, ctx) => {
  return NextResponse.json({
    // Feature 082 (FR-027): who is asking, so a page can tell the viewer's own entries — the door may
    // correct what it recorded itself. The server still decides every write.
    contactId: ctx.staff.contactId,
    bookingWrite: actorCan(ctx.actor, "booking.write"),
    // Feature 081 (FR-030): the payments page offers its entry controls and dialogs only to a payer.
    performerPaymentWrite: actorCan(ctx.actor, "performer_payment.write"),
    // Feature 082 (FR-027): the gate page offers the money, its Save and "deposit separately" only to
    // someone who may record gate money; the door (attendance) may still record a sale or a check.
    gateWrite: actorCan(ctx.actor, "gate.write"),
    attendanceWrite: actorCan(ctx.actor, "attendance.write"),
    eventWrite: actorCan(ctx.actor, "event.write"),
    // Feature 065: which contact archive/delete controls the editor should offer.
    contactWrite: actorCan(ctx.actor, "contact.write"),
    contactDelete: actorCan(ctx.actor, "contact.delete"),
    contactDeleteUnrestricted: actorCan(ctx.actor, "contact.delete.unrestricted"),
    // Feature 066: whether the editor should offer the email-edit controls.
    contactMailingWrite: actorCan(ctx.actor, "contact.mailing.write"),
    // Feature 068 (FR-017): the record shows the membership household to everyone, but only the
    // FS/Treasurer/Super-user may change it.
    membershipWrite: actorCan(ctx.actor, "membership.write"),
    // Feature 069 (FR-012/FR-013): a merge held because both contacts sign in is resolved by choosing
    // which identity survives — a role decision, so the queue shows that action only to its holder.
    roleAssign: actorCan(ctx.actor, "role.assign"),
    // Feature 074 (FR-023): the merge history and its undo control are duplicate work, so the record
    // shows that block only to a holder. `roleAssign` above additionally gates the sign-in PORTION of
    // an undo, but server-side — lacking it skips those entries rather than hiding the control.
    dedupWrite: actorCan(ctx.actor, "dedup.write"),
    /**
     * Feature 086 (FR-010, FR-012): the series this viewer works in — every series named by any grant
     * they hold. The ONLY non-boolean here, and the only one that is not about offering a control: it
     * decides what an evening list STARTS at. Empty means "do not narrow", which covers both a
     * club-wide holder (a grant with no scope matches every series, so narrowing would be wrong) and a
     * volunteer with no grants. Nothing here permits anything; the routes decide every request.
     */
    mySeriesIds: ctx.actor.grants.some((g) => g.seriesId === null && g.groupId === null)
      ? []
      : [...new Set(ctx.actor.grants.flatMap((g) => (g.seriesId ? [g.seriesId] : [])))],
  });
});
