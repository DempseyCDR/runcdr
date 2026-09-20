import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import { events } from "./events";
import { gateCategoryEnum, membershipLevelEnum, paymentMethodEnum } from "./enums";

export const doorRecords = pgTable("door_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .unique()
    .references(() => events.id, { onDelete: "cascade" }),
  posTransactionCount: integer("pos_transaction_count").notNull().default(0),
  pcGrossCents: integer("pc_gross_cents").notNull().default(0),
  posFeeCents: integer("pos_fee_cents").notNull().default(0),
  grossCashCents: integer("gross_cash_cents").notNull().default(0),
  seedFloatCents: integer("seed_float_cents").notNull().default(1500),
  cashPaidOutCents: integer("cash_paid_out_cents").notNull().default(0),
  cashPaidOutReason: text("cash_paid_out_reason"),
  depositCents: integer("deposit_cents").notNull().default(0),
  giftCardRedemptionCount: integer("gift_card_redemption_count").notNull().default(0),
  // Feature 014: people admitted free ("next dance free" + performers' guests), one combined count.
  // Distinct from giftCardRedemptionCount; subtracted from paying dancers in the organizer report.
  compCount: integer("comp_count").notNull().default(0),
  // Feature 017 (B36): open-band musicians comped at this event (community_dance). Kept separate from
  // compCount so the FS's absolute comp edit never clobbers per-person open-band increments and so the
  // count survives the 90-day attendance purge. Report uses effective comps = compCount + openBandCount.
  openBandCount: integer("open_band_count").notNull().default(0),
  // Feature 082 (FR-030): the freehand note the paper gate report carried.
  eveningNote: text("evening_note"),
  // Feature 082 (FR-012, research R8): the denomination counts while Mary is counting — written as she
  // keys them so a reload does not lose the count, and cleared when the money is saved. Deliberately
  // transient: the saved gross cash is the record.
  cashCount: jsonb("cash_count").notNull().default({}).$type<Record<string, number>>(),
  // Feature 082 (FR-033): the last person to save the evening's money, for the gate report.
  moneyRecordedByContactId: uuid("money_recorded_by_contact_id").references(() => contacts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Feature 082 (research R1): a check handed in at the door.
 *
 * Its AMOUNT is never stored — it is the sum of its lines (FR-017), which are `gateSales` rows carrying
 * `checkId`. `depositSeparately` puts it in its own deposit (FR-021/FR-022); only someone who may record
 * gate money may set it.
 */
export const gateChecks = pgTable("gate_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  doorRecordId: uuid("door_record_id")
    .notNull()
    .references(() => doorRecords.id, { onDelete: "cascade" }),
  // Never without a contact (FR-015): a writer not yet in the contacts is created first.
  writerContactId: uuid("writer_contact_id")
    .notNull()
    .references(() => contacts.id),
  note: text("note"),
  depositSeparately: boolean("deposit_separately").notNull().default(false),
  recordedByContactId: uuid("recorded_by_contact_id").references(() => contacts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gateSales = pgTable("gate_sales", {
  id: uuid("id").primaryKey().defaultRandom(),
  doorRecordId: uuid("door_record_id")
    .notNull()
    .references(() => doorRecords.id, { onDelete: "cascade" }),
  category: gateCategoryEnum("category").notNull(),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
  // Required for named categories (donation/future_event/membership); null = anonymous.
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  // Feature 031 (P5-R4) introduced it for the anonymous-sales comment; feature 082 (FR-028) makes it any
  // line's own note. Transient denomination counts are NOT stored (Q8).
  note: text("note"),
  // Feature 068 (FR-003/FR-005): the level the FS recorded on a dues line — what the payer BOUGHT.
  // Independent of amount_cents: tiers change and cheques bundle donations. Null on other categories.
  membershipLevel: membershipLevelEnum("membership_level"),
  // Feature 082 (research R1): set when this sale is a line OF a check. `payment_method = 'check'` iff
  // this is set, and `admission` exists ONLY here — everywhere else admission is derived.
  checkId: uuid("check_id").references(() => gateChecks.id, { onDelete: "cascade" }),
  // Feature 082 (FR-016, research R17): how many, on any line — "How many?" on a check's admission line,
  // the number sold on merchandise and the rest. Optional; the evening's attendance comes from check-in.
  quantity: integer("quantity"),
  // Feature 082 (FR-029, research R6/R7): who recorded this sale. Also who may correct it without
  // holding `gate.write`.
  recordedByContactId: uuid("recorded_by_contact_id").references(() => contacts.id),
});

export const doorRecordAudit = pgTable("door_record_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  doorRecordId: uuid("door_record_id")
    .notNull()
    .references(() => doorRecords.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  actor: text("actor"),
  details: jsonb("details").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DoorRecordRow = typeof doorRecords.$inferSelect;
export type GateSaleRow = typeof gateSales.$inferSelect;
export type GateCheckRow = typeof gateChecks.$inferSelect;
export type DoorRecordAuditRow = typeof doorRecordAudit.$inferSelect;
