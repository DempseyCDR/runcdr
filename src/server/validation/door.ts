import { z } from "zod";
import { membershipLevelEnum } from "@/server/db/schema/enums";

export const eventGroupCreateSchema = z.object({
  name: z.string().trim().min(1),
  // Free-text, optional category (feature 010; was a fixed enum). Empty/whitespace → omitted (null).
  kind: z.string().trim().min(1).optional(),
});

export const eventCreateSchema = z.object({
  seriesKey: z.string().min(1),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "eventDate must be YYYY-MM-DD"),
  chargesAdmission: z.boolean().default(true),
  groupId: z.string().uuid().optional(),
  // Feature 013: optional label, venue-local wall-clock start time (HH:MM), and public description.
  label: z.string().trim().min(1).optional(),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "startTime must be HH:MM")
    .optional(),
  description: z.string().trim().min(1).optional(),
});

export const doorRecordCreateSchema = z.object({
  eventId: z.string().uuid(),
});

// Money fields arrive as dollar numbers; converted to cents in the service.
// Gross cash (total cash incl. seed float) and PC gross (total card) are entered;
// admission is derived from them minus the non-admission gate lines.
export const doorRecordPatchSchema = z.object({
  posTransactionCount: z.number().int().min(0).optional(),
  grossCash: z.number().min(0).optional(),
  pcGross: z.number().min(0).optional(),
  seedFloat: z.number().min(0).optional(),
  cashPaidOut: z.number().min(0).optional(),
  // Feature 082: null clears a reason saved earlier; an empty string is still refused.
  cashPaidOutReason: z.string().min(1).nullable().optional(),
  giftCardRedemptionCount: z.number().int().min(0).optional(),
  // Feature 014: comps (people admitted free), a distinct count from gift-card redemptions.
  compCount: z.number().int().min(0).optional(),
  // Feature 082 (FR-030): the evening's freehand note. Null clears it.
  eveningNote: z.string().nullable().optional(),
  // Feature 082 (FR-012, research R8): the count in progress — bill faces to counts, plus `coins` as one
  // dollar amount. Saving the money CLEARS it unless the request sets it, so `{}` is meaningful.
  cashCount: z.record(z.string(), z.number().min(0)).optional(),
});

// Feature 082: what a named sale or a check's line may be. `admission` is accepted here and refused by
// the service with ADMISSION_NEEDS_CHECK — the schema must not swallow it first (contracts/gate.md).
const saleCategory = z.enum([
  "admission",
  "merchandise",
  "donation",
  "future_event",
  "membership",
  "gift_card",
  "misc_sales",
]);

const NAMED_CATEGORIES = new Set(["donation", "future_event", "membership"]);

/** The rules a sale and a check's line share: who it names, and what a membership must say. */
function withNamedRules<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine(
      (s: { category: string; contactId?: string }) => {
        return !NAMED_CATEGORIES.has(s.category) || !!s.contactId;
      },
      {
        message: "donation, future_event, and membership lines require a contactId",
        path: ["contactId"],
      },
    )
    .refine(
      (s: { category: string; membershipLevel?: string }) => {
        return s.category !== "membership" || !!s.membershipLevel;
      },
      { message: "membership lines require a membershipLevel", path: ["membershipLevel"] },
    )
    .refine(
      (s: { category: string; membershipLevel?: string }) => {
        return s.category === "membership" || !s.membershipLevel;
      },
      { message: "membershipLevel applies only to membership lines", path: ["membershipLevel"] },
    )
    .refine(
      (s: { category: string; memberContactIds?: string[] }) => {
        return s.category === "membership" || !s.memberContactIds?.length;
      },
      { message: "members apply only to membership lines", path: ["memberContactIds"] },
    );
}

/**
 * The quickstart walk (§3.3): the payer is always a member of the membership they pay for; these are the
 * others it covers — Rachel and Finn, when Will pays. Each is attached to the payer's account.
 */
const memberContactIds = z.array(z.string().uuid()).optional();

/** Feature 082 (research R17): how many, on any line — optional, a whole number above zero. */
const quantity = z.number().int().min(1);

