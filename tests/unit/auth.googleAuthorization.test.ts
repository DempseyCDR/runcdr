import { describe, expect, it } from "vitest";

/**
 * Feature 083 (B53): the authorization request asks Google to let the person CHOOSE an account.
 *
 * Without `prompt=select_account`, Google silently returns whichever account it already holds a session
 * for — so signing out of the club's app and back in lands on the same volunteer. That defeats the door
 * hand-over (US2) and switching roles (US3), which is what B53 was raised for.
 *
 * This builds the URL locally — `arctic` composes it with no network call — so nothing here talks to
 * Google. The token seam stays where the constitution put it (`claims.ts`).
 */
describe("beginAuthorization", () => {
  it("asks Google for the account chooser, with the scopes we need", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/auth/google/callback";

    const { beginAuthorization } = await import("@/server/auth/google");
    const { url, state, codeVerifier } = beginAuthorization();

    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(["openid", "email"]);
    // The security-critical parts arctic gives us are untouched by the addition.
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(codeVerifier).toBeTruthy();
  });
});
