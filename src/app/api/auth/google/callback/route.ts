import { NextResponse } from "next/server";
import { withLogging } from "@/server/lib/withLogging";
import { db } from "@/server/db/client";
import { logger } from "@/server/lib/logger";
import { verifyGoogleIdToken } from "@/server/auth/claims";
import { exchangeCodeForIdToken } from "@/server/auth/google";
import { resolveSignIn } from "@/server/auth/signIn";
import { createSession, SESSION_COOKIE } from "@/server/auth/session";
import { safeNextPath } from "@/server/auth/redirect";
import {
  NEXT_COOKIE,
  STATE_COOKIE,
  VERIFIER_COOKIE,
  clearCookie,
  readCookie,
  serializeCookie,
} from "@/server/auth/cookies";
import { oauthCallbackSchema } from "@/server/validation/auth";
import { writeAudit } from "@/server/lib/audit";
import { relativeRedirect } from "@/server/lib/relativeRedirect";

/**
 * Finish Google sign-in (contracts §2).
 *
 * EVERY failure returns the same generic outcome (FR-009). Distinguishing "not a volunteer" from
 * "no such contact" would let any Google user probe club membership; the specific reason is logged
 * server-side only.
 *
 * Order matters: `state` is validated BEFORE the code is exchanged, so a forged callback costs no
 * outbound request — and makes the CSRF path testable without contacting Google.
 */

function refuse(reason: string): NextResponse {
  logger.warn({ reason }, "auth: sign-in refused");
  writeAudit({ kind: "auth.signin.refused", actor: null, details: { reason } });
  const res = relativeRedirect("/login?error=access_denied");
  // Never leave the one-shot flow cookies lying around.
  for (const c of [STATE_COOKIE, VERIFIER_COOKIE, NEXT_COOKIE]) {
    res.headers.append("Set-Cookie", clearCookie(c));
  }
  return res;
}

export const GET = withLogging(async (req) => {
  const url = new URL(req.url);

  // The user declined at Google's consent screen, or Google reported a problem.
  if (url.searchParams.get("error")) return refuse("provider_error");

  const parsed = oauthCallbackSchema.safeParse({
    code: url.searchParams.get("code") ?? "",
    state: url.searchParams.get("state") ?? "",
  });
  if (!parsed.success) return refuse("malformed_callback");

  // CSRF: the state we minted must come back unchanged. Checked before any network call.
  const expectedState = readCookie(req, STATE_COOKIE);
  const codeVerifier = readCookie(req, VERIFIER_COOKIE);
  if (!expectedState || !codeVerifier) return refuse("missing_flow_cookies");
  if (parsed.data.state !== expectedState) return refuse("state_mismatch");

  // The only outbound call to Google in the feature.
  let idToken: string;
  try {
    idToken = await exchangeCodeForIdToken(parsed.data.code, codeVerifier);
  } catch {
    return refuse("code_exchange_failed");
  }

  const claims = await verifyGoogleIdToken(idToken);
  if (!claims.ok) return refuse(claims.reason);

  const result = await resolveSignIn(db, claims.claims);
  if (!result.ok) return refuse(result.reason);

  const { token, expiresAt } = await createSession(db, result.identityId);
  const next = safeNextPath(readCookie(req, NEXT_COOKIE));

  const res = relativeRedirect(next);
  res.headers.append("Set-Cookie", serializeCookie(SESSION_COOKIE, token, { expires: expiresAt }));
  for (const c of [STATE_COOKIE, VERIFIER_COOKIE, NEXT_COOKIE]) {
    res.headers.append("Set-Cookie", clearCookie(c));
  }
  return res;
});
