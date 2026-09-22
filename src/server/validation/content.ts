import { z } from "zod";

// Feature 051 (P7-R7): content-page inputs. The body is Markdown (rendered to sanitized HTML on read). The
// slug is the page's public URL and is validated at create time — URL-safe and not colliding with an existing
// route, since the (admin)/(door)/(public) route groups all share the root path. Slug is create-only (data-
// model / spec FR-002): PATCH never changes it.

/**
 * Reserved top-level route segments a content page may NOT use as its slug (it would shadow a real route).
 * The route groups add nothing to the path, so every admin/door/public segment lives at `/segment`.
 * Includes `content` (this feature's own admin page) and `dances` (P7-R6, defensive).
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // framework / app roots
  "api",
  "dev",
  "login",
  "content",
  // public
  "whats-on",
  "what-was-on",
  "join",
  "dances",
  "organizer",
  "contact-us", // feature 055 (P7-R12): dedicated /contact-us route (board officers + aliases + a "contact-info" CMS block)
  "printable-calendar", // feature 058 (P7-R15): the print-friendly schedule route
  // admin / door page routes
  "access",
  "bands",
  "bookings",
  "bookings-report",
  "checkin",
  "contacts",
  "dedup",
  "door-parameters",
  "events",
  "expense-parameters",
  "exports",
  "gate",
  "payments",
  "performers",
  "rate-parameters",
  "treasurer",
  "venue-rents",
  "venues",
]);

const slugSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "slug must be lowercase letters, numbers, and single hyphens",
  )
  .min(1)
  .max(80)
  .refine((s) => !RESERVED_SLUGS.has(s), "slug collides with an existing site route");

export const contentPageCreateSchema = z.object({
  slug: slugSchema,
  title: z.string().trim().min(1, "title is required"),
  draftBody: z.string().min(1, "body is required"),
  summary: z.string().trim().max(300).optional(),
});

export const contentPagePatchSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    draftBody: z.string().min(1).optional(),
    summary: z.string().trim().max(300).nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.draftBody !== undefined || v.summary !== undefined, {
    message: "at least one field must be provided",
  });

export const contentPreviewSchema = z.object({ markdown: z.string() });

export type ContentPageCreateInput = z.infer<typeof contentPageCreateSchema>;
export type ContentPagePatchInput = z.infer<typeof contentPagePatchSchema>;
