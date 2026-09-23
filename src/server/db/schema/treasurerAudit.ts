import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";

export const treasurerReportAudit = pgTable("treasurer_report_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TreasurerReportAuditRow = typeof treasurerReportAudit.$inferSelect;
