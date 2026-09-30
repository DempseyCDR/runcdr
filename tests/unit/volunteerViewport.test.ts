import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The volunteer layouts check the session before rendering; importing them only reads their exports.
vi.mock("@/server/auth/currentStaff", () => ({ requireStaff: async () => ({}) }));

/**
 * Feature 089 (research R8): the volunteer pages ask Android to shrink the page when the keyboard opens,
 * so a pinned action bar rises above the keyboard instead of hiding under it, and to extend under the
 * iPhone's home indicator, so the bar can pad itself clear of it. The public site is left as it is.
 */
describe("the volunteer pages' viewport (089)", () => {
  it.each([
    ["(admin)", () => import("@/app/(admin)/layout")],
    ["(door)", () => import("@/app/(door)/layout")],
  ])("the %s layout resizes for the keyboard and covers the home indicator", async (_, load) => {
    const { viewport } = await load();
    expect(viewport).toEqual({ interactiveWidget: "resizes-content", viewportFit: "cover" });
  });

  it("the root layout — and so the public site — sets no viewport of its own", () => {
    // Read, not imported: the root layout loads its fonts through next/font, which only runs in Next.
    const root = readFileSync(join(__dirname, "..", "..", "src", "app", "layout.tsx"), "utf8");
    expect(root).not.toMatch(/export\s+(const|function)\s+(viewport|generateViewport)\b/);
  });
});
