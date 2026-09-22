import { BREAKDOWN } from "./attendanceBreakdown";

/**
 * The gate report as the page receives it (feature 082, research R18 and R19 — the paper layout): the
 * heading, the receipts and expenses columns, the deposits and card, the notes, and 079's attendance.
 * Tests override only what they are about.
 */
export function REPORT(eventId: string, over: Record<string, unknown> = {}) {
  return {
    header: {
      date: eventId === "e_old" ? "2020-01-10" : "2020-06-15",
      startTime: "19:30:00",
      title: `Contra ${eventId}`,
      venue: null,
      band: null,
      musicians: [],
      caller: null,
      soundTech: null,
    },
    receipts: {
      lines: [],
      admission: { cash: 0, card: 0 },
      totals: { cash: 0, check: 0, card: 0, total: 0 },
    },
    expenses: {
      payments: [],
      otherPaidOut: { amount: 0, reason: null },
      totals: { check: 0, cash: 0, total: 0 },
      rent: { vendor: "(no landlord set)", amount: 0, unpaid: true },
      reconciliation: { booked: 0, paid: 0, outstanding: 0 },
    },
    card: { gross: 0, transactions: 0, fee: 0 },
    deposits: [
      {
        kind: "main",
        amount: 0,
        makeUp: { countedCash: 0, seedFloat: 0, otherPaidOut: 0, performerCash: 0, checks: 0 },
      },
    ],
    eveningNote: null,
    paidElsewhere: [],
    paidTonightForEarlier: [],
    recordedBy: { gateMoney: null, performerPayments: null },
    attendance: BREAKDOWN({ paying: eventId === "e_old" ? 12 : 21, comps: 3, giftCards: 2 }),
    ...over,
  };
}
