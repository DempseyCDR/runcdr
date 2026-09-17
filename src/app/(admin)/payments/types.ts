import type { PerformerPaymentView } from "@/server/domain/payments/performerPaymentService";
import type { PaymentSummary } from "@/server/domain/payments/paymentSummary";
import type { Sent } from "./savePayment";

/** Feature 081: what the payments page reads from the server. */
export type Booking = {
  id: string;
  eventId: string;
  performerId: string;
  performerName: string;
  performerType: string;
  payCents: number;
  requiresCheck: boolean;
  isDonated: boolean;
  status: string;
};

export type Payment = PerformerPaymentView;

export type VoidedLine = { paymentId: string; checkNumber: string | null; reason: string | null };
export type PaidElsewhere = { eventId: string; eventDate: string; paymentId: string };

export type PaymentsList = {
  payments: Payment[];
  voidedByBooking: Record<string, VoidedLine[]>;
  paidElsewhere: Record<string, PaidElsewhere>;
  summary: PaymentSummary;
  treasurerReportGeneratedAt: string | null;
};

/** How a booking stands on the page (data-model.md §Derived views). */
export type RowState =
  | { kind: "paid"; payment: Payment; lineAmount: number }
  | { kind: "paidElsewhere"; at: PaidElsewhere }
  | { kind: "toPay" }
  | { kind: "free" };

export type PaymentBody = {
  eventId: string;
  payeePerformerId: string;
  method: "check" | "cash";
  checkNumber?: string;
  overrideReason?: string;
  confirmSecondPayment?: boolean;
  lines: { bookingId: string; amount: number }[];
};

export type Refusal = { code: string; message: string; details?: Record<string, unknown> };

/** What a caller lets the page do once a refusal has been turned into a choice. */
export type RefusalHooks = {
  /** The payment went through in the end (added to a check, or paid again). */
  done: () => void;
  /** Back to the number field, to change it. */
  focusNumber?: () => void;
  /** How to send the payment again with the confirmation — a new payment unless this is an edit. */
  resend?: (body: SentBody) => Promise<Sent>;
  /** An edit is not a new booking to add to a check. */
  noAdd?: boolean;
};

/** A new payment, or the fields of an edit. */
export type SentBody = Partial<Omit<PaymentBody, "overrideReason">> & {
  /** An edit clears a note with null. */
  overrideReason?: string | null;
};

/** Lets the page turn a refusal into a choice; returns true when it has taken over. */
export type RefusalHandler = (refusal: Refusal, body: SentBody, hooks: RefusalHooks) => boolean;
