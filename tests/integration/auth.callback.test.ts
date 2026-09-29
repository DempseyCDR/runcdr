import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb } from "./helpers/db";
import { ctx } from "./helpers/http";
import { db } from "@/server/db/client";
import { staffSessions } from "@/server/db/schema";
import { GET as CALLBACK } from "@/app/api/auth/google/callback/route";
import { STATE_COOKIE, VERIFIER_COOKIE } from "@/server/auth/cookies";

/**
 * Contracts §2: the OAuth callback's CSRF defence.
 *
 * Every case here is refused BEFORE the authorization code is exchanged, so none of them contacts
 * Google — which is exactly why they are testable at all (constitution v1.2.0). If any of these ever
 * required network access, the ordering in the route has regressed.
 */
describe("OAuth callback state validation (CSRF)", () => {
  beforeAll(ensureSchema);
  let baselineSessions = 0;
  beforeEach(async () => {
    await resetDb();
    baselineSessions = (await db.select().from(staffSessions)).length;
  });
  afterAll(closeDb);

  function callbackReq(query: string, cookies: Record<string, string> = {}) {
    const cookie = Object.entries(cookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("; ");
    return new Request(`http://localhost:3000/api/auth/google/callback${query}`, {
      headers: cookie ? { cookie } : {},
    });
  }

  async function expectRefused(res: Response) {
    expect(res.status).toBe(307);
    // Relative, so the browser resolves it against the address it is on — localhost or a tunnel.
    expect(res.headers.get("location")).toBe("/login?error=access_denied");
    // No NEW session may be minted by a refusal. (The harness seeds one standing session of its
    // own for the rest of the suite, so count rather than assert emptiness.)
    expect(await db.select().from(staffSessions)).toHaveLength(baselineSessions);
  }

  it("refuses when state does not match the cookie", async () => {
    const res = await CALLBACK(
      callbackReq("?code=abc&state=forged", {
        [STATE_COOKIE]: "the-real-state",
        [VERIFIER_COOKIE]: "verifier",
      }),
      ctx(),
    );
    await expectRefused(res);
  });

  it("refuses when the flow cookies are absent entirely", async () => {
    const res = await CALLBACK(callbackReq("?code=abc&state=whatever"), ctx());
    await expectRefused(res);
  });

  it("refuses when the verifier cookie is missing", async () => {
    const res = await CALLBACK(callbackReq("?code=abc&state=s", { [STATE_COOKIE]: "s" }), ctx());
    await expectRefused(res);
  });

  it("refuses a callback with no code", async () => {
    const res = await CALLBACK(
      callbackReq("?state=s", { [STATE_COOKIE]: "s", [VERIFIER_COOKIE]: "v" }),
      ctx(),
    );
    await expectRefused(res);
  });

  it("refuses when Google reports an error (user declined consent)", async () => {
    const res = await CALLBACK(
      callbackReq("?error=access_denied", { [STATE_COOKIE]: "s", [VERIFIER_COOKIE]: "v" }),
      ctx(),
    );
    await expectRefused(res);
  });

  it("clears the one-shot flow cookies on refusal", async () => {
    const res = await CALLBACK(
      callbackReq("?code=abc&state=forged", { [STATE_COOKIE]: "real", [VERIFIER_COOKIE]: "v" }),
      ctx(),
    );
    const setCookies = res.headers.getSetCookie().join("\n");
    expect(setCookies).toContain(`${STATE_COOKIE}=`);
    expect(setCookies).toContain("Max-Age=0");
  });
});
