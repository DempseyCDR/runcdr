import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Feature 090 (FR-023, research R10): PrintBar's print rules hide the whole page, then reveal the
 * report. Both are `!important`, so the one with the higher specificity wins — the reveal must.
 *
 * Found in Rich's print preview from desktop Chrome: the page was blank. The hide rule had been scoped
 * as `body:has([data-printable-report]) *`, and `:has()` counts its argument, so it outranked the
 * reveal `[data-printable-report] *` and hid the report too. (jsdom does not apply print media or this
 * cascade, so the stylesheet is read and the specificities compared directly.)
 */
const css = readFileSync(join(process.cwd(), "src/app/_components/PrintBar.module.css"), "utf8");

/** [ids, classes/attributes/pseudo-classes, elements] — enough of the rules for these selectors. */
type Spec = [number, number, number];
function specificity(selector: string): Spec {
  let s = selector;
  const total: Spec = [0, 0, 0];
  const add = ([a, b, c]: Spec) => {
    total[0] += a;
    total[1] += b;
    total[2] += c;
  };
  // :where() counts nothing; :is(), :has() and :not() count their argument.
  s = s.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, " ");
  s = s.replace(/:(?:is|has|not)\(((?:[^()]|\([^()]*\))*)\)/g, (_, arg: string) => {
    add(specificity(arg));
    return " ";
  });
  total[0] += (s.match(/#[\w-]+/g) ?? []).length;
  total[1] += (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  total[2] += (s.replace(/\[[^\]]*\]/g, " ").match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return total;
}
const outranks = ([a0, a1, a2]: Spec, [b0, b1, b2]: Spec) =>
  a0 !== b0 ? a0 > b0 : a1 !== b1 ? a1 > b1 : a2 > b2;

/** The selectors (outside `:global(...)`) of every rule in the print block that sets `visibility`. */
function visibilityRules(value: "hidden" | "visible"): string[] {
  const print = css.slice(css.indexOf("@media print"));
  const rules = [...print.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selectors = "", body = ""]) => ({
      selectors,
      body,
    }),
  );
  return rules
    .filter(({ body }) => new RegExp(`visibility:\\s*${value}`).test(body))
    .flatMap(({ selectors }) =>
      selectors
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(/,(?![^(]*\))/)
        .map((sel) => sel.trim().replace(/^:global\(([\s\S]*)\)$/, "$1")),
    );
}

describe("PrintBar's print rules (090)", () => {
  it("checks its own specificity arithmetic", () => {
    expect(specificity("body:has([data-printable-report]) *")).toEqual([0, 1, 1]);
    expect(specificity("[data-printable-report] *")).toEqual([0, 1, 0]);
    expect(specificity(":where(body:has([data-printable-report])) *")).toEqual([0, 0, 0]);
  });

  it("reveals the report over the rule that hides the page, so the printout is not blank", () => {
    const hide = visibilityRules("hidden");
    const reveal = visibilityRules("visible");
    expect(hide.length).toBeGreaterThan(0);
    expect(reveal).toEqual(
      expect.arrayContaining(["[data-printable-report]", "[data-printable-report] *"]),
    );
    for (const h of hide) {
      for (const r of reveal) {
        expect(outranks(specificity(h), specificity(r)), `"${h}" outranks "${r}"`).toBe(false);
      }
    }
  });
});
