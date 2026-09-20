import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { settledCentsByBookingForEvent } from "@/server/domain/payments/performerPaymentService";
import {
  bands,
  bookings,
  contacts,
  membershipAccounts,
  membershipMembers,
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
import type { GateCategory, PerformerType } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { writeAudit } from "@/server/lib/audit";
import { centsToDollars } from "@/server/lib/money";
import { computeEventGate } from "@/server/domain/gate/eventMoney";
import { eventDeposits } from "@/server/domain/door/deposits";
import { depositView, type DepositView } from "@/server/domain/door/doorRecordPayload";
import { checkViews } from "@/server/domain/door/gateSaleService";
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

/** Feature 082 (research R18): one line of the report's receipts — a sale, or one line of a check. */
export type ReceiptLine = {
  category: string;
  quantity: number | null;
  /** A membership's level — what was bought goes in the books with it. */
  level: string | null;
  /**
   * Who a membership covers besides its payer, read from the account the sale opened — the account is
   * the record, so this is who it covers now, not who it covered that night.
   */
  members: string[];
  /** Who paid: the named buyer of a sale, or a check's payer. Null for a sale to no one in particular. */
  name: string | null;
  /** Whose it is, when a check's line is someone other than its payer's. */
  for: string | null;
  cash: number;
  check: number;
  card: number;
  /** Beneath the line: its own note, then — after a check's last line — the note on the check. */
  notes: string[];
};

/** Feature 082 (research R19): one performer payment as the report's expenses list it. */
export type ExpenseLine = {
  role: PerformerType | null;
  payee: string;
  checkNumber: string | null;
  cash: boolean;
  amount: number;
  voided: boolean;
  /** Beneath the payment: the void, booked-versus-paid, Mary's note, and the other bookings it pays. */
  notes: string[];
};

export type TreasurerReport = {
  event: { id: string; date: string; seriesKey: string };
  /** Feature 082 (research R18): the paper report's heading. */
  header: {
    date: string;
    startTime: string | null;
    /** The event's label, or else its series' name. */
    title: string;
    venue: string | null;
    band: string | null;
    /** The booked musicians' last names, the lead first — only when no band was booked. */
    musicians: string[];
    caller: string | null;
    soundTech: string | null;
  };
  /** Feature 082 (research R18): the left column — every sale, admission as worked out, and the totals. */
  receipts: {
    lines: ReceiptLine[];
    admission: { cash: number; card: number };
    totals: { cash: number; check: number; card: number; total: number };
  };
  /** Feature 082 (research R19): the right column. Voided payments and the rent are out of the totals. */
  expenses: {
    payments: ExpenseLine[];
    otherPaidOut: { amount: number; reason: string | null };
    totals: { check: number; cash: number; total: number };
    rent: { vendor: string; amount: number; unpaid: true };
  };
  card: { gross: number; transactions: number; fee: number };
  /** Feature 082: earlier evenings' bookings paid tonight — for the notes. */
  paidTonightForEarlier: { performer: string; amount: number; eventDate: string }[];
  gateSalesSummary: {
    customer: string;
    posVerification: { gross: number; fee: number };
    lines: {
      category: string;
      class: string;
      cash: number;
      card: number;
      /** Feature 082 (FR-020): paid by check — admission's third source, and a check's other lines. */
      check: number;
      total: number;
    }[];
  };
  /**
   * Named sales paid in cash or by card. Feature 082: a check's lines are NOT here — the books credit a
   * check to its writer, so they appear on the check's own receipt (`checksReceived`), never twice.
   */
  namedCustomerReceipts: {
    kind: string;
    contact: string;
    contactId: string | null;
    class: string;
    amount: number;
    /** Feature 082 (FR-028): what only the desk knew — which event, who else, what for. */
    notes: string[];
  }[];
  /**
   * Feature 082 (FR-031): each check as a receipt to its writer, with what it paid for. `for` names the
   * member or payer of a line when it is not the writer.
   */
  checksReceived: {
    writer: string;
    amount: number;
    note: string | null;
    depositSeparately: boolean;
    class: string;
    lines: {
      category: string;
      amount: number;
      quantity: number | null;
      for: string | null;
      /** A membership line's level — what was bought goes in the books with it. */
      level: string | null;
      note: string | null;
    }[];
  }[];
  /** Feature 082 (FR-032): the main deposit and one per check banked on its own, each with its make-up. */
  deposits: DepositView[];
  /** Feature 082 (FR-030): the freehand note of the paper gate report. */
  eveningNote: string | null;
  /** Feature 082 (FR-033): who last saved the gate money, and who last recorded a performer payment. */
  recordedBy: { gateMoney: string | null; performerPayments: string | null };
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

  // Sum a category's cents by how it was paid. Feature 082: a line paid BY CHECK is its own column — it
  // used to fall into "card" by elimination, which would have reported a check's T-shirt as a card sale.
  function sumCategory(cat: GateCategory): { cash: number; card: number; check: number } {
    const sum = { cash: 0, card: 0, check: 0 };
    for (const row of sales) {
      if (row.category === cat) sum[row.paymentMethod] += row.amountCents;
    }
    return sum;
  }

  // Admission is derived (shared with the organizer report via eventMoney); feature 082 adds the part a
  // check paid for.
  const gate = await computeEventGate(db, eventId);
  const admissionCash = gate.admissionCashCents;
  const admissionCard = gate.admissionCardCents;
  const admissionCheck = gate.admissionCheckCents;

  const gateLines = [
    {
      category: "admission",
      class: qboClass,
      cash: centsToDollars(admissionCash),
      card: centsToDollars(admissionCard),
      check: centsToDollars(admissionCheck),
      total: centsToDollars(admissionCash + admissionCard + admissionCheck),
    },
    ...ANON_CATEGORIES.flatMap((cat) => {
      const { cash, card, check } = sumCategory(cat);
      if (cash === 0 && card === 0 && check === 0) return [];
      return [
        {
          category: cat,
          class: qboClass,
          cash: centsToDollars(cash),
          card: centsToDollars(card),
          check: centsToDollars(check),
          total: centsToDollars(cash + card + check),
        },
      ];
    }),
  ];

  // Named-customer receipts: group named-category lines by (contact, category).
  const namedRows = await db
    .select({
      category: gateSales.category,
      amountCents: gateSales.amountCents,
      paymentMethod: gateSales.paymentMethod,
      quantity: gateSales.quantity,
      level: gateSales.membershipLevel,
      contactId: gateSales.contactId,
      contactName: contacts.displayName,
      note: gateSales.note,
    })
    .from(gateSales)
    .leftJoin(contacts, eq(contacts.id, gateSales.contactId))
    .where(and(eq(gateSales.doorRecordId, door.id), isNull(gateSales.checkId)))
    .orderBy(asc(gateSales.category), asc(contacts.displayName));

  const namedMap = new Map<
    string,
    {
      kind: GateCategory;
      contact: string;
      contactId: string | null;
      amountCents: number;
      notes: string[];
    }
  >();
  for (const r of namedRows) {
    if (!NAMED_CUSTOMER_CATEGORIES.includes(r.category)) continue;
    const key = `${r.category}:${r.contactId ?? "none"}`;
    const existing = namedMap.get(key) ?? {
      kind: r.category,
      contact: r.contactName ?? "(unknown)",
      contactId: r.contactId,
      amountCents: 0,
      notes: [],
    };
    existing.amountCents += r.amountCents;
    if (r.note && !existing.notes.includes(r.note)) existing.notes.push(r.note);
    namedMap.set(key, existing);
  }
  const namedCustomerReceipts = [...namedMap.values()].map((n) => ({
    kind: n.kind,
    contact: n.contact,
    contactId: n.contactId,
    class: qboClass,
    amount: centsToDollars(n.amountCents),
    notes: n.notes,
  }));

  // Feature 082 (FR-031): each check received, as a receipt to its writer.
  const checkList = await checkViews(db, door.id);
  const checksReceived = checkList.map((c) => ({
    writer: c.writer,
    amount: c.amount,
    note: c.note,
    depositSeparately: c.depositSeparately,
    class: qboClass,
    lines: c.lines.map((l) => ({
      category: l.category,
      amount: l.amount,
      quantity: l.quantity,
      for: l.contactId && l.contactId !== c.writerContactId ? l.contactName : null,
      level: l.membershipLevel,
      note: l.note,
    })),
  }));

  // Who each membership covers besides its payer, from the payer's account (the quickstart walk, §3.3).
  const membershipPayers = [
    ...new Set(
      [...namedRows, ...checkList.flatMap((c) => c.lines)].flatMap((l) =>
        l.category === "membership" && l.contactId ? [l.contactId] : [],
      ),
    ),
  ];
  const coveredBy = new Map<string, string[]>();
  if (membershipPayers.length > 0) {
    const rows = await db
      .select({ payerContactId: membershipAccounts.payerContactId, member: contacts.displayName })
      .from(membershipAccounts)
      .innerJoin(membershipMembers, eq(membershipMembers.accountId, membershipAccounts.id))
      .innerJoin(contacts, eq(contacts.id, membershipMembers.contactId))
      .where(
        and(
          inArray(membershipAccounts.payerContactId, membershipPayers),
          ne(membershipMembers.contactId, membershipAccounts.payerContactId),
        ),
      );
    for (const r of rows) {
      coveredBy.set(r.payerContactId, [...(coveredBy.get(r.payerContactId) ?? []), r.member]);
    }
  }
  const covers = (category: string, contactId: string | null) =>
    category === "membership" && contactId ? (coveredBy.get(contactId) ?? []) : [];

  // Feature 082 (research R18): the receipts column — each sale on its own line, then each check's lines
  // under its payer, every amount in the column of how it was paid.
  const receiptLines: ReceiptLine[] = [
    ...namedRows.map((r) => ({
      category: r.category,
      quantity: r.quantity,
      level: r.level,
      members: covers(r.category, r.contactId),
      name: r.contactName,
      for: null,
      cash: r.paymentMethod === "cash" ? centsToDollars(r.amountCents) : 0,
      check: 0,
      card: r.paymentMethod === "card" ? centsToDollars(r.amountCents) : 0,
      notes: r.note ? [r.note] : [],
    })),
    ...checkList.flatMap((c) =>
      c.lines.map((l, i) => ({
        category: l.category,
        quantity: l.quantity,
        level: l.membershipLevel,
        members: covers(l.category, l.contactId),
        name: c.writer,
        for: l.contactId && l.contactId !== c.writerContactId ? l.contactName : null,
        cash: 0,
        check: l.amount,
        card: 0,
        notes: [
          ...(l.note ? [l.note] : []),
          ...(i === c.lines.length - 1 && c.note ? [c.note] : []),
        ],
      })),
    ),
  ];
  const column = (k: "cash" | "check" | "card") =>
    Math.round(receiptLines.reduce((a, l) => a + l[k] * 100, 0));
  const receiptCents = {
    cash: admissionCash + column("cash"),
    check: column("check"),
    card: admissionCard + column("card"),
  };
  const receipts = {
    lines: receiptLines,
    admission: { cash: centsToDollars(admissionCash), card: centsToDollars(admissionCard) },
    totals: {
      cash: centsToDollars(receiptCents.cash),
      check: centsToDollars(receiptCents.check),
      card: centsToDollars(receiptCents.card),
      total: centsToDollars(receiptCents.cash + receiptCents.check + receiptCents.card),
    },
  };

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
      payeeId: performerPayments.payeePerformerId,
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
          performerId: bookings.performerId,
          performerType: bookings.performerType,
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

  // Feature 082 (research R19): the expenses column. Each payment's own booking — the payee's, here — gives
  // its role and its booked-versus-paid; the other bookings it pays are notes beneath it.
  const dollars = (cents: number) => `$${centsToDollars(cents).toFixed(2)}`;
  const toExpense = (p: (typeof paymentRows)[number]): ExpenseLine => {
    const lns = linesByPayment.get(p.id) ?? [];
    const own =
      lns.find((l) => l.performerId === p.payeeId && l.bookingEventId === eventId) ?? lns[0];
    const notes: string[] = [];
    if (p.voidedAt) notes.push(`Void — ${p.voidReason ?? "no reason given"}`);
    const replacement = replacedBy.get(p.id);
    if (replacement) notes.push(`replaced by check ${replacement}`);
    if (own && own.bookedCents !== own.amountCents) {
      notes.push(`booked ${dollars(own.bookedCents)} · paid ${dollars(own.amountCents)}`);
    }
    if (p.note) notes.push(p.note);
    for (const l of lns) {
      if (l === own) continue;
      const when = l.bookingEventId === eventId ? "" : ` (${l.bookingEventDate})`;
      const short = l.bookedCents !== l.amountCents ? ` · booked ${dollars(l.bookedCents)}` : "";
      notes.push(`also pays ${l.performer} ${dollars(l.amountCents)}${when}${short}`);
    }
    return {
      role: own?.performerType ?? null,
      payee: p.payee,
      checkNumber: p.checkNumber,
      cash: p.method === "cash",
      amount: centsToDollars(p.amountCents),
      voided: p.voidedAt !== null,
      notes,
    };
  };
  const expensePayments = [
    ...paymentRows
      .filter((p) => p.method === "check")
      .sort((x, y) => compareCheckNumbers(x.checkNumber ?? "", y.checkNumber ?? "")),
    ...paymentRows.filter((p) => p.method === "cash"),
  ];
  const liveCents = (method: "check" | "cash") =>
    paymentRows
      .filter((p) => p.method === method && p.voidedAt === null)
      .reduce((a, p) => a + p.amountCents, 0);
  const paidTonightForEarlier = paymentRows
    .filter((p) => p.voidedAt === null)
    .flatMap((p) => linesByPayment.get(p.id) ?? [])
    .filter((l) => l.bookingEventId !== eventId)
    .map((l) => ({
      performer: l.performer,
      amount: centsToDollars(l.amountCents),
      eventDate: l.bookingEventDate,
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
  const venue = event.venueId
    ? await db
        .select({ name: venues.name, landlordName: contacts.displayName })
        .from(venues)
        .leftJoin(contacts, eq(contacts.id, venues.landlordContactId))
        .where(eq(venues.id, event.venueId))
        .then((rows) => rows[0] ?? null)
    : null;
  const landlord = venue?.landlordName ?? null;
  const bills = [
    { vendor: landlord ?? "(no landlord set)", class: qboClass, amount: centsToDollars(rentCents) },
  ];

  // Feature 082 (research R18): the heading — whose evening it was, from what was booked.
  const booked = await db
    .select({ type: bookings.performerType, name: performers.displayName, band: bands.name })
    .from(bookings)
    .innerJoin(performers, eq(performers.id, bookings.performerId))
    .leftJoin(bands, eq(bands.id, bookings.bandId))
    .where(and(eq(bookings.eventId, eventId), ne(bookings.status, "declined")));
  const namesOf = (type: PerformerType) =>
    booked
      .filter((b) => b.type === type)
      .map((b) => b.name)
      .join(", ") || null;
  const band = [...new Set(booked.flatMap((b) => (b.band ? [b.band] : [])))].join(" & ") || null;
  const lastName = (name: string) => name.trim().split(/\s+/).pop() ?? name;
  const header = {
    date: event.eventDate,
    startTime: event.startTime,
    title: event.label ?? s?.name ?? "",
    venue: venue?.name ?? null,
    band,
    musicians: band
      ? []
      : (["lead_musician", "musician"] as const).flatMap((type) =>
          booked.filter((b) => b.type === type).map((b) => lastName(b.name)),
        ),
    caller: namesOf("caller"),
    soundTech: namesOf("sound_tech"),
  };

  // Feature 082 (FR-033): who last saved the gate money, and who last recorded or changed a payment here.
  const nameOf = async (contactId: string | null) =>
    contactId
      ? ((await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) }))?.displayName ??
        null)
      : null;
  const [lastPayment] = await db
    .select({ recordedBy: performerPayments.recordedByContactId })
    .from(performerPayments)
    .where(
      and(eq(performerPayments.eventId, eventId), isNotNull(performerPayments.recordedByContactId)),
    )
    .orderBy(desc(performerPayments.updatedAt))
    .limit(1);
  const recordedBy = {
    gateMoney: await nameOf(door.moneyRecordedByContactId),
    performerPayments: await nameOf(lastPayment?.recordedBy ?? null),
  };
  const deposits = (await eventDeposits(db, eventId)).map(depositView);

  await db.insert(treasurerReportAudit).values({ eventId, actor });
  writeAudit({ kind: "treasurer_report.generated", actor, details: { eventId } });

  return {
    event: { id: event.id, date: event.eventDate, seriesKey: s?.key ?? "" },
    header,
    receipts,
    expenses: {
      payments: expensePayments.map(toExpense),
      otherPaidOut: {
        amount: centsToDollars(door.cashPaidOutCents),
        reason: door.cashPaidOutReason,
      },
      totals: {
        check: centsToDollars(liveCents("check")),
        cash: centsToDollars(liveCents("cash") + door.cashPaidOutCents),
        total: centsToDollars(liveCents("check") + liveCents("cash") + door.cashPaidOutCents),
      },
      rent: {
        vendor: landlord ?? "(no landlord set)",
        amount: centsToDollars(rentCents),
        unpaid: true as const,
      },
    },
    card: {
      gross: centsToDollars(door.pcGrossCents),
      transactions: door.posTransactionCount,
      fee: centsToDollars(door.posFeeCents),
    },
    paidTonightForEarlier,
    gateSalesSummary: {
      customer: gateCustomer,
      posVerification: {
        gross: centsToDollars(door.pcGrossCents),
        fee: centsToDollars(door.posFeeCents),
      },
      lines: gateLines,
    },
    namedCustomerReceipts,
    checksReceived,
    deposits,
    eveningNote: door.eveningNote,
    recordedBy,
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
