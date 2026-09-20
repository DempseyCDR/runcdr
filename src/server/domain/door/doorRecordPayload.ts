import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/client";
import { contacts, doorRecords, events } from "@/server/db/schema";
import { actorCan } from "@/server/auth/can";
import type { Actor } from "@/server/auth/actor";
import { errors } from "@/server/lib/apiError";
import { centsToDollars } from "@/server/lib/money";
import { deriveGateMoney } from "@/server/domain/gate/deriveGateMoney";
import { eventDeposits, type Deposit } from "./deposits";
import { performerCashCentsFor, performerCashFor, type DoorRecordView } from "./doorRecordService";
import { checkViews, saleViews, type GateCheckView, type GateSaleView } from "./gateSaleService";

/** Whether this caller may record gate money for the door record's event — and so may see the fee. */
export async function mayRecordGateMoney(
  db: DbOrTx,
  actor: Actor,
  doorRecordId: string,
): Promise<boolean> {
  const dr = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, doorRecordId) });
  if (!dr) throw errors.doorRecordNotFound();
  const event = await db.query.events.findFirst({ where: eq(events.id, dr.eventId) });
  if (!event) throw errors.eventNotFound();
  return actorCan(actor, "gate.write", { seriesId: event.seriesId, groupId: event.groupId });
}

/**
 * Feature 082 (contracts/gate.md): what the gate page loads — the door record with the evening's money
 * worked out, the sales, and the checks with their lines.
 *
 * Its own module so that every import runs one way: this reads the door record, the sales, the checks and
 * the deposits, and none of them read it.
 */

/** A deposit as the pages see it, in dollars. A check's own deposit is just its writer and amount. */
export type DepositView =
  | {
      kind: "main";
      amount: number;
      makeUp: {
        countedCash: number;
        seedFloat: number;
        otherPaidOut: number;
        performerCash: number;
        checks: number;
      };
    }
  | { kind: "check"; checkId: string; writer: string; amount: number };

export type GateMoneyView = {
  admission: { cash: number; card: number; check: number; total: number };
  checksTotal: number;
  /**
   * Present only for someone who may record gate money. Mary sees the fee as she types (MARY-R15 Q10);
   * the door volunteer never does (feature 002 FR-007, SC-003) — and the door opens this payload too,
   * to post a sale, so the rule is kept here rather than trusted to a page not rendering it.
   */
  cardFee?: number;
  deposits: DepositView[];
  eveningNote: string | null;
  cashCount: Record<string, number>;
  moneyRecordedBy: { contactId: string; displayName: string } | null;
};

export type DoorRecordPayload = {
  doorRecord: DoorRecordView & GateMoneyView;
  /** The anonymous and named sales. A check's lines are under `checks`, never here. */
  gateSales: GateSaleView[];
  checks: GateCheckView[];
};

export function depositView(d: Deposit): DepositView {
  if (d.kind === "check") {
    return { kind: "check", checkId: d.checkId!, writer: d.writer!, amount: d.amount };
  }
  return {
    kind: "main",
    amount: d.amount,
    makeUp: {
      countedCash: centsToDollars(d.makeUp.countedCashCents),
      seedFloat: centsToDollars(d.makeUp.seedFloatCents),
      otherPaidOut: centsToDollars(d.makeUp.otherPaidOutCents),
      performerCash: centsToDollars(d.makeUp.performerCashCents),
      checks: centsToDollars(d.makeUp.checksCents),
    },
  };
}

/** Feature 082 (FR-007): what the Save points out. Never a refusal — the money is saved regardless. */
export type GateWarning = {
  code: "NEGATIVE_ADMISSION" | "PAYOUT_WITHOUT_REASON" | "CARD_GROSS_WITHOUT_COUNT";
  message: string;
};

/**
 * The warnings a saved evening earns (FR-007, MARY-R15 Q11). They come back FROM THE SAVE and are shown
 * then — the page never computes them while Mary is still typing.
 */
