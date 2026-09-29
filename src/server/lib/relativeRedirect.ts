import { NextResponse } from "next/server";

/**
 * A redirect to a path on this site, sent as a RELATIVE `Location`.
 *
 * `NextResponse.redirect(new URL(path, req.url))` builds the address from the request as the server sees
 * it. Behind a tunnel (ngrok, for testing on a phone) the dev server sees `https://localhost:3000/…` — the
 * tunnel's protocol with its own host — and sent the browser to `https://localhost`, which speaks no HTTPS.
 * A relative `Location` is resolved by the browser against the address it is actually on, so the same
 * redirect is right on localhost, through a tunnel, and deployed.
 *
 * Only a same-site path is accepted (it starts with `/`, not `//`), so this can never send a browser to
 * another site.
 */
export function relativeRedirect(path: string, status = 307): NextResponse {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`relativeRedirect: not a path on this site: ${path}`);
  }
  return new NextResponse(null, { status, headers: { Location: path } });
}
