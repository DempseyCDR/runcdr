import type { z } from "zod";
import { errors, ApiError } from "@/server/lib/apiError";

/**
 * Parse + validate a JSON request body against a Zod schema, mapping known
 * validation failures to specific ApiError codes the contract documents.
 */
export async function parseBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw errors.validation("Request body must be valid JSON.");
  }

  const result = schema.safeParse(json);
  if (result.success) return result.data;

  for (const issue of result.error.issues) {
    const field = issue.path[issue.path.length - 1];
    if (field === "purposes") throw errors.purposesRequired();
    if (field === "consentTopics") throw errors.consentTopicsRequired();
    // Feature 081 (FR-039): a malformed check number gets its own code, so the page can say what is allowed.
    if (field === "checkNumber" && issue.code === "invalid_string")
      throw errors.invalidCheckNumber();
    // Feature 082 (contracts/gate.md): a check with no lines gets its own code — the page says why, where
    // the check was being recorded.
    if (field === "lines" && issue.code === "too_small") throw errors.checkNeedsLines();
    if (typeof field === "string" && field.startsWith("provider")) {
      throw errors.readOnlyField(field);
    }
  }
  throw errors.validation(result.error.issues.map((i) => i.message).join("; "));
}

export { ApiError };
