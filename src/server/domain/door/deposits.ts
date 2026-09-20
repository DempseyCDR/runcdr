import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/client";
import { contacts, doorRecords, gateChecks, gateSales } from "@/server/db/schema";
import { centsToDollars } from "@/server/lib/money";
import { performerCashCentsFor } from "./doorRecordService";

/**
 * Feature 082 (research R4): the evening's deposits — what actually goes to the bank.
 *
 * DERIVED, never stored as rows. The main deposit is the counted cash less the float, the other payouts
 * and the cash paid to performers, plus every check NOT marked "deposit separately"; each marked check
 * makes a deposit of its own (FR-022). Nothing chooses which check joins which deposit beyond that mark,
 * so a `deposits` table would only repeat what the mark already says.
 *
 * `/gate` and the gate report both read this, so they cannot disagree about what was banked.
 */
export type DepositMakeUp = {
  countedCashCents: number;
  seedFloatCents: number;
  otherPaidOutCents: number;
  performerCashCents: number;
  /** The checks banked WITH the cash — the ones not marked. */
  checksCents: number;
};

export type Deposit = {
  kind: "main" | "check";
  amountCents: number;
  /** Dollars, for the pages that render money. */
  amount: number;
  /** Set on a check's own deposit. */
  checkId?: string;
  writer?: string;
  makeUp: DepositMakeUp;
};

export type CheckTotal = {
  checkId: string;
  writer: string;
  depositSeparately: boolean;
  amountCents: number;
};

/**
 * Every check of a door record with its writer and its total. A check's amount is always the sum of its
 * lines (FR-017), so it is summed here rather than stored anywhere.
 */
export async function checkTotalsFor(db: DbOrTx, doorRecordId: string): Promise<CheckTotal[]> {
  const lines = await db
    .select({
      checkId: gateChecks.id,
      depositSeparately: gateChecks.depositSeparately,
      writer: contacts.displayName,
      amountCents: gateSales.amountCents,
    })
    .from(gateChecks)
    .leftJoin(contacts, eq(contacts.id, gateChecks.writerContactId))
    .leftJoin(gateSales, eq(gateSales.checkId, gateChecks.id))
    .where(eq(gateChecks.doorRecordId, doorRecordId));

  const byCheck = new Map<string, CheckTotal>();
  for (const l of lines) {
    const seen = byCheck.get(l.checkId) ?? {
      checkId: l.checkId,
      writer: l.writer ?? "Unknown",
      depositSeparately: l.depositSeparately,
      amountCents: 0,
    };
    seen.amountCents += l.amountCents ?? 0;
    byCheck.set(l.checkId, seen);
  }
  return [...byCheck.values()];
}

export async function eventDeposits(db: DbOrTx, eventId: string): Promise<Deposit[]> {
  const door = await db.query.doorRecords.findFirst({ where: eq(doorRecords.eventId, eventId) });
  if (!door) return [];

  const totals = await checkTotalsFor(db, door.id);
  const performerCashCents = await performerCashCentsFor(db, eventId);
  const withCash = totals
    .filter((c) => !c.depositSeparately)
    .reduce((a, c) => a + c.amountCents, 0);

  const main: Deposit = {
    kind: "main",
    amountCents: door.depositCents,
    amount: centsToDollars(door.depositCents),
    makeUp: {
      countedCashCents: door.grossCashCents,
      seedFloatCents: door.seedFloatCents,
      otherPaidOutCents: door.cashPaidOutCents,
      performerCashCents,
      checksCents: withCash,
    },
  };

  const separate: Deposit[] = totals
    .filter((c) => c.depositSeparately)
    .map((c) => ({
      kind: "check" as const,
      amountCents: c.amountCents,
      amount: centsToDollars(c.amountCents),
      checkId: c.checkId,
      writer: c.writer,
      makeUp: {
        countedCashCents: 0,
        seedFloatCents: 0,
        otherPaidOutCents: 0,
        performerCashCents: 0,
        checksCents: c.amountCents,
      },
    }));

  return [main, ...separate];
}
