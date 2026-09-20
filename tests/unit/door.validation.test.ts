import { describe, expect, it } from "vitest";
import {
  doorRecordPatchSchema,
  gateCheckCreateSchema,
  gateCheckPatchSchema,
  gateSaleCreateSchema,
  gateSalePatchSchema,
} from "@/server/validation/door";

// Feature 082: the shapes the gate's new routes take. Pure Zod — no database.
//
// One rule deliberately does NOT live here: `admission` is ACCEPTED by the sale schema and refused by
// the service with ADMISSION_NEEDS_CHECK, so the refusal carries its own code rather than arriving as a
// generic validation error (analysis A2, contracts/gate.md).

const sale = {
  category: "donation" as const,
  paymentMethod: "cash" as const,
  amount: 40,
  contactId: "11111111-1111-4111-8111-111111111111",
};

describe("gateSaleCreateSchema", () => {
  it("requires a contact on a named category", () => {
    for (const category of ["donation", "future_event", "membership"] as const) {
      const body = {
        ...sale,
        category,
        ...(category === "membership" ? { membershipLevel: "individual" as const } : {}),
      };
      expect(gateSaleCreateSchema.safeParse(body).success).toBe(true);
      expect(gateSaleCreateSchema.safeParse({ ...body, contactId: undefined }).success).toBe(false);
    }
  });

  it("takes an anonymous category with no contact", () => {
    for (const category of ["merchandise", "gift_card", "misc_sales"] as const) {
      const parsed = gateSaleCreateSchema.safeParse({
        category,
        paymentMethod: "card",
        amount: 25,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("requires a level on a membership and forbids it elsewhere", () => {
    expect(gateSaleCreateSchema.safeParse({ ...sale, category: "membership" }).success).toBe(false);
    expect(
      gateSaleCreateSchema.safeParse({
        ...sale,
        category: "membership",
        membershipLevel: "family",
      }).success,
    ).toBe(true);
    expect(gateSaleCreateSchema.safeParse({ ...sale, membershipLevel: "family" }).success).toBe(
      false,
    );
  });

  it("accepts admission, leaving the refusal to the service", () => {
    const parsed = gateSaleCreateSchema.safeParse({
      category: "admission",
      paymentMethod: "cash",
      amount: 30,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an optional note", () => {
    expect(gateSaleCreateSchema.safeParse({ ...sale, note: "for the sound fund" }).success).toBe(
      true,
    );
  });
});

describe("gateSalePatchSchema", () => {
  it("takes any one patchable field", () => {
    for (const patch of [
      { amount: 45 },
      { paymentMethod: "card" as const },
      { contactId: sale.contactId },
      { membershipLevel: "student" as const },
      { note: "renewed at the door" },
      { note: null },
      { quantity: 3 },
    ]) {
      expect(gateSalePatchSchema.safeParse(patch).success).toBe(true);
    }
  });

  it("refuses an empty patch", () => {
    expect(gateSalePatchSchema.safeParse({}).success).toBe(false);
  });
});

const writerContactId = "22222222-2222-4222-8222-222222222222";

describe("gateCheckCreateSchema", () => {
  const line = { category: "merchandise" as const, amount: 25 };

  it("requires a writer and at least one line", () => {
    expect(gateCheckCreateSchema.safeParse({ writerContactId, lines: [line] }).success).toBe(true);
    expect(gateCheckCreateSchema.safeParse({ lines: [line] }).success).toBe(false);
    expect(gateCheckCreateSchema.safeParse({ writerContactId, lines: [] }).success).toBe(false);
  });

  // Research R17 (the P1 review): "How many?" is optional on admission, and any line may carry a
  // quantity — whole and above zero when given.
  it("takes an admission line with or without a count", () => {
    const admission = { category: "admission" as const, amount: 30 };
    for (const l of [admission, { ...admission, quantity: 2 }]) {
      expect(gateCheckCreateSchema.safeParse({ writerContactId, lines: [l] }).success).toBe(true);
    }
  });

  it("takes a quantity on any line, above zero", () => {
    expect(
      gateCheckCreateSchema.safeParse({ writerContactId, lines: [{ ...line, quantity: 2 }] })
        .success,
    ).toBe(true);
    for (const quantity of [0, -1, 1.5]) {
      expect(
        gateCheckCreateSchema.safeParse({ writerContactId, lines: [{ ...line, quantity }] })
          .success,
      ).toBe(false);
    }
  });

  it("keeps the named-category and membership rules on a line", () => {
    expect(
      gateCheckCreateSchema.safeParse({
        writerContactId,
        lines: [{ category: "donation", amount: 40 }],
      }).success,
    ).toBe(false);
    expect(
      gateCheckCreateSchema.safeParse({
        writerContactId,
        lines: [{ category: "membership", amount: 40, contactId: sale.contactId }],
      }).success,
    ).toBe(false);
  });

  it("takes notes and the deposit-separately mark", () => {
    const parsed = gateCheckCreateSchema.safeParse({
      writerContactId,
      note: "covers Jo too",
      depositSeparately: true,
      lines: [{ ...line, note: "T-shirt, L" }],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("gateCheckPatchSchema", () => {
  it("takes the writer, the note, the mark or a new set of lines", () => {
    for (const patch of [
      { writerContactId },
      { note: null },
      { depositSeparately: true },
      { lines: [{ category: "misc_sales" as const, amount: 5 }] },
    ]) {
      expect(gateCheckPatchSchema.safeParse(patch).success).toBe(true);
    }
    expect(gateCheckPatchSchema.safeParse({}).success).toBe(false);
    // Replacing the lines with none is a delete, not a patch (FR-017).
    expect(gateCheckPatchSchema.safeParse({ lines: [] }).success).toBe(false);
  });
});

describe("an anonymous sale, on its own (research R16)", () => {
  it("takes merchandise with a quantity and no one named", () => {
    expect(
      gateSaleCreateSchema.safeParse({
        category: "merchandise",
        paymentMethod: "cash",
        amount: 75,
        quantity: 3,
        note: "T-shirts",
      }).success,
    ).toBe(true);
  });

  it("refuses a quantity of zero", () => {
    expect(
      gateSaleCreateSchema.safeParse({
        category: "merchandise",
        paymentMethod: "cash",
        amount: 75,
        quantity: 0,
      }).success,
    ).toBe(false);
  });

  it("refuses a check as a sale's payment method — a check is recorded as a check", () => {
    expect(
      gateSaleCreateSchema.safeParse({
        category: "merchandise",
        paymentMethod: "check",
        amount: 25,
      }).success,
    ).toBe(false);
  });
});

describe("members named on a membership (quickstart §3.3)", () => {
  const members = ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];

  it("takes members on a membership sale and a check's membership line", () => {
    expect(
      gateSaleCreateSchema.safeParse({
        ...sale,
        category: "membership",
        membershipLevel: "family",
        memberContactIds: members,
      }).success,
    ).toBe(true);
    expect(
      gateCheckCreateSchema.safeParse({
        writerContactId,
        lines: [
          {
            category: "membership",
            amount: 60,
            contactId: writerContactId,
            membershipLevel: "family",
            memberContactIds: members,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("refuses members on anything but a membership", () => {
    expect(gateSaleCreateSchema.safeParse({ ...sale, memberContactIds: members }).success).toBe(
      false,
    );
  });
});

describe("doorRecordPatchSchema", () => {
  it("clears the payout reason with null (the walk-through found it could not be cleared)", () => {
    expect(doorRecordPatchSchema.safeParse({ cashPaidOutReason: null }).success).toBe(true);
    expect(doorRecordPatchSchema.safeParse({ cashPaidOutReason: "" }).success).toBe(false);
  });

  it("takes the evening's note and the cash count", () => {
    expect(doorRecordPatchSchema.safeParse({ eveningNote: "quiet night" }).success).toBe(true);
    expect(doorRecordPatchSchema.safeParse({ eveningNote: null }).success).toBe(true);
    expect(doorRecordPatchSchema.safeParse({ cashCount: { "100": 3, coins: 4.35 } }).success).toBe(
      true,
    );
    expect(doorRecordPatchSchema.safeParse({ cashCount: {} }).success).toBe(true);
    expect(doorRecordPatchSchema.safeParse({ cashCount: { "100": -1 } }).success).toBe(false);
  });
});
