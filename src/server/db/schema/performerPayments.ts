import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { boolean, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";
import { performers } from "./performers";
import { bookings } from "./bookings";
import { performerPaymentMethodEnum } from "./enums";

/**
 * Feature 019 (B28): what was ACTUALLY disbursed to a performer, distinct from a booking's *expected*
 * `pay_cents`. The payee MAY differ from the booked performer (a substitute sat in). Not cascaded from
 * `performers` — a payee is financial history that must survive a performer-record cleanup.
 */
export const performerPayments = pgTable("performer_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  payeePerformerId: uuid("payee_performer_id")
    .notNull()
    .references(() => performers.id),
  amountCents: integer("amount_cents").notNull(),
  // Feature 081 (R1, R3a): a check carries a number — digits and an optional letter, unique club-wide, live or
  // voided — and cash carries none (table checks `performer_payments_method_number` / `_check_number_form`).
  method: performerPaymentMethodEnum("method").notNull().default("check"),
  checkNumber: text("check_number"),
  overrideReason: text("override_reason"),
  // Feature 023: void state. A voided check persists (the treasurer records the void) and never settles a
  // booking; a reissue points back at the check it replaces.
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: text("void_reason"),
  replacesPaymentId: uuid("replaces_payment_id").references(
    (): AnyPgColumn => performerPayments.id,
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Many-to-many so one payment (one check) can settle several bookings (aggregation, FR-006). A booking
 * may appear under zero payments (unpaid) or one (settled); the reconciliation delta, not a constraint,
 * surfaces any mismatch.
 */
export const paymentBookings = pgTable(
  "payment_bookings",
  {
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => performerPayments.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    // Feature 023: the portion of the check applied to this booking (per-line allocation). Lines of a
    // check sum to its total.
    amountCents: integer("amount_cents").notNull(),
    // Feature 081 (R2): false once the payment is voided (never set back). A partial unique index on
    // `booking_id WHERE live` holds a booking to one live payment.
    live: boolean("live").notNull().default(true),
  },
  (t) => ({ pk: primaryKey({ columns: [t.paymentId, t.bookingId] }) }),
);

export type PerformerPaymentRow = typeof performerPayments.$inferSelect;
export type PaymentBookingRow = typeof paymentBookings.$inferSelect;
