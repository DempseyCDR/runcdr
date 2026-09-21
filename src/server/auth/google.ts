import { Google, generateCodeVerifier, generateState } from "arctic";
import { getAuthEnv } from "@/server/validation/env";

/**
 * The Google OAuth client (feature 015).
 *
 * `arctic` handles the security-critical dance — state, PKCE, and the code→token exchange — without
 * imposing any data model of its own. We keep our own sessions and bind to our own `contacts`.
 *
 * Lazy: constructing this needs OAuth config the test suite deliberately does not have. Tests never
 * reach this module — they verify locally signed tokens at the `claims.ts` seam instead
 * (constitution v1.2.0).
 */

let client: Google | null = null;

function googleClient(): Google {
  if (!client) {
    const env = getAuthEnv();
    client = new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
  }
  return client;
}

/** Only what we need: OIDC identity plus the email we match to a volunteer contact. */
const SCOPES = ["openid", "email"];

export type Authorization = { url: URL; state: string; codeVerifier: string };

/**
 * Start the authorization-code flow. Caller must persist `state` + `codeVerifier` in cookies.
 *
 * Feature 083 (B53): `prompt=select_account` makes Google ASK which account to use. Without it Google
 * silently returns whichever account it still holds a session for — our sign-out ends the club's session,
 * not Google's — so the next volunteer at a shared door phone would be signed in as the last one, and
 * nobody could sign in as a different role to check what that role sees.
 */
export function beginAuthorization(): Authorization {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = googleClient().createAuthorizationURL(state, codeVerifier, SCOPES);
  url.searchParams.set("prompt", "select_account");
  return { url, state, codeVerifier };
}

/**
 * Exchange the authorization code for tokens and return the raw ID token.
 *
 * The ONLY outbound call to Google in the whole feature. Its result goes straight to
 * `verifyGoogleIdToken`; nothing here is trusted until that verifies it.
 */
export async function exchangeCodeForIdToken(code: string, codeVerifier: string): Promise<string> {
  const tokens = await googleClient().validateAuthorizationCode(code, codeVerifier);
  return tokens.idToken();
}
