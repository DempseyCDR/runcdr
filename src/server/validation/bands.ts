import { z } from "zod";
import { promoLinksSchema, stylesSchema } from "@/server/domain/public/promoLinks";

const memberSchema = z.object({
  performerId: z.string().uuid(),
  isLead: z.boolean(),
  // Feature 053 (P7-R9): optional instrument, shown on the roster/lineup.
  instrument: z.string().trim().min(1).nullable().optional(),
});

/**
 * A roster must have ≥1 member and AT MOST one lead. Feature 087 (FR-022, FR-023) made the lead optional:
 * removing the lead leaves the band with no lead, said plainly, rather than forcing the Booker to name one
 * he did not pick. Two leads is still refused — the lead is the one person the Booker contacts.
 */
function atMostOneLead(members: { isLead: boolean }[], ctx: z.RefinementCtx) {
  if (members.length < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "a band needs at least one member",
    });
    return;
  }
  if (members.filter((m) => m.isLead).length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "a band may have only one lead",
    });
  }
}

export const bandCreateSchema = z.object({
  name: z.string().trim().min(1),
  bio: z.string().optional(),
  photoUrl: z.string().url().optional(),
  members: z.array(memberSchema).superRefine(atMostOneLead),
  // Feature 053 (P7-R9): public roster fields.
  isPublic: z.boolean().optional(),
  styles: stylesSchema.optional(),
  links: promoLinksSchema.optional(),
});

export const bandPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  bio: z.string().nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  members: z.array(memberSchema).superRefine(atMostOneLead).optional(),
  // Feature 053 (P7-R9): public roster fields (replace the set when present).
  isPublic: z.boolean().optional(),
  styles: stylesSchema.optional(),
  links: promoLinksSchema.optional(),
});

export const bookBandSchema = z.object({
  bandId: z.string().uuid(),
  memberPay: z
    .array(z.object({ performerId: z.string().uuid(), amount: z.number().min(0) }))
    .optional(),
});

// Feature 024 US2: re-point an event's band to a different one.
export const repointBandSchema = z.object({
  fromBandId: z.string().uuid(),
  toBandId: z.string().uuid(),
});

export type BandCreateInput = z.infer<typeof bandCreateSchema>;
export type RepointBandInput = z.infer<typeof repointBandSchema>;
export type BandPatchInput = z.infer<typeof bandPatchSchema>;
export type BookBandInput = z.infer<typeof bookBandSchema>;
