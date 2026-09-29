import { describe, it, expect } from "vitest";
import { relativeRedirect } from "@/server/lib/relativeRedirect";

// Dev tunnel: behind ngrok the dev server sees its own request as https://localhost:3000/…, so a redirect
// built from that address sent the browser to https://localhost — which speaks no HTTPS. A relative
// Location is resolved by the browser against the address it is actually on: the tunnel's, or localhost.
describe("relativeRedirect", () => {
  it("redirects to a path on this site, relative, with the status given", () => {
    const res = relativeRedirect("/bookings?x=1", 303);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/bookings?x=1");
  });

  it("defaults to 307, as NextResponse.redirect did", () => {
    expect(relativeRedirect("/").status).toBe(307);
  });

  it("refuses anything that is not a path on this site", () => {
    expect(() => relativeRedirect("https://evil.example/")).toThrow();
    expect(() => relativeRedirect("//evil.example/")).toThrow();
    expect(() => relativeRedirect("bookings")).toThrow();
  });
});
