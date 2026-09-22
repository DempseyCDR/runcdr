import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeBand } from "./helpers/factories";
import { GET as SEARCH } from "@/app/api/bands/route";

// Feature 084 US2 (FR-005 to FR-007): the bands page is reached by searching, like the performers page and
// the contact directory before it. The endpoint gains a query and a truncation flag; what it answers with
// NO query is unchanged, because `bands/page.tsx` and the booking flows read that roster (analysis F1).

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

const search = async (query = "") =>
  (await SEARCH(jsonReq("GET", `/api/bands${query}`), ctx())).json();

describe("GET /api/bands", () => {
  it("matches the name case-insensitively, ordered by name", async () => {
    await makeBand("The Fiddleheads");
    await makeBand("Anfield Ramblers");
    await makeBand("Quiet Ensemble");

    await makeBand("Fiddle Faddle");
    const { items } = await search("?q=fiddle");
    const names = items.map((b: { name: string }) => b.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("The Fiddleheads");
    expect(names).toContain("Fiddle Faddle");
    expect(names).not.toContain("Anfield Ramblers");
  });

  it("says when more matched than it returned", async () => {
    for (let i = 0; i < 22; i++) await makeBand(`Ceilidh Band ${String(i).padStart(2, "0")}`);
    const { items, truncated } = await search("?q=ceilidh");
    expect(items).toHaveLength(20);
    expect(truncated).toBe(true);

    const few = await search("?q=ceilidh band 0");
    expect(few.truncated).toBe(false);
  });

  it("still returns the whole roster when no query is given (analysis F1)", async () => {
    await makeBand("Zephyr");
    await makeBand("Aurora");
    const { items } = await search();
    expect(items.map((b: { name: string }) => b.name)).toEqual(["Aurora", "Zephyr"]);
  });

  it("treats LIKE metacharacters as literals, not wildcards", async () => {
    await makeBand("The Fiddleheads");
    const { items } = await search("?q=%25");
    expect(items).toHaveLength(0);
  });
});
