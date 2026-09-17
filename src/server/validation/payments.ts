import { z } from "zod";
import { bookingCreateSchema } from "@/server/validation/performers";

/**
 * Feature 019 US2 (B28) + feature 023: recording an actual performer disbursement (a check).
 * `payeePerformerId` MAY differ from any settled performer (one check to a band lead). `lines` are the
 * per-booking allocation — each carries the amount applied to that booking; the check total is the sum of
 * its lines. Bookings MAY belong to different events (cross-event delayed checks — 023). Amounts are
 * dollars in, stored as integer cents. Every line settles a real booking (no-booking reimbursements are
 * out of scope → backlog B42).
 */
export const performerPaymentLineSchema = z.object({
  bookingId: z.string().uuid(),
  amount: z.number().min(0),
});

/**
 * Feature 081 (FR-039, research R3a): a check number is digits with an optional trailing letter — the letter
 * tells a duplicate check book apart. Trimmed and upper-cased first, so "1500a" and "1500A" are one number.
 * A malformed number surfaces as INVALID_CHECK_NUMBER (parseBody maps the `invalid_string` issue).
 */
export const CHECK_NUMBER_PATTERN = /^[0-9]+[A-Z]?$/;
export const checkNumberSchema = z
  .string()
  .transform((n) => n.trim().toUpperCase())
  .pipe(z.string().regex(CHECK_NUMBER_PATTERN));

export const performerPaymentMethodSchema = z.enum(["check", "cash"]);

export const performerPaymentCreateSchema = z
  .object({
    eventId: z.string().uuid(), // recorded at = the evening the money was paid (081: may settle an earlier booking)
    payeePerformerId: z.string().uuid(),
    // Feature 081 (FR-031): a check has a number; cash has none and settles one booking.
    method: performerPaymentMethodSchema,
    checkNumber: checkNumberSchema.optional(),
    overrideReason: z.string().min(1).optional(),
    // Feature 081 (R5): the payee already has a live payment at this event and Mary said pay again.
    confirmSecondPayment: z.boolean().optional(),
    lines: z.array(performerPaymentLineSchema).min(1),
  })
  // Feature 081 (R8): the replacement link is the server's to set, so a client-chosen one is refused.
  .strict()
  .superRefine((p, ctx) => {
    if (p.method === "check" && p.checkNumber === undefined) {
      ctx.addIssue({ code: "custom", path: ["method"], message: "A check needs a check number." });
    }
    if (p.method === "cash" && p.checkNumber !== undefined) {
      ctx.addIssue({ code: "custom", path: ["method"], message: "Cash has no check number." });
    }
    if (p.method === "cash" && p.lines.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["method"],
        message: "A cash payment settles one booking — write a check to pay several.",
      });
    }
  });

// PATCH: any subset; `lines` (when present) REPLACES the allocation. No top-level amount — the total is the
// sum of the lines. Voided payments are not patchable (correct via a reissue). Feature 081: the payee and
// the method may change too; the method/number/line rules are checked against the merged result by the
// service, which knows the current payment.
export const performerPaymentPatchSchema = z.object({
  method: performerPaymentMethodSchema.optional(),
  checkNumber: checkNumberSchema.nullable().optional(),
  payeePerformerId: z.string().uuid().optional(),
  overrideReason: z.string().min(1).nullable().optional(),
  confirmSecondPayment: z.boolean().optional(),
  lines: z.array(performerPaymentLineSchema).min(1).optional(),
});

// Feature 081 (R4, analysis I1): add one booking to an existing check. `eventId` is the event Mary is paying
// from; the check must have been recorded there, while the booking may be at an earlier event.
export const paymentLineAddSchema = z.object({
  eventId: z.string().uuid(),
  bookingId: z.string().uuid(),
  amount: z.number().min(0),
});

// Void: a reason is required (the treasurer records the void).
export const performerPaymentVoidSchema = z.object({
  reason: z.string().trim().min(1, "Say why the check is voided."), // 081 (FR-019): a real reason
});

// Feature 030 (FR-011): add a last-minute performer at settlement (FS-gated, performer_payment.write).
// Feature 081 (FR-023): the Add dialog may also set the booked amount — the rate it shows, or one Mary
// types; without `pay` the booking takes the role's standard rate, as before.
export const settlementPerformerSchema = bookingCreateSchema.pick({
  performerId: true,
  performerType: true,
  pay: true,
});

export type PerformerPaymentLineInput = z.infer<typeof performerPaymentLineSchema>;
export type PerformerPaymentCreateInput = z.infer<typeof performerPaymentCreateSchema>;
export type PerformerPaymentPatchInput = z.infer<typeof performerPaymentPatchSchema>;
export type PaymentLineAddInput = z.infer<typeof paymentLineAddSchema>;
export type PerformerPaymentVoidInput = z.infer<typeof performerPaymentVoidSchema>;
export type SettlementPerformerInput = z.infer<typeof settlementPerformerSchema>;
