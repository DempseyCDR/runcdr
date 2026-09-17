import { describe, expect, it } from "vitest";
import {
  checkNumberSchema,
  paymentLineAddSchema,
  performerPaymentCreateSchema,
  performerPaymentPatchSchema,
  settlementPerformerSchema,
} from "@/server/validation/payments";

const ID = "00000000-0000-4000-8000-000000000001";
const line = { bookingId: ID, amount: 100 };
const base = { eventId: ID, payeePerformerId: ID, lines: [line] };

/** Feature 081 (FR-031, FR-032, FR-039; research R1, R3a, R6): the shape of a payment request. */
describe("payment validation (081)", () => {
  it("normalises a check number to trimmed capitals and accepts one trailing letter", () => {
    expect(checkNumberSchema.parse(" 1500a ")).toBe("1500A");
    expect(checkNumberSchema.parse("1500")).toBe("1500");
    for (const bad of ["#1500", "15OO", "1500AB", "", "A1500", "15 00"]) {
      expect(checkNumberSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("requires a method; a check needs a number and cash must not have one", () => {
    expect(performerPaymentCreateSchema.safeParse({ ...base, checkNumber: "1500" }).success).toBe(
      false,
    );
    expect(
      performerPaymentCreateSchema.safeParse({ ...base, method: "check", checkNumber: "1500" })
        .success,
    ).toBe(true);
    expect(performerPaymentCreateSchema.safeParse({ ...base, method: "check" }).success).toBe(
      false,
    );
    expect(performerPaymentCreateSchema.safeParse({ ...base, method: "cash" }).success).toBe(true);
    expect(
      performerPaymentCreateSchema.safeParse({ ...base, method: "cash", checkNumber: "1500" })
        .success,
    ).toBe(false);
  });

  it("refuses cash settling more than one booking", () => {
    const two = { ...base, lines: [line, { bookingId: ID.replace(/1$/, "2"), amount: 5 }] };
    expect(performerPaymentCreateSchema.safeParse({ ...two, method: "cash" }).success).toBe(false);
    expect(
      performerPaymentCreateSchema.safeParse({ ...two, method: "check", checkNumber: "7" }).success,
    ).toBe(true);
  });

  it("accepts the confirmation and no longer accepts a client-chosen replacement", () => {
    const ok = performerPaymentCreateSchema.parse({
      ...base,
      method: "check",
      checkNumber: "12",
      confirmSecondPayment: true,
    });
    expect(ok.confirmSecondPayment).toBe(true);
    expect(
      performerPaymentCreateSchema.safeParse({
        ...base,
        method: "check",
        checkNumber: "12",
        replacesPaymentId: ID,
      }).success,
    ).toBe(false);
  });

  it("lets a patch change the payee, the method and confirm a second payment", () => {
    const parsed = performerPaymentPatchSchema.parse({
      payeePerformerId: ID,
      method: "cash",
      checkNumber: null,
      confirmSecondPayment: true,
    });
    expect(parsed).toMatchObject({ payeePerformerId: ID, method: "cash", checkNumber: null });
    expect(performerPaymentPatchSchema.safeParse({ checkNumber: "12x" }).success).toBe(true);
    expect(performerPaymentPatchSchema.parse({ checkNumber: "12x" }).checkNumber).toBe("12X");
    expect(performerPaymentPatchSchema.safeParse({ lines: [] }).success).toBe(false);
  });

  it("adds a line from the event being paid from", () => {
    expect(paymentLineAddSchema.parse({ eventId: ID, bookingId: ID, amount: 0 })).toEqual({
      eventId: ID,
      bookingId: ID,
      amount: 0,
    });
    expect(paymentLineAddSchema.safeParse({ bookingId: ID, amount: 5 }).success).toBe(false);
  });

  it("lets a last-minute performer be added at a chosen pay", () => {
    expect(
      settlementPerformerSchema.parse({ performerId: ID, performerType: "instructor", pay: 50 }),
    ).toMatchObject({ pay: 50 });
    expect(
      settlementPerformerSchema.safeParse({ performerId: ID, performerType: "caller", pay: -1 })
        .success,
    ).toBe(false);
  });
});
