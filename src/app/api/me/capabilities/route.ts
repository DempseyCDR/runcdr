import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth/withAuth";
import { actorCan } from "@/server/auth/can";

// Feature 020 (FR-021): the report/modals render read-only for a viewer without write capability, with no
// edit affordance. The client learns which affordances to show from this small self-check. `actorCan` is
// layer-1 (holds the capability at SOME scope) — enough to decide whether to OFFER a control; the write
// itself is still scope-checked server-side, so this never grants anything.
export const GET = withAuth({ requires: "base" }, async (_req, ctx) => {
  return NextResponse.json({
    bookingWrite: actorCan(ctx.actor, "booking.write"),
    // Feature 081 (FR-030): the payments page offers its entry controls and dialogs only to a payer.
    performerPaymentWrite: actorCan(ctx.actor, "performer_payment.write"),
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
  });
});
