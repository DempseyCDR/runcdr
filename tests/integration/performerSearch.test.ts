import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makePerformer } from "./helpers/factories";
import { createBooking } from "@/server/domain/bookings/bookingService";
import { searchPerformers } from "@/server/domain/performers/performerService";
import { GET as SEARCH } from "@/app/api/performers/route";

// Feature 020 US2 (FR-012): typeahead over performers by display name (ILIKE, ordered by display name).
describe("searchPerformers", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("matches display name case-insensitively, ordered by display name", async () => {
    await makePerformer("Bob Fabinski");
    await makePerformer("Ann Fabray");
    await makePerformer("Cara Jones");

    const hits = await searchPerformers(db, "fab");
    expect(hits.map((h) => h.displayName)).toEqual(["Ann Fabray", "Bob Fabinski"]);
  });

  it("browses all performers (ordered) on an empty query", async () => {
    await makePerformer("Zoe");
    await makePerformer("Amy");
    const hits = await searchPerformers(db, "");
    expect(hits.map((h) => h.displayName)).toEqual(["Amy", "Zoe"]);
  });

  // Feature 081 (FR-024): the Add dialog marks who is already booked on the evening.
  it("says who is already booked on an event, and only when asked about one", async () => {
    const evt = await makeEvent();
    const booked = await makePerformer("Bob Fabinski");
    await makePerformer("Ann Fabray");
    await createBooking(db, evt.id, { performerId: booked.id, performerType: "caller" });

    const res = await SEARCH(jsonReq("GET", `/api/performers?q=fab&eventId=${evt.id}`), ctx());
    const { items } = await res.json();
    expect(items).toEqual([
      { id: expect.any(String), displayName: "Ann Fabray", bookedAs: null },
      { id: booked.id, displayName: "Bob Fabinski", bookedAs: "caller" },
    ]);

    const plain = await (await SEARCH(jsonReq("GET", "/api/performers?q=fab"), ctx())).json();
    expect(plain.items.every((i: object) => !("bookedAs" in i))).toBe(true);
  });

  // Feature 084 US2 (FR-006, FR-007): the page needs to know when it is showing only part of the answer.
  it("says when more matched than it returned", async () => {
    for (let i = 0; i < 22; i++) await makePerformer(`Fiddler ${String(i).padStart(2, "0")}`);
    const res = await SEARCH(jsonReq("GET", "/api/performers?q=fiddler"), ctx());
    const { items, truncated } = await res.json();
    expect(items).toHaveLength(20);
    expect(truncated).toBe(true);
    expect(items.map((i: { displayName: string }) => i.displayName)).toEqual(
      [...items.map((i: { displayName: string }) => i.displayName)].sort(),
    );

    const few = await (await SEARCH(jsonReq("GET", "/api/performers?q=fiddler 0"), ctx())).json();
    expect(few.truncated).toBe(false);
  });

  // Feature 084 (analysis F1): three pages — bookings, bands and the bookings report — fetch the roster
  // with no query at all. FR-005 is a rule about the performers PAGE, not about this endpoint, so the
  // browse must keep working. This guards it.
  it("still browses the whole roster when no query is given", async () => {
    await makePerformer("Zoe");
    await makePerformer("Amy");
    const res = await SEARCH(jsonReq("GET", "/api/performers"), ctx());
    const { items } = await res.json();
    expect(items.map((i: { displayName: string }) => i.displayName)).toEqual(["Amy", "Zoe"]);
  });

  it("treats LIKE metacharacters as literals, not wildcards", async () => {
    await makePerformer("Bob Fabinski");
    // A bare '%' must not match everything (analyze L1).
    expect(await searchPerformers(db, "%")).toHaveLength(0);
  });
});
