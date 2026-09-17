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

  it("treats LIKE metacharacters as literals, not wildcards", async () => {
    await makePerformer("Bob Fabinski");
    // A bare '%' must not match everything (analyze L1).
    expect(await searchPerformers(db, "%")).toHaveLength(0);
  });
});
