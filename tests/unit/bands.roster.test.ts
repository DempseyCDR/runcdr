import { describe, expect, it } from "vitest";
import { bandCreateSchema } from "@/server/validation/bands";

const uuid = "00000000-0000-0000-0000-000000000001";
const uuid2 = "00000000-0000-0000-0000-000000000002";

describe("band roster validation", () => {
  it("accepts a roster with exactly one lead", () => {
    const r = bandCreateSchema.safeParse({
      name: "The Reels",
      members: [
        { performerId: uuid, isLead: true },
        { performerId: uuid2, isLead: false },
      ],
    });
    expect(r.success).toBe(true);
  });

  // Feature 087 (FR-022, FR-023): a lead is optional. Removing the lead leaves a band with no lead,
  // stated plainly — the alternative, forcing a lead on save, would name someone the Booker did not pick.
  it("accepts a roster with no lead", () => {
    const r = bandCreateSchema.safeParse({
      name: "The Reels",
      members: [{ performerId: uuid, isLead: false }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a roster with two leads", () => {
    const r = bandCreateSchema.safeParse({
      name: "The Reels",
      members: [
        { performerId: uuid, isLead: true },
        { performerId: uuid2, isLead: true },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty roster", () => {
    const r = bandCreateSchema.safeParse({ name: "The Reels", members: [] });
    expect(r.success).toBe(false);
  });
});
