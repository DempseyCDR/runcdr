import type { PaymentSummary } from "@/server/domain/payments/paymentSummary";

/** Feature 081: a payment summary for component tests — nothing booked unless a test says so. */
export const SUMMARY = (over: Partial<PaymentSummary> = {}): PaymentSummary => ({
  booked: 0,
  paid: 0,
  stillToPay: 0,
  stillToPayCount: 0,
  difference: 0,
  earlierPaidHere: 0,
  performerCash: [],
  ...over,
});
