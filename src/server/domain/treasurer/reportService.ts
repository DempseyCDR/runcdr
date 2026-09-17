import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { settledCentsByBookingForEvent } from "@/server/domain/payments/performerPaymentService";
import {
  bookings,
  contacts,
  doorRecords,
  events,
  gateSales,
  paymentBookings,
  performerPayments,
  performers,
  series,
  seriesQboMap,
  treasurerReportAudit,
  venues,
} from "@/server/db/schema";
import type { GateCategory } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { writeAudit } from "@/server/lib/audit";
import { centsToDollars } from "@/server/lib/money";
import { computeEventGate } from "@/server/domain/gate/eventMoney";
import { reconcilePayments } from "@/server/domain/payments/reconcile";
import { compareCheckNumbers } from "@/server/domain/payments/order";
import { resolveEventRentCents } from "@/server/domain/parameters/rentService";
import {
  getAttendanceBreakdown,
  type AttendanceBreakdown,
} from "@/server/domain/attendance/breakdownService";

// Anonymous non-admission categories shown on the gate receipt (admission is derived).
const ANON_CATEGORIES: GateCategory[] = ["merchandise", "gift_card", "misc_sales"];
// Named-customer receipts (sold to a contact): donation, future_event, membership.
const NAMED_CUSTOMER_CATEGORIES: GateCategory[] = ["donation", "future_event", "membership"];

export type TreasurerReport = {
  event: { id: string; date: string; seriesKey: string };
  gateSalesSummary: {
    customer: string;
    posVerification: { gross: number; fee: number };
    lines: {
      category: string;
      class: string;
      cash: number;
      card: number;
      total: number;
    }[];
  };
  namedCustomerReceipts: {
    kind: string;
    contact: string;
    contactId: string | null;
    class: string;
    amount: number;
  }[];
  // Feature 040 (P6-R8): Bills owed to a vendor — the venue rent → landlord, amount derived from the event's
  // resolved rent. NO check/payment line (rent is paid outside the FS check workflow). Rent only for now.
  bills: {
    vendor: string;
    class: string;
    amount: number;
  }[];
  performerPayments: {
    payee: string;
    amount: number;
    class: string;
    checkNumber: string | null;
    // Feature 023: the per-line allocation — each booking this check settles (incl. cross-event lines).
    lines: { performer: string; bookingId: string; amount: number }[];
  }[];
  // Feature 023: voided checks, shown distinctly so the treasurer records the void into QBO too.
  voidedPerformerPayments: {
    payee: string;
    amount: number;
    checkNumber: string | null;
    voidReason: string | null;
  }[];
  /**
   * Feature 081 (FR-027, FR-028): every check recorded at the event — live and voided — in check-number order,
   * with its void reason, the number that replaced it, Mary's note, and each line's booked and paid amounts
   * (`eventDate` only when the booking was at another event).
   */
  checks: (PaymentReportLine & {
    checkNumber: string;
    class: string;
    voided: boolean;
    voidReason: string | null;
    replacedBy: string | null;
  })[];
  /** Feature 081 (FR-038): live cash paid to performers from this evening's takings. */
  cashPayments: PaymentReportLine[];
  /** Feature 081 (FR-033): the gate's other cash payouts. */
  otherCashPaidOut: { amount: number; reason: string | null };
  /** Feature 081 (FR-038): this event's bookings paid by a payment recorded at another event. */
  paidElsewhere: { performer: string; amount: number; eventDate: string }[];
  // Feature 019 US2 (FR-008) / 023 (M1): expected (sum of booked obligations) vs. actual (LIVE per-line
  // amounts settling the event's bookings). A non-zero delta surfaces a gap — booked but not yet paid.
  performerReconciliation: { expected: number; actual: number; delta: number };
  deposit: { amount: number };
  fees: { doorFee: number; onlineFee: number; total: number };
  // Feature 040 (P6-R9): reconciliation counts — raw free admissions and gift cards redeemed for admission
  // (from the door record). Display-only; they alter no money figure.
  compCount: number;
  giftCardRedemptionCount: number;
  /** Feature 079 (FR-027): the evening's attendance breakdown, identical to the door's and the gate page's. */
  attendance: AttendanceBreakdown;
};

