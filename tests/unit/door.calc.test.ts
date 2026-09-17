import { describe, expect, it } from "vitest";
import { posFeeCents, depositCents } from "@/server/domain/door/calc";

// FR-007, FR-008 — exact integer-cent math.
describe("posFeeCents", () => {
  it("= $0.09 per transaction + 2.29% of gross", () => {
    // 10 txns = 90c; 2.29% of $100.00 (10000c) = 229c → 319c
    expect(posFeeCents(10, 10000)).toBe(319);
  });
  it("zero when no activity", () => {
    expect(posFeeCents(0, 0)).toBe(0);
  });
});

describe("depositCents", () => {
  it("= gross cash − seed float − cash paid out", () => {
    expect(depositCents(20000, 1500, 2500)).toBe(16000);
  });
  // Feature 081 (FR-033): cash paid to performers comes out of the takings too.
  it("also takes off the cash paid to performers", () => {
    expect(depositCents(30000, 1500, 2000, 3000)).toBe(23500);
  });
});
