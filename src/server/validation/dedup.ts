import { z } from "zod";

export const mergeSchema = z.object({
  canonicalId: z.string().uuid(),
  mergedId: z.string().uuid(),
});

/** Feature 069 (FR-002): mark a pair "not duplicates". Ids may arrive in either order. */
export const rejectionSchema = z.object({
  contactAId: z.string().uuid(),
  contactBId: z.string().uuid(),
});

/**
 * Resolve a held merge by choosing which of the colliding things survives. Exactly one KIND of choice,
 * matching the hold's reason — a login choice cannot resolve an account collision.
 *
 * Feature 072 (FR-012a) corrects the sign-in choice. Feature 069 accepted `survivingLoginEmailId` alone,
 * and acting on it set `contact_emails.is_login` — a LABEL — while leaving `staff_identities` untouched.
 * Access follows the account binding, not the label, and feature 015 (R9) deliberately allows the two to
 * disagree because a Google account can be renamed without telling us. So the officer answering "which
 * sign-in survives?" was changing something that did not decide it. Both fields are now required
 * together, and an address on its own must not parse.
 */
export const heldResolveSchema = z
  .object({
    survivingIdentityId: z.string().uuid().optional(),
    survivingLoginEmailId: z.string().uuid().optional(),
    survivingAccountId: z.string().uuid().optional(),
    /** Feature 072 (FR-009): which of the merged contact's grants move. Empty means "none" — valid. */
    keepGrantIds: z.array(z.string().uuid()).optional(),
    /** Feature 078 (FR-011): carry volunteer status to the kept contact. Only `true` is an answer. */
    carryVolunteer: z.literal(true).optional(),
  })
  // A surviving sign-in is one contact's, whole: its address and its Google account, or whichever of the
  // two that contact has (feature 078). Whether the pair fits is the held-merge service's call — this
  // schema only refuses answers of two kinds at once.
  .refine(
    (v) =>
      [
        !!(v.survivingIdentityId || v.survivingLoginEmailId),
        !!v.survivingAccountId,
        !!v.keepGrantIds,
        !!v.carryVolunteer,
      ].filter(Boolean).length === 1,
    {
      message:
        "exactly one kind of choice is required: a surviving sign-in, a surviving account, the grants " +
        "to keep, or carrying volunteer status",
    },
  );

export type MergeInput = z.infer<typeof mergeSchema>;
export type RejectionInput = z.infer<typeof rejectionSchema>;
export type HeldResolveInput = z.infer<typeof heldResolveSchema>;

/**
 * Feature 078: the answers stored on a hold (`held_merges.answers`). Each key is present only once its
 * question has been answered, possibly by a different person from the others. Parsed on every read: a
 * malformed stored answer must fail loudly, never be half-applied to a merge that deletes records.
 */
export const heldMergeAnswersSchema = z
  .object({
    survivingIdentityId: z.string().uuid().optional(),
    survivingLoginEmailId: z.string().uuid().optional(),
    survivingAccountId: z.string().uuid().optional(),
    keepGrantIds: z.array(z.string().uuid()).optional(),
    carryVolunteer: z.literal(true).optional(),
  })
  .strict();

export type HeldMergeAnswers = z.infer<typeof heldMergeAnswersSchema>;
