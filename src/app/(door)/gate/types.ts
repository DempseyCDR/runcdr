import type { MembershipLevel } from "@/server/db/schema/enums";
import type { PerformerCashLine } from "@/server/domain/door/doorRecordService";

/** Feature 082 (contracts/gate.md): the door record as the gate page loads and saves it. */
export type DoorRecord = {
  id: string;
  eventId: string;
  posTransactionCount: number;
  pcGross: number;
  grossCash: number;
  seedFloat: number;
  cashPaidOut: number;
  cashPaidOutReason: string | null;
  deposit: number;
  giftCardRedemptionCount: number;
  compCount: number;
  openBandCount: number;
  performerCash: PerformerCashLine[];
  admission: { cash: number; card: number; check: number; total: number };
  checksTotal: number;
  /** Present only for someone who may record gate money (feature 002 FR-007). */
  cardFee?: number;
  deposits: Deposit[];
  eveningNote: string | null;
  cashCount: Record<string, number>;
  moneyRecordedBy: Person | null;
};

export type Person = { contactId: string; displayName: string };

export type Deposit =
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

export type GateSale = {
  id: string;
  category: string;
  paymentMethod: "cash" | "card" | "check";
  amount: number;
  contactId: string | null;
  contactName: string | null;
  membershipLevel: MembershipLevel | null;
  note: string | null;
  quantity: number | null;
  checkId: string | null;
  recordedBy: Person | null;
};

export type GateCheck = {
  id: string;
  writerContactId: string;
  writer: string;
  amount: number;
  note: string | null;
  depositSeparately: boolean;
  recordedBy: Person | null;
  lines: GateSale[];
};

export type Warning = { code: string; message: string };

export const CATEGORY_LABEL: Record<string, string> = {
  admission: "Admission",
  merchandise: "Merchandise",
  gift_card: "Gift cards sold",
  misc_sales: "Other items",
  donation: "Donation",
  future_event: "Future event",
  membership: "Membership",
};

/** The figures Mary types, as typed — strings until they are sent. */
export type MoneyForm = {
  grossCash: string;
  seedFloat: string;
  cashPaidOut: string;
  cashPaidOutReason: string;
  pcGross: string;
  posTransactionCount: string;
  compCount: string;
  giftCardRedemptionCount: string;
  eveningNote: string;
};
