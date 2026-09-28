import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Feature 088 (research R5, SC-006): nothing in the running system may still match on the community
// dance's old key. A map that misses a series fails the type check (R1), but a comparison such as
// `key === "community_dance"` would still compile — and silently never match. This catches that class.
//
// Migrations are exempt: they record what was true when they ran, and 0060 must name the old key to
// rename it.
const ROOT = join(__dirname, "..", "..", "src");
const EXEMPT = join(ROOT, "server", "db", "migrations");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (path === EXEMPT) return [];
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("the community dance's old key (088)", () => {
  it("appears nowhere in the source outside the migrations", () => {
    const offenders = files(ROOT)
      .filter((f) => readFileSync(f, "utf8").includes("community_dance"))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
