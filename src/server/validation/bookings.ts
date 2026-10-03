import { z } from "zod";

/**
 * Feature 091 (research R8, contracts/report-api.md): Booking Central's read, paged both ways from a
 * split date. `older` reads the dances before `split`, newest first; `newer` those on or after it,
 * nearest first. The 087 `horizon` is retired and not read.
 */
export const bookingsReportQuerySchema = z.object({
  /** Feature 091 (Rich, 2026-10-02): one series key or several, comma-separated — "tnc,cdob". */
  series: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    )
    .optional(),
  split: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "split must be YYYY-MM-DD")
    .optional(),
  direction: z.enum(["older", "newer"]).default("older"),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type BookingsReportQuery = z.infer<typeof bookingsReportQuerySchema>;
