import { describe, expect, it } from "vitest";
import type { Actor, Grant } from "@/server/auth/actor";
import { mySeries, organizerLandingKey } from "@/server/auth/mySeries";

const TNC = "11111111-1111-1111-1111-111111111111";
const ECD = "22222222-2222-2222-2222-222222222222";

function actor(...grants: Grant[]): Actor {
  return {
    staff: { identityId: "i", contactId: "c", displayName: "Pat", email: "pat@example.org" },
    grants,
  };
}

const SERIES = [
  { id: TNC, key: "tnc" },
  { id: ECD, key: "ecd" },
];

/** Feature 086's rule (FR-010, FR-012), lifted unchanged out of /api/me/capabilities by feature 090. */
describe("mySeries", () => {
  it("names every series any grant names", () => {
    expect(
      mySeries(
        actor(
          { role: "booker", seriesId: ECD, groupId: null },
          { role: "financial_secretary", seriesId: ECD, groupId: null },
        ),
      ),
    ).toEqual([ECD]);
  });

  it("names none for a club-wide grant — narrowing would be wrong", () => {
    expect(
      mySeries(
        actor(
          { role: "president", seriesId: null, groupId: null },
          { role: "booker", seriesId: ECD, groupId: null },
        ),
      ),
    ).toEqual([]);
  });

  it("names none for a volunteer with no grants", () => {
    expect(mySeries(actor())).toEqual([]);
  });
});

/** Feature 090 (FR-021, research R9): where "Organizer report" opens. */
describe("organizerLandingKey", () => {
  it("opens the volunteer's own series when their grants name exactly one", () => {
    expect(organizerLandingKey([ECD], SERIES)).toBe("ecd");
  });

  it("opens Thursday Night Contra otherwise — none, or several", () => {
    expect(organizerLandingKey([], SERIES)).toBe("tnc");
    expect(organizerLandingKey([TNC, ECD], SERIES)).toBe("tnc");
  });

  it("opens Thursday Night Contra if the one series is unknown", () => {
    expect(organizerLandingKey(["33333333-3333-3333-3333-333333333333"], SERIES)).toBe("tnc");
  });
});
