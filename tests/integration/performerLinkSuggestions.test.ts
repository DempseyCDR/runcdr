import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { contactRow } from "./helpers/factories";
import { contacts, performers } from "@/server/db/schema";
import { GET as SUGGESTIONS } from "@/app/api/performers/[id]/link-suggestions/route";

// Feature 084 US4 (FR-021, FR-022): a performer with no contact is settled when it is opened, and the
// suggestion must survive a MISSPELLING. The live case, found in the development database: the performer
// "Clara Reidlinger" and the contact "Clara Riedlinger" — one person, two spellings, never linked,
// because `matchPerformers` compares normalized names for exact equality (research R5).

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

async function aContact(displayName: string, over: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(contacts)
    .values({ ...contactRow(displayName), ...over })
    .returning();
  return row!;
}

/**
 * A performer with no contact — the state this story exists to settle. Inserted directly, as the 19 live
 * ones are: they predate the rule that a new performer must have a contact, so nothing auto-created one.
 * (Going through `createPerformer` would make a contact of the same name, which would then match itself.)
 */
async function anUnlinkedPerformer(displayName: string) {
  const [row] = await db.insert(performers).values({ displayName }).returning();
  return row!;
}

const suggest = async (id: string) =>
  (await SUGGESTIONS(jsonReq("GET", `/api/performers/${id}/link-suggestions`), ctx({ id }))).json();

describe("contact suggestions for an unlinked performer", () => {
  it("offers the right contact first despite transposed letters (research R5)", async () => {
    await aContact("Clara Riedlinger");
    await aContact("Barbara Clarke");
    await aContact("Joe Clark");
    const performer = await anUnlinkedPerformer("Clara Reidlinger");

    const { items } = await suggest(performer.id);
    expect(items[0].displayName).toBe("Clara Riedlinger");
    expect(items[0].similarity).toBeGreaterThan(0.5);
  });

  it("offers an exact match too — the easy case still works", async () => {
    await aContact("Pat Caller");
    const performer = await anUnlinkedPerformer("Pat Caller");
    const { items } = await suggest(performer.id);
    expect(items[0].displayName).toBe("Pat Caller");
  });

  it("never offers a merged or archived contact", async () => {
    const survivor = await aContact("Clara Riedlinger");
    await aContact("Clara Riedlinger", { mergedIntoId: survivor.id });
    await aContact("Clara Riedlingerr", { archivedAt: new Date() });
    const performer = await anUnlinkedPerformer("Clara Reidlinger");

    const { items } = await suggest(performer.id);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(survivor.id);
  });

  it("answers with nobody when no one is close — a touring musician nobody has on file", async () => {
    await aContact("Pat Caller");
    const performer = await anUnlinkedPerformer("Ezekiel Fotheringham-Blythe");
    const { items } = await suggest(performer.id);
    expect(items).toEqual([]);
  });
});
