import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Feature 090 (FR-001, research R1): volunteer pages show only the volunteer bar; public pages keep the
// public bar and, for a signed-in volunteer, the volunteer bar beneath it. The route groups are the line
// between the two, so each group's layout — not the root — decides which bars it renders.
const APP = join(__dirname, "..", "..", "src", "app");
const source = (file: string) => readFileSync(join(APP, file), "utf8");
const renders = (file: string, component: string) =>
  new RegExp(`<${component}\\s*/>`).test(source(file));

describe("which bars each part of the site renders (090)", () => {
  it("the root layout renders neither bar", () => {
    expect(renders("layout.tsx", "PublicNav")).toBe(false);
    expect(renders("layout.tsx", "Nav")).toBe(false);
  });

  it("the public pages render the public bar, then the volunteer bar", () => {
    const file = source("(public)/layout.tsx");
    expect(renders("(public)/layout.tsx", "PublicNav")).toBe(true);
    expect(renders("(public)/layout.tsx", "Nav")).toBe(true);
    expect(file.indexOf("<PublicNav")).toBeLessThan(file.indexOf("<Nav"));
  });

  it.each(["(admin)/layout.tsx", "(door)/layout.tsx", "dev/layout.tsx"])(
    "%s renders the volunteer bar and not the public bar",
    (file) => {
      expect(renders(file, "Nav")).toBe(true);
      expect(renders(file, "PublicNav")).toBe(false);
    },
  );
});
