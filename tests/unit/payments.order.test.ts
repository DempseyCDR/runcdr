import { describe, expect, it } from "vitest";
import { compareCheckNumbers, orderBookings } from "@/server/domain/payments/order";

/** Feature 081 (FR-003, FR-039): the order performers and checks are listed in. */
describe("payment ordering (081)", () => {
  it("lists caller, lead musician, musician, sound tech, then the rest — by name within a role", () => {
    const rows = [
      { performerType: "open_band_musician", performerName: "Olive" },
      { performerType: "musician", performerName: "zed" },
      { performerType: "instructor", performerName: "Ivy" },
      { performerType: "sound_tech", performerName: "Sam" },
      { performerType: "musician", performerName: "Abe" },
      { performerType: "caller", performerName: "Cal" },
      { performerType: "lead_musician", performerName: "Lee" },
    ] as const;
    expect(orderBookings(rows).map((r) => r.performerName)).toEqual([
      "Cal",
      "Lee",
      "Abe",
      "zed",
      "Sam",
      "Ivy",
      "Olive",
    ]);
  });

  it("does not reorder its input", () => {
    const rows = [
      { performerType: "musician", performerName: "B" },
      { performerType: "caller", performerName: "A" },
    ];
    orderBookings(rows);
    expect(rows[0]!.performerName).toBe("B");
  });

  it("sorts check numbers by their digits, then their letter", () => {
    expect(["1501", "1500B", "999", "1500", "1500A"].sort(compareCheckNumbers)).toEqual([
      "999",
      "1500",
      "1500A",
      "1500B",
      "1501",
    ]);
  });
});