export function gateWarnings(record: DoorRecordView & GateMoneyView): GateWarning[] {
  const warnings: GateWarning[] = [];
  const { cash, card } = record.admission;
  if (cash < 0 || card < 0) {
    const which = cash < 0 ? `$${(-cash).toFixed(2)} by cash` : `$${(-card).toFixed(2)} by card`;
    warnings.push({
      code: "NEGATIVE_ADMISSION",
      message: `Admission comes out negative (${which}) — check the counted cash and the other sales.`,
    });
  }
  if (record.cashPaidOut > 0 && !record.cashPaidOutReason?.trim()) {
    warnings.push({
      code: "PAYOUT_WITHOUT_REASON",
      message: "Cash was paid out with no reason — say what it was for.",
    });
  }
  if (record.pcGross > 0 && record.posTransactionCount === 0) {
    warnings.push({
      code: "CARD_GROSS_WITHOUT_COUNT",
      message: "Card gross has no transaction count, so the card fee cannot be worked out.",
    });
  }
  return warnings;
}

export async function doorRecordPayload(
  db: DbOrTx,
  doorRecordId: string,
  opts: { withFee: boolean },
): Promise<DoorRecordPayload> {
  const row = await db.query.doorRecords.findFirst({ where: eq(doorRecords.id, doorRecordId) });
  if (!row) throw errors.doorRecordNotFound();

  const [sales, checks, deposits, performerCash, performerCashCents, recorder] = await Promise.all([
    saleViews(db, { doorRecordId }),
    checkViews(db, doorRecordId),
    eventDeposits(db, row.eventId),
    performerCashFor(db, row.eventId),
    performerCashCentsFor(db, row.eventId),
    row.moneyRecordedByContactId
      ? db.query.contacts.findFirst({ where: eq(contacts.id, row.moneyRecordedByContactId) })
      : Promise.resolve(undefined),
  ]);

  const others = sales.filter((s) => s.checkId === null);
  const cents = (dollars: number) => Math.round(dollars * 100);
  const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
  const lines = checks.flatMap((c) => c.lines);

  // Research R10: the same function the page runs as Mary types, so the saved figures and the preview agree.
  const money = deriveGateMoney({
    grossCashCents: row.grossCashCents,
    seedFloatCents: row.seedFloatCents,
    cashPaidOutCents: row.cashPaidOutCents,
    performerCashCents,
    cardGrossCents: row.pcGrossCents,
    posTransactionCount: row.posTransactionCount,
    nonAdmissionCashCents: sum(
      others.filter((s) => s.paymentMethod === "cash").map((s) => cents(s.amount)),
    ),
    nonAdmissionCardCents: sum(
      others.filter((s) => s.paymentMethod === "card").map((s) => cents(s.amount)),
    ),
    checkAdmissionCents: sum(
      lines.filter((l) => l.category === "admission").map((l) => cents(l.amount)),
    ),
    checksCents: sum(checks.map((c) => cents(c.amount))),
    checksDepositedSeparatelyCents: sum(
      checks.filter((c) => c.depositSeparately).map((c) => cents(c.amount)),
    ),
  });

  return {
    doorRecord: {
      id: row.id,
      eventId: row.eventId,
      posTransactionCount: row.posTransactionCount,
      pcGross: centsToDollars(row.pcGrossCents),
      grossCash: centsToDollars(row.grossCashCents),
      seedFloat: centsToDollars(row.seedFloatCents),
      cashPaidOut: centsToDollars(row.cashPaidOutCents),
      cashPaidOutReason: row.cashPaidOutReason,
      deposit: centsToDollars(row.depositCents),
      giftCardRedemptionCount: row.giftCardRedemptionCount,
      compCount: row.compCount,
      openBandCount: row.openBandCount,
      performerCash,
      admission: {
        cash: centsToDollars(money.admissionCashCents),
        card: centsToDollars(money.admissionCardCents),
        check: centsToDollars(money.admissionCheckCents),
        total: centsToDollars(money.admissionCents),
      },
      checksTotal: centsToDollars(money.checksCents),
      ...(opts.withFee ? { cardFee: centsToDollars(money.cardFeeCents) } : {}),
      deposits: deposits.map(depositView),
      eveningNote: row.eveningNote,
      cashCount: row.cashCount,
      moneyRecordedBy:
        row.moneyRecordedByContactId && recorder
          ? { contactId: row.moneyRecordedByContactId, displayName: recorder.displayName }
          : null,
    },
    gateSales: others,
    checks,
  };
}
