import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, testSessionToken } from "./helpers/db";
import { makeActor } from "./helpers/factories";
import { SESSION_COOKIE } from "@/server/auth/session";
import * as signoutRoute from "@/app/api/auth/signout/route";
import { GET as CAPABILITIES } from "@/app/api/me/capabilities/route";

// Feature 083 (B53): the control added to the volunteer menu calls this route, which feature 015 built and
// this feature does not change. These are the promises the menu's Sign out button rests on.

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

const ctx = () => ({ params: Promise.resolve({}) });
const cookie = (token: string) => `${SESSION_COOKIE}=${encodeURIComponent(token)}`;

/** A sign-out, as the menu's form submits it: a POST carrying whatever session cookie the device holds. */
function signOut(token?: string): Promise<Response> {
  return signoutRoute.POST(
    new Request("http://localhost/api/auth/signout", {
      method: "POST",
      ...(token ? { headers: { cookie: cookie(token) } } : {}),
    }),
    ctx(),
  );
}

/** Something that needs a session, to ask whether one still works. */
const whoAmI = (token: string) =>
  CAPABILITIES(
    new Request("http://localhost/api/me/capabilities", { headers: { cookie: cookie(token) } }),
    ctx(),
  );

describe("POST /api/auth/signout", () => {
  it("ends the session and sends the volunteer to the public home page (FR-002, FR-003)", async () => {
    const token = testSessionToken();
    expect((await whoAmI(token)).status).toBe(200);

    const res = await signOut(token);
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/");
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);

    // The cookie the device still holds is now worthless.
    expect((await whoAmI(token)).status).toBe(401);
  });

  it("signs out again, and with no session at all, without complaint (FR-002)", async () => {
    const token = testSessionToken();
    await signOut(token);
    expect((await signOut(token)).status).toBe(303);
    expect((await signOut()).status).toBe(303);
  });

  it("leaves every other volunteer signed in (FR-008, SC-005)", async () => {
    const meg = await makeActor({
      email: "meg.door@example.org",
      firstName: "Meg",
      lastName: "Door",
      grants: [{ role: "door_attendant" }],
    });
    await signOut(testSessionToken());
    expect((await whoAmI(meg.token)).status).toBe(200);
  });

  it("offers no GET — a prefetch or an <img> must not sign anyone out (FR-006)", () => {
    expect("GET" in signoutRoute).toBe(false);
  });
});