/**
 * Feature 082 (FR-024, research R16): one sale, named or not, recorded on its own from the gate page or
 * the door. The gate's Save no longer carries sales.
 */
export const gateSaleCreateSchema = withNamedRules(
  z.object({
    category: saleCategory,
    paymentMethod: z.enum(["cash", "card"]),
    amount: z.number().min(0),
    contactId: z.string().uuid().optional(),
    note: z.string().optional(),
    // Feature 068 (FR-003/FR-005): what the payer BOUGHT. Independent of `amount` — tiers change and
    // cheques bundle donations — so it is chosen, never inferred.
    membershipLevel: z.enum(membershipLevelEnum.enumValues).optional(),
    quantity: quantity.optional(),
    memberContactIds,
  }),
);

/** Feature 082: correcting one sale. At least one field, or there is nothing to do. */
export const gateSalePatchSchema = z
  .object({
    amount: z.number().min(0).optional(),
    paymentMethod: z.enum(["cash", "card", "check"]).optional(),
    contactId: z.string().uuid().nullable().optional(),
    membershipLevel: z.enum(membershipLevelEnum.enumValues).nullable().optional(),
    note: z.string().nullable().optional(),
    quantity: quantity.nullable().optional(),
    memberContactIds,
  })
  .refine((p) => Object.keys(p).length > 0, { message: "nothing to change" });

/** Feature 082 (FR-016): one thing a check pays for — admission included, its count optional (R17). */
const checkLineSchema = withNamedRules(
  z.object({
    category: saleCategory,
    amount: z.number().min(0),
    contactId: z.string().uuid().optional(),
    note: z.string().optional(),
    membershipLevel: z.enum(membershipLevelEnum.enumValues).optional(),
    quantity: quantity.optional(),
    memberContactIds,
  }),
);

/**
 * Feature 082 (FR-014, FR-017): a check received. Its amount is the sum of its lines and is never sent;
 * a check with no lines is refused, here and again in the service.
 */
export const gateCheckCreateSchema = z.object({
  writerContactId: z.string().uuid(),
  note: z.string().optional(),
  depositSeparately: z.boolean().optional(),
  lines: z.array(checkLineSchema).min(1),
});

export const gateCheckPatchSchema = z
  .object({
    writerContactId: z.string().uuid().optional(),
    note: z.string().nullable().optional(),
    depositSeparately: z.boolean().optional(),
    // Replacing the lines with none is a delete, not a patch.
    lines: z.array(checkLineSchema).min(1).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "nothing to change" });

export type EventGroupCreateInput = z.infer<typeof eventGroupCreateSchema>;
// Feature 018 (B26): recurring event generation — first date, every-N-weeks step, last date.
export const recurringEventsSchema = z.object({
  seriesKey: z.string().min(1),
  firstDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "firstDate must be YYYY-MM-DD"),
  lastDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "lastDate must be YYYY-MM-DD"),
  everyNWeeks: z.number().int().min(1).default(1),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "startTime must be HH:MM")
    .optional(),
  groupId: z.string().uuid().optional(),
  chargesAdmission: z.boolean().default(true),
});

// Feature 019 US5 (FR-021): the per-series seed float — category/kind are implied by the route.
export const doorParameterCreateSchema = z.object({
  seriesKey: z.string().min(1),
  amount: z.number().min(0),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveDate must be YYYY-MM-DD"),
});
export type DoorParameterCreateInput = z.infer<typeof doorParameterCreateSchema>;

export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type RecurringEventsInput = z.infer<typeof recurringEventsSchema>;
export type DoorRecordCreateInput = z.infer<typeof doorRecordCreateSchema>;
export type DoorRecordPatchInput = z.infer<typeof doorRecordPatchSchema>;
export type GateSaleCreateInput = z.infer<typeof gateSaleCreateSchema>;
export type GateSalePatchInput = z.infer<typeof gateSalePatchSchema>;
export type GateCheckCreateInput = z.infer<typeof gateCheckCreateSchema>;
export type GateCheckPatchInput = z.infer<typeof gateCheckPatchSchema>;
export type GateCheckLineInput = z.infer<typeof checkLineSchema>;
