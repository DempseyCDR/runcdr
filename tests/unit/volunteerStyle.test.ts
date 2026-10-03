import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Feature 089 (contracts/style-tokens.md): the conventions of the converted volunteer pages, held in
// the CSS itself. jsdom has no layout, so a size cannot be measured in a component test; what can be
// checked is that every minimum is the one token, so that the token is the only place the size lives.
//
// A later conversion (the frame, Booking Central's cards) adds its files here — that is how "converted"
// is recorded.
const APP = join(__dirname, "..", "..", "src", "app");
const CONVERTED = [
  "_components/ActionBar.module.css",
  "_components/AttendanceBreakdownView.module.css",
  "_components/ContactName.module.css",
  "_components/Dialog.module.css",
  "_components/EventConfirm.module.css",
  "_components/PaymentSummaryView.module.css",
  "EventSelector.module.css",
  "VolunteerNav.module.css",
  "(admin)/volunteer/volunteer.module.css",
  "login/login.module.css",
  "_components/PrintBar.module.css",
  "(admin)/organizer/[seriesKey]/organizer.module.css",
  "_components/SaleOrCheckDialog.module.css",
  "(door)/checkin/checkin.module.css",
  "(door)/gate/gate.module.css",
  "(admin)/payments/payments.module.css",
  "(admin)/treasurer/treasurer.module.css",
  // Feature 091: Booking Central, the first page converted after the frame.
  "(admin)/bookings/hub.module.css",
];

/** Every `property: value` declaration in a stylesheet, comments removed. */
function declarations(css: string): { property: string; value: string }[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...bare.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].map((m) => ({
    property: m[1] ?? "",
    value: (m[2] ?? "").trim(),
  }));
}

const MINIMUMS = new Set(["min-height", "min-width", "min-block-size", "min-inline-size"]);

/** Every `@media` condition in a stylesheet, comments removed. */
function mediaQueries(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...bare.matchAll(/@media\s+([^{]+)\{/g)].map((m) => (m[1] ?? "").trim());
}

/** The stylesheet with its `@media print` block taken out: paper is not a screen to read on. */
function withoutPrint(css: string): string {
  const start = css.indexOf("@media print");
  if (start < 0) return css;
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(0, start) + css.slice(i + 1);
  }
  return css.slice(0, start);
}

const WIDTHS = new Set(["(min-width: 40rem)", "(min-width: 48rem)", "print"]);

/** A font size under 16px: below 1rem or 16px, or the small-print token. */
function small(value: string): boolean {
  if (value.includes("var(--fs-sm)")) return true;
  const rem = /^([\d.]+)rem$/.exec(value);
  if (rem) return Number(rem[1]) < 1;
  const px = /^([\d.]+)px$/.exec(value);
  if (px) return Number(px[1]) < 16;
  return false;
}

describe("the converted volunteer pages' styles (089)", () => {
  it.each(CONVERTED)("%s exists", (file) => {
    expect(existsSync(join(APP, file))).toBe(true);
  });

  it.each(CONVERTED)(
    "%s sizes every control with the one tap minimum, var(--tap-min) (FR-004, rule 1)",
    (file) => {
      const offenders = declarations(readFileSync(join(APP, file), "utf8"))
        .filter((d) => MINIMUMS.has(d.property))
        // A screen height (`100dvh`) sizes a region, not a control.
        .filter(
          (d) => d.value !== "0" && !d.value.includes("var(--tap-min)") && !/v[hw]$/.test(d.value),
        )
        .map((d) => `${d.property}: ${d.value}`);
      expect(offenders).toEqual([]);
    },
  );

  it.each(CONVERTED)(
    "%s changes layout only at the two named widths, 40rem and 48rem (FR-020, rule 2)",
    (file) => {
      const offenders = mediaQueries(readFileSync(join(APP, file), "utf8")).filter(
        (q) => !WIDTHS.has(q),
      );
      expect(offenders).toEqual([]);
    },
  );

  it.each(CONVERTED)("%s holds no text under 16px (FR-022, rule 3)", (file) => {
    const css = withoutPrint(readFileSync(join(APP, file), "utf8"));
    const offenders = declarations(css)
      .filter((d) => d.property === "font-size" && small(d.value))
      .map((d) => `font-size: ${d.value}`);
    expect(offenders).toEqual([]);
  });
});
