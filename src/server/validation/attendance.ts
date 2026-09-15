import { z } from "zod";

// Feature 017 per-check-in extras, split by what they attach to:
// - personExtras (B35 children count, B36 open-band flag) describe an actual person, so they ride ONLY
//   on the existing-contact / new-contact paths, never on `unmatched`.
// - countExtras (B29 comp + gift-card redemption) are **counts-only, never attributed** — booleans the
//   Door Attendant ticks per check-in that materialize into the door record's counts. They may apply to
//   ANY check-in, including an anonymous `unmatched` admission, and are never stored on the row.
const personExtras = {
  childrenCount: z.number().int().min(0).optional(),
  isOpenBand: z.boolean().optional(),
};
const countExtras = {
  isComp: z.boolean().optional(),
  redeemedGiftCard: z.boolean().optional(),
};

export const attendanceSchema = z.union([
  z.object({ contactId: z.string().uuid(), ...personExtras, ...countExtras }),
  z.object({
    newContact: z.object({
      firstName: z.string().trim().min(1),
      lastName: z.string().trim().min(1).optional(),
      // Feature 017 (B34): the Door Attendant may edit the derived "first last" display name.
      displayNameOverride: z.string().trim().min(1).optional(),
      email: z.string().trim().email().optional(),
      phone: z.string().trim().min(1).optional(),
      // Feature 079 (FR-016b): the email belongs to someone else, and this is a different person sharing it —
      // create the contact reached through that address rather than owning it.
      shareEmail: z.literal(true).optional(),
    }),
    ...personExtras,
    ...countExtras,
  }),
  // Feature 025 (FR-015): an unmatched head-count admission MAY now carry a children count (previously
  // rejected, silently dropping the number). `.strict()` still rejects `isOpenBand` here — open-band stays
  // person-and-community-dance only; the comp/gift booleans remain allowed (an anonymous free admission).
  z
    .object({
      unmatched: z.literal(true),
      childrenCount: z.number().int().min(0).optional(),
      ...countExtras,
    })
    .strict(),
]);

// Feature 025 US1: correct one attendance record. At least one field; `eventId` is a move to a sibling event
// (validated server-side). `contactId` reassigns an unmatched admission; `isOpenBand` toggles open-band.
export const attendancePatchSchema = z
  .object({
    childrenCount: z.number().int().min(0).optional(),
    contactId: z.string().uuid().optional(),
    isOpenBand: z.boolean().optional(),
    eventId: z.string().uuid().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update." });

// Feature 025 US1: nudge an event's aggregate comp / gift-card count by ±1 (counts-only, decision B).
export const doorCountAdjustSchema = z.object({
  count: z.enum(["comp", "gift"]),
  delta: z.union([z.literal(1), z.literal(-1)]),
});

export type AttendanceInput = z.infer<typeof attendanceSchema>;
export type AttendancePatchInput = z.infer<typeof attendancePatchSchema>;
export type DoorCountAdjustInput = z.infer<typeof doorCountAdjustSchema>;
