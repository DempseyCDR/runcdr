import type { MembershipLevel } from "@/server/db/schema/enums";

/**
 * Feature 080 (research R2): the membership levels, for client components. The list is kept here rather than
 * imported from the schema, whose enum values would pull Drizzle into the browser bundle; the type import is
 * free, and the checks below fail the build if the database enum and this list ever disagree.
 */
export const MEMBERSHIP_LEVELS = [
  "individual",
  "family",
  "supporter",
  "student",
] as const satisfies readonly MembershipLevel[];

// Every database level is in the list (the `satisfies` above checks the converse).
type Missing = Exclude<MembershipLevel, (typeof MEMBERSHIP_LEVELS)[number]>;
const everyLevelListed: [Missing] extends [never] ? true : Missing = true;
void everyLevelListed;

export const MEMBERSHIP_LEVEL_LABELS: Record<MembershipLevel, string> = {
  individual: "Individual",
  family: "Family",
  supporter: "Supporter",
  student: "Student",
};