/** Feature 081: one payment as the treasurer report lists it. */
export type PaymentReportLine = {
  payee: string;
  amount: number;
  note: string | null;
  lines: { performer: string; booked: number; paid: number; eventDate: string | null }[];
};

export async function assembleTreasurerReport(
  db: Db,
  eventId: string,
  actor: string | null = null,
): Promise<TreasurerReport> {
  const event = await db.query.events.findFirst({ where: eq(events.id, eventId) });
  if (!event) throw errors.eventNotFound();
  const s = await db.query.series.findFirst({ where: eq(series.id, event.seriesId) });
  const qbo = await db.query.seriesQboMap.findFirst({
    where: eq(seriesQboMap.seriesId, event.seriesId),
  });
  const gateCustomer = qbo?.gateCustomer ?? "Gate";
  const qboClass = qbo?.qboClass ?? "";

  const door = await db.query.doorRecords.findFirst({ where: eq(doorRecords.eventId, eventId) });
  if (!door) throw errors.doorRecordNotFound();

  const sales = await db.select().from(gateSales).where(eq(gateSales.doorRecordId, door.id));

  // Sum a category's cash/card cents.
  function sumCategory(cat: GateCategory): { cash: number; card: number } {
    let cash = 0;
    let card = 0;
    for (const row of sales) {
      if (row.category !== cat) continue;
      if (row.paymentMethod === "cash") cash += row.amountCents;
      else card += row.amountCents;
    }
    return { cash, card };
  }

  // Admission is derived (shared with the organizer report via eventMoney).
  const gate = await computeEventGate(db, eventId);
  const admissionCash = gate.admissionCashCents;
  const admissionCard = gate.admissionCardCents;

  const gateLines = [
    {
      category: "admission",
      class: qboClass,
      cash: centsToDollars(admissionCash),
      card: centsToDollars(admissionCard),
      total: centsToDollars(admissionCash + admissionCard),
    },
    ...ANON_CATEGORIES.flatMap((cat) => {
      const { cash, card } = sumCategory(cat);
      if (cash === 0 && card === 0) return [];
      return [
        {
          category: cat,
          class: qboClass,
          cash: centsToDollars(cash),
          card: centsToDollars(card),
          total: centsToDollars(cash + card),
        },
      ];
    }),
  ];

  // Named-customer receipts: group named-category lines by (contact, category).
  const namedRows = await db
    .select({
      category: gateSales.category,
      amountCents: gateSales.amountCents,
      contactId: gateSales.contactId,
      contactName: contacts.displayName,
    })
    .from(gateSales)
    .leftJoin(contacts, eq(contacts.id, gateSales.contactId))
    .where(eq(gateSales.doorRecordId, door.id));

  const namedMap = new Map<
    string,
    { kind: GateCategory; contact: string; contactId: string | null; amountCents: number }
  >();
  for (const r of namedRows) {
    if (!NAMED_CUSTOMER_CATEGORIES.includes(r.category)) continue;
    const key = `${r.category}:${r.contactId ?? "none"}`;
    const existing = namedMap.get(key);
    if (existing) existing.amountCents += r.amountCents;
    else
      namedMap.set(key, {
        kind: r.category,
        contact: r.contactName ?? "(unknown)",
        contactId: r.contactId,
        amountCents: r.amountCents,
      });
  }
  const namedCustomerReceipts = [...namedMap.values()].map((n) => ({
    kind: n.kind,
    contact: n.contact,
    contactId: n.contactId,
    class: qboClass,
    amount: centsToDollars(n.amountCents),
  }));

  // Feature 019 US2 (FR-008): performer lines now come from ACTUAL payments (performer_payments), not from
  // the booking's expected pay. A payment's account maps from the performer type of a booking it settles —
  // the one performed by the payee if present (the normal/backfilled case), else the first linked booking
  // (an aggregated check across types; QBO reconciliation splits it). Booked pay feeds the reconciliation.
  const bookingRows = await db
    .select({ id: bookings.id, payCents: bookings.payCents })
    .from(bookings)
    .where(eq(bookings.eventId, eventId));

  // Feature 023: checks RECORDED AT this event (recorded-at = check-written date), live + voided.
  const paymentRows = await db
    .select({
      id: performerPayments.id,
      payee: performers.displayName,
      amountCents: performerPayments.amountCents,
      checkNumber: performerPayments.checkNumber,
      voidedAt: performerPayments.voidedAt,
      voidReason: performerPayments.voidReason,
      method: performerPayments.method,
      note: performerPayments.overrideReason,
    })
    .from(performerPayments)
    .innerJoin(performers, eq(performers.id, performerPayments.payeePerformerId))
    .where(eq(performerPayments.eventId, eventId));

  // All allocation lines of those checks — INCLUDING cross-event lines (no same-event filter, 023). Each
  // carries its own amount and the booking's performer (name).
  const paymentIds = paymentRows.map((p) => p.id);
  const lineRows = paymentIds.length
    ? await db
        .select({
          paymentId: paymentBookings.paymentId,
          bookingId: paymentBookings.bookingId,
          amountCents: paymentBookings.amountCents,
          performer: performers.displayName,
          bookedCents: bookings.payCents,
          bookingEventId: bookings.eventId,
          bookingEventDate: events.eventDate,
        })
        .from(paymentBookings)
        .innerJoin(bookings, eq(bookings.id, paymentBookings.bookingId))
        .innerJoin(performers, eq(performers.id, bookings.performerId))
        .innerJoin(events, eq(events.id, bookings.eventId))
        .where(inArray(paymentBookings.paymentId, paymentIds))
    : [];
  const linesByPayment = new Map<string, typeof lineRows>();
  for (const l of lineRows) {
    const list = linesByPayment.get(l.paymentId) ?? [];
    list.push(l);
    linesByPayment.set(l.paymentId, list);
  }

  const toCheck = (p: (typeof paymentRows)[number]) => {
    const lns = linesByPayment.get(p.id) ?? [];
    return {
      payee: p.payee,
      amount: centsToDollars(p.amountCents),
      class: qboClass,
      checkNumber: p.checkNumber,
      lines: lns.map((l) => ({
        performer: l.performer,
        bookingId: l.bookingId,
        amount: centsToDollars(l.amountCents),
      })),
    };
  };
  // Live checks (the QBO batch) and voided checks (distinct — the void is recorded into QBO too).
  const performerPaymentLines = paymentRows.filter((p) => p.voidedAt === null).map(toCheck);
  const voidedPerformerPayments = paymentRows
    .filter((p) => p.voidedAt !== null)
    .map((p) => ({
      payee: p.payee,
      amount: centsToDollars(p.amountCents),
      checkNumber: p.checkNumber,
      voidReason: p.voidReason,
    }));

  // Feature 081 (R15): the checks in number order, the cash apart, and what replaced each voided check.
  const replacements = paymentIds.length
    ? await db
        .select({
          replaces: performerPayments.replacesPaymentId,
          checkNumber: performerPayments.checkNumber,
        })
        .from(performerPayments)
        .where(inArray(performerPayments.replacesPaymentId, paymentIds))
    : [];
  const replacedBy = new Map(replacements.map((r) => [r.replaces, r.checkNumber]));
  const asReport = (p: (typeof paymentRows)[number]): PaymentReportLine => ({
    payee: p.payee,
    amount: centsToDollars(p.amountCents),
    note: p.note,
    lines: (linesByPayment.get(p.id) ?? []).map((l) => ({
      performer: l.performer,
      booked: centsToDollars(l.bookedCents),
      paid: centsToDollars(l.amountCents),
      eventDate: l.bookingEventId === eventId ? null : l.bookingEventDate,
    })),
  });
  const checks = paymentRows
    .filter((p) => p.method === "check" && p.checkNumber !== null)
    .sort((x, y) => compareCheckNumbers(x.checkNumber!, y.checkNumber!))
    .map((p) => ({
      ...asReport(p),
      checkNumber: p.checkNumber!,
      class: qboClass,
      voided: p.voidedAt !== null,
      voidReason: p.voidReason,
      replacedBy: replacedBy.get(p.id) ?? null,
    }));
  const cashPayments = paymentRows
    .filter((p) => p.method === "cash" && p.voidedAt === null)
    .map(asReport);
  const paidElsewhere = (
    await db
      .select({
        performer: performers.displayName,
        amountCents: paymentBookings.amountCents,
        eventDate: events.eventDate,
      })
      .from(paymentBookings)
      .innerJoin(bookings, eq(bookings.id, paymentBookings.bookingId))
      .innerJoin(performers, eq(performers.id, bookings.performerId))
      .innerJoin(performerPayments, eq(performerPayments.id, paymentBookings.paymentId))
      .innerJoin(events, eq(events.id, performerPayments.eventId))
      .where(
        and(
          eq(bookings.eventId, eventId),
          eq(paymentBookings.live, true),
          ne(performerPayments.eventId, eventId),
        ),
      )
  ).map((r) => ({
    performer: r.performer,
    amount: centsToDollars(r.amountCents),
    eventDate: r.eventDate,
  }));

  // Reconciliation (M1): expected = the event's bookings' pay; actual = the LIVE per-line amounts settling
  // those bookings (regardless of which check paid them, excluding voided).
  const settled = await settledCentsByBookingForEvent(db, eventId);
  const performerReconciliation = (() => {
    const r = reconcilePayments(
      bookingRows.map((b) => b.payCents),
      bookingRows.map((b) => settled.get(b.id) ?? 0),
    );
    return {
      expected: centsToDollars(r.expectedCents),
      actual: centsToDollars(r.actualCents),
      delta: centsToDollars(r.deltaCents),
    };
  })();

  // Feature 040 (P6-R8): the venue rent as a Bill owed to the venue's landlord. Amount from the SAME resolver
  // the organizer report uses (so both agree); vendor = the venue's landlord contact, with a "(no landlord
  // set)" fallback (no venue or no landlord). No check/payment line — rent is paid outside the FS workflow.
  const rentCents = await resolveEventRentCents(db, event);
  const landlord = event.venueId
    ? await db
        .select({ landlordName: contacts.displayName })
        .from(venues)
        .leftJoin(contacts, eq(contacts.id, venues.landlordContactId))
        .where(eq(venues.id, event.venueId))
        .then((rows) => rows[0]?.landlordName ?? null)
    : null;
  const bills = [
    { vendor: landlord ?? "(no landlord set)", class: qboClass, amount: centsToDollars(rentCents) },
  ];

  await db.insert(treasurerReportAudit).values({ eventId, actor });
  writeAudit({ kind: "treasurer_report.generated", actor, details: { eventId } });

  return {
    event: { id: event.id, date: event.eventDate, seriesKey: s?.key ?? "" },
    gateSalesSummary: {
      customer: gateCustomer,
      posVerification: {
        gross: centsToDollars(door.pcGrossCents),
        fee: centsToDollars(door.posFeeCents),
      },
      lines: gateLines,
    },
    namedCustomerReceipts,
    bills,
    performerPayments: performerPaymentLines,
    voidedPerformerPayments,
    checks,
    cashPayments,
    otherCashPaidOut: {
      amount: centsToDollars(door.cashPaidOutCents),
      reason: door.cashPaidOutReason,
    },
    paidElsewhere,
    performerReconciliation,
    deposit: { amount: centsToDollars(door.depositCents) },
    fees: {
      doorFee: centsToDollars(door.posFeeCents),
      onlineFee: 0, // online orders arrive with feature 007
      total: centsToDollars(door.posFeeCents),
    },
    compCount: door.compCount, // raw free-admission count (NOT effective comps — research D4)
    giftCardRedemptionCount: door.giftCardRedemptionCount,
    attendance: await getAttendanceBreakdown(db, eventId),
  };
}
