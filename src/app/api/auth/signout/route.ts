import { withLogging } from "@/server/lib/withLogging";
import { db } from "@/server/db/client";
import { destroySession, SESSION_COOKIE } from "@/server/auth/session";
import { clearCookie, readCookie } from "@/server/auth/cookies";
import { relativeRedirect } from "@/server/lib/relativeRedirect";

/**
 * End the session (contracts §3, FR-002).
 *
 * POST only — a GET sign-out is CSRF-triggerable and can be fired by a prefetch or an <img> tag.
 */
export const POST = withLogging(async (req) => {
  await destroySession(db, readCookie(req, SESSION_COOKIE));
  const res = relativeRedirect("/", 303);
  res.headers.append("Set-Cookie", clearCookie(SESSION_COOKIE));
  return res;
});
