import { describe, expect, it } from "vitest";
import { landingAfterSignIn, safeNextPath } from "@/server/auth/redirect";

/**
 * Contracts §1: the `?next=` open-redirect guard.
 *
 * `next` survives the round trip to Google and back, so an unchecked value would let a crafted
 * sign-in link bounce a freshly authenticated officer to an attacker's site.
 */
describe("safeNextPath (open-redirect guard)", () => {
  it("honours a plain relative path", () => {
    expect(safeNextPath("/gate")).toBe("/gate");
    expect(safeNextPath("/organizer/ecd?q=1")).toBe("/organizer/ecd?q=1");
  });

  it("falls back for absent or empty values", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });

  it.each([
    ["https://evil.com/steal", "absolute https"],
    ["http://evil.com", "absolute http"],
    ["//evil.com", "protocol-relative"],
    ["/\\evil.com", "backslash protocol-relative"],
    ["\\\\evil.com", "UNC-style"],
    ["javascript:alert(1)", "javascript scheme"],
    ["data:text/html,<script>", "data scheme"],
    ["gate", "not absolute"],
    ["/gate\nSet-Cookie: x=y", "header injection via newline"],
    ["/gate\r\nLocation: https://evil.com", "CRLF injection"],
  ])("refuses %s (%s)", (input) => {
    expect(safeNextPath(input)).toBe("/");
  });

  it("uses the supplied fallback", () => {
    expect(safeNextPath("https://evil.com", "/login")).toBe("/login");
  });
});

/** Feature 090 (FR-015, research R7): where a volunteer lands after signing in. */
describe("landingAfterSignIn (090)", () => {
  it("lands on the volunteer home page when no page was asked for", () => {
    expect(landingAfterSignIn(undefined)).toBe("/volunteer");
    expect(landingAfterSignIn("")).toBe("/volunteer");
  });

  // Found in the browser (2026-09-30): the sign-in start filled in "/" when no page was asked for, so the
  // callback honoured it and landed on the public home. The public home is never a volunteer's destination.
  it("treats the public home as no page asked for", () => {
    expect(landingAfterSignIn("/")).toBe("/volunteer");
  });

  it("returns to the volunteer page the sign-in started from", () => {
    expect(landingAfterSignIn("/payments")).toBe("/payments");
  });

  it("never follows an unsafe next — it lands on the volunteer home page instead", () => {
    expect(landingAfterSignIn("https://evil.com")).toBe("/volunteer");
  });
});
