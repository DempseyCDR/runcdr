import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Feature 089 (FR-006, SC-002): the volunteer pages use exactly one dialog. Four shells grew up one
// feature at a time — each closing, scrolling and sizing itself a little differently — and a fifth
// would start the drift again. Only the shared shell may declare itself a dialog.
const APP = join(__dirname, "..", "..", "src", "app");
const SHELL = join(APP, "_components", "Dialog.tsx");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("one dialog (089)", () => {
  it('has role="dialog" only in the shared shell', () => {
    const offenders = files(APP)
      .filter((f) => f !== SHELL && /\.tsx?$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes('role="dialog"'))
      .map((f) => relative(APP, f));
    expect(offenders).toEqual([]);
  });
});
