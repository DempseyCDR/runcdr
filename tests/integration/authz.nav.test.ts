import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb } from "./helpers/db";
import { jsonReqAs, ctx } from "./helpers/http";
import { db } from "@/server/db/client";
import { roleGrants, series } from "@/server/db/schema";
import { makeActor, makeBaseActor } from "./helpers/factories";
import { navItemsFor } from "@/server/auth/nav";
import { loadActor } from "@/server/auth/actor";
import { readSession } from "@/server/auth/session";
import { apiInventory, uiInventory } from "@/server/lib/routeInventory";
import { POST as GRANT } from "@/app/api/access/grants/route";

/**
 * US5 — you see only what you may use (FR-039).
 *
 * Nav is derived from capabilities. It is a courtesy, not a control: a hidden destination is still
 * refused when requested directly (US5.3) — proven at the bottom.
 */

async function actorFromToken(token: string) {
  const staff = await readSession(db, token);
  if (!staff) throw new Error("no session");
  return loadActor(db, staff);
}

function hrefs(items: { href: string }[]): string[] {
  return items.map((i) => i.href);
}

describe("US5: role-aware navigation", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  // Feature 084 (FR-017): a venue's rents are managed on the venue, so the separate destination is gone.
  it("offers no venue-rents destination — rents live on the venue (FR-017)", async () => {
    const { token } = await makeActor({
      email: "booker@cdrochester.org",
      grants: [{ role: "booker" }],
    });
    const items = navItemsFor(await actorFromToken(token));
    expect(hrefs(items)).not.toContain("/venue-rents");
    // …while the venue itself, where they now live, is still offered.
    expect(hrefs(items)).toContain("/venues");
  });

  it("a Door Attendant sees check-in and reports, NOT gate/treasurer/access (US5.1)", async () => {
    const { token } = await makeActor({
      email: "door@cdrochester.org",
      grants: [{ role: "door_attendant" }],
    });
    const nav = hrefs(navItemsFor(await actorFromToken(token)));

    expect(nav).toContain("/checkin");
    expect(nav).toContain("/organizer/tnc"); // oversight is the base
    expect(nav).not.toContain("/gate");
    expect(nav).not.toContain("/treasurer");
    expect(nav).not.toContain("/access");
  });

  it("a Treasurer sees gate and treasurer (US5.2)", async () => {
    const { token } = await makeActor({
      email: "treas@cdrochester.org",
      grants: [{ role: "treasurer" }],
    });
    const nav = hrefs(navItemsFor(await actorFromToken(token)));

    expect(nav).toContain("/gate");
    expect(nav).toContain("/treasurer");
  });

  it("a President sees access control; a base-only volunteer does not", async () => {
    const { token: prez } = await makeActor({
      email: "prez@cdrochester.org",
      grants: [{ role: "president" }],
    });
    expect(hrefs(navItemsFor(await actorFromToken(prez)))).toContain("/access");

    const { token: base } = await makeBaseActor("base@cdrochester.org");
    const baseNav = hrefs(navItemsFor(await actorFromToken(base)));
    expect(baseNav).not.toContain("/access");
    // ...but the base still sees the oversight reports and the directory.
    expect(baseNav).toContain("/organizer/tnc");
    expect(baseNav).toContain("/contacts");
  });

  it("only a Super-user sees the dev route index", async () => {
    const { token: su } = await makeActor({
      email: "su@cdrochester.org",
      grants: [{ role: "super_user" }],
    });
    expect(hrefs(navItemsFor(await actorFromToken(su)))).toContain("/dev/routes");

    const { token: treas } = await makeActor({
      email: "t2@cdrochester.org",
      grants: [{ role: "treasurer" }],
    });
    expect(hrefs(navItemsFor(await actorFromToken(treas)))).not.toContain("/dev/routes");
  });

  it("a hidden destination is STILL refused when requested directly (US5.3, FR-039)", async () => {
    // A Door Attendant does not see /access in nav — and cannot reach its API either. Hiding is
    // presentation; the route enforces regardless.
    const { token } = await makeActor({
      email: "door2@cdrochester.org",
      grants: [{ role: "door_attendant" }],
    });
    const res = await GRANT(
      jsonReqAs(token, "POST", "/api/access/grants", {
        subjectContactId: "00000000-0000-0000-0000-000000000000",
        role: "booker",
        seriesKey: "ecd",
      }),
      ctx(),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toContain("role.assign");
  });

  it("the /dev/routes walker enumerates the real source tree, no hand-written list (FR-040a)", async () => {
    const api = apiInventory();
    const ui = uiInventory();

    // It found the actual API surface, including this feature's own routes — which nobody added to a
    // list. A new route file appears here automatically; that is the whole point.
    expect(api.length).toBeGreaterThan(30);
    expect(api.map((r) => r.path)).toContain("/api/access/grants");
    // Each endpoint carries its declared requirement, so the enforced matrix is inspectable.
    const grants = api.find((r) => r.path === "/api/access/grants");
    expect(grants?.methods.find((m) => m.method === "POST")?.requires).toBe("role.assign");

    // UI pages are enumerated too, with route-group folders stripped from the path.
    expect(ui.map((p) => p.path)).toContain("/access");
    expect(ui.map((p) => p.path).some((p) => p.includes("("))).toBe(false);
  });

  it("nav follows grants live — granting a role adds its destination on the next load", async () => {
    const ecd = (await db.query.series.findFirst({ where: eq(series.key, "ecd") }))!.id;
    const { contactId, token } = await makeBaseActor("grows@cdrochester.org");
    expect(hrefs(navItemsFor(await actorFromToken(token)))).not.toContain("/bookings");

    await db.insert(roleGrants).values({ contactId, role: "booker", seriesId: ecd });

    // No caching (FR-014): the fresh actor load reflects the new grant.
    expect(hrefs(navItemsFor(await actorFromToken(token)))).toContain("/bookings");
  });
});
