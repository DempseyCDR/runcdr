import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { eq, inArray } from "drizzle-orm";
import { contactEmails, contacts } from "@/server/db/schema";
import {
  contactRow,
  makeBaseActor,
  makeContactWithEmail,
  makeMembershipAccount,
} from "./helpers/factories";
import { GET as SUGGESTIONS } from "@/app/api/dedup/suggestions/route";
import { jsonReq, jsonReqAs, ctx } from "./helpers/http";
import {
  countMergeSuggestions,
  getMergeSuggestions,
  projectSuggestion,
} from "@/server/domain/dedup/suggestionService";
import { rejectPair } from "@/server/domain/dedup/rejectionService";
import { createContact } from "@/server/domain/contacts/contactService";
import { deriveContactNames } from "@/server/domain/contacts/normalize";

// File-level DB lifecycle (shared across the describes below — a single closeDb for the pool).
beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

// Feature 062 (M-R4): query-scoped duplicate suggestions — hybrid (scoped with a query, global when
// empty), still detected on the structured-name key so a display override can't mask a duplicate.
describe("getMergeSuggestions — query filter (feature 062)", () => {
  const pairNames = (pairs: { a: { displayName: string }; b: { displayName: string } }[]) =>
    pairs.map((p) => [p.a.displayName, p.b.displayName].sort().join(" / ")).sort();

  it("with a query, returns ONLY pairs where a member matches (C1); empty query is global (C2)", async () => {
    await db
      .insert(contacts)
      .values([
        contactRow("Jon Smith"),
        contactRow("John Smith"),
        contactRow("Zelda Fitzgerald"),
        contactRow("Zelda Fitzgerold"),
      ]);

    const scoped = await getMergeSuggestions(db, 0.4, 50, "smith");
    expect(pairNames(scoped)).toEqual(["John Smith / Jon Smith"]);

    const global = await getMergeSuggestions(db, 0.4, 50);
    expect(pairNames(global)).toEqual([
      "John Smith / Jon Smith",
      "Zelda Fitzgerald / Zelda Fitzgerold",
    ]);
  });

  it("surfaces a duplicate hidden by a display-name override (C3)", async () => {
    await createContact(db, { firstName: "David", lastName: "Jones", displayNameOverride: "DJ" });
    await createContact(db, { firstName: "David", lastName: "Jones" });
    // Searching the real name finds the pair even though one is displayed as "DJ".
    const scoped = await getMergeSuggestions(db, 0.4, 50, "david");
    expect(scoped.length).toBe(1);
    const names = [scoped[0]!.a.displayName, scoped[0]!.b.displayName].sort();
    expect(names).toEqual(["DJ", "David Jones"]);
  });
});

// FR-010
describe("GET /api/dedup/suggestions", () => {
  async function seed(name: string) {
    await db.insert(contacts).values(contactRow(name));
  }

  it("surfaces similar-name pairs with a similarity score", async () => {
    await seed("Jon Smith");
    await seed("John Smith");
    await seed("Zelda Fitzgerald");

    const res = await SUGGESTIONS(jsonReq("GET", "/api/dedup/suggestions"), ctx());
    const body = await res.json();
    expect(body.pairs.length).toBeGreaterThanOrEqual(1);
    const pair = body.pairs[0];
    const names = [pair.a.displayName, pair.b.displayName].sort();
    expect(names).toEqual(["John Smith", "Jon Smith"]);
    expect(pair.similarity).toBeGreaterThan(0.4);
  });
});

// Feature 069 (FR-001): the row must carry enough to decide WITHOUT opening either record. Record age is
// the common tell for a duplicate created by a later import; shared-household facts are evidence AGAINST a
// merge (two real people, one address or one account) and did not exist when this projection was written.
describe("the candidate projection carries the deciding facts (feature 069)", () => {
  it("carries record age and membership standing", async () => {
    const a = await createContact(db, { firstName: "Robert", lastName: "Jones" });
    await createContact(db, { firstName: "Rob", lastName: "Jones" });
    await makeMembershipAccount({
      payerContactId: a.id,
      level: "family",
      expiryDate: "2099-08-31",
    });

    const [pair] = await getMergeSuggestions(db);
    const robert = [pair!.a, pair!.b].find((c) => c.id === a.id)!;
    expect(robert.createdAt).toBeTruthy();
    expect(robert.updatedAt).toBeTruthy();
    expect(robert.membershipLevel).toBe("family");
  });

  it("reports a shared household — same membership account (068)", async () => {
    const payer = await createContact(db, { firstName: "Pat", lastName: "Payer" });
    const a = await createContact(db, { firstName: "Chris", lastName: "Jones" });
    const b = await createContact(db, { firstName: "Cris", lastName: "Jones" });
    await makeMembershipAccount({
      payerContactId: payer.id,
      level: "family",
      expiryDate: "2099-08-31",
      members: [a.id, b.id],
    });

    const pair = (await getMergeSuggestions(db)).find(
      (p) => [p.a.id, p.b.id].includes(a.id) && [p.a.id, p.b.id].includes(b.id),
    );
    expect(pair?.sharedHousehold.account).toBe(true);
    expect(pair?.sharedHousehold.email).toBe(false);
  });

  it("reports a shared household — both reached at the same address (067)", async () => {
    const owner = await makeContactWithEmail({
      firstName: "Cindy",
      lastName: "Culbert",
      email: "culberts@example.com",
    });
    const a = await createContact(db, { firstName: "Abby", lastName: "Culbert" });
    const b = await createContact(db, { firstName: "Abbie", lastName: "Culbert" });
    await db
      .update(contacts)
      .set({ messageRecipientEmailId: owner.emailId })
      .where(inArray(contacts.id, [a.id, b.id]));

    const pair = (await getMergeSuggestions(db)).find(
      (p) => [p.a.id, p.b.id].includes(a.id) && [p.a.id, p.b.id].includes(b.id),
    );
    expect(pair?.sharedHousehold.email).toBe(true);
  });

  it("does NOT propose a pair on a matching email or phone — name similarity alone", async () => {
    await makeContactWithEmail({
      firstName: "Wendy",
      lastName: "Alpha",
      email: "shared@example.com",
      phone: "+15855550100",
    });
    const b = await createContact(db, { firstName: "Gareth", lastName: "Omega" });
    await db.update(contacts).set({ phone: "+15855550100" }).where(eq(contacts.id, b.id));

    expect(await getMergeSuggestions(db)).toEqual([]);
  });
});

// Feature 069 (FR-005/FR-006). A pair's two answers are OPPOSITES, so they are blocked by different
// things. Rejecting says "different people" and is undermined only by an address the row is not showing.
// Merging says "one person", retires a contact and picks winners — so it is blocked by anything that
// makes the pair look like two people, and by any collision the row cannot resolve.
describe("what a row may resolve in place (feature 069)", () => {
  const find = async (aId: string, bId: string) =>
    (await getMergeSuggestions(db)).find(
      (p) => [p.a.id, p.b.id].includes(aId) && [p.a.id, p.b.id].includes(bId),
    );

  it("offers both answers on a plain pair whose every relevant fact is on the row", async () => {
    const a = await createContact(db, { firstName: "Nora", lastName: "Quinn" });
    const b = await createContact(db, { firstName: "Norah", lastName: "Quinn" });
    const pair = await find(a.id, b.id);
    expect(pair?.safeToReject).toBe(true);
    expect(pair?.safeToMerge).toBe(true);
  });

  it("blocks BOTH when either contact holds an address the row does not show", async () => {
    const a = await makeContactWithEmail({
      firstName: "Sam",
      lastName: "Reed",
      email: "sam@example.com",
    });
    const b = await createContact(db, { firstName: "Samuel", lastName: "Reed" });
    expect((await find(a.contactId, b.id))?.safeToReject).toBe(true);

    // A retired address is real evidence about this contact, and may be the very thing that would have
    // shown these to be the same person — so neither answer can be given from the row.
    await db
      .update(contactEmails)
      .set({ status: "inactive" })
      .where(eq(contactEmails.id, a.emailId));
    const pair = await find(a.contactId, b.id);
    expect(pair?.safeToReject).toBe(false);
    expect(pair?.safeToMerge).toBe(false);
  });

  it("blocks only MERGING when both contacts sign in — the choice is not the row's to make", async () => {
    const a = await makeContactWithEmail({
      firstName: "Terry",
      lastName: "Vale",
      email: "terry@example.com",
    });
    const b = await makeContactWithEmail({
      firstName: "Terri",
      lastName: "Vale",
      email: "terri@example.com",
    });
    await db
      .update(contactEmails)
      .set({ isLogin: true })
      .where(inArray(contactEmails.id, [a.emailId, b.emailId]));
    const pair = await find(a.contactId, b.contactId);
    expect(pair?.a.hasLogin && pair?.b.hasLogin).toBe(true);
    expect(pair?.safeToMerge).toBe(false);
    // Nothing about two sign-ins says these are one person, so saying they are two is still safe.
    expect(pair?.safeToReject).toBe(true);
  });

  it("a CONFLICT blocks merging and ARGUES FOR rejecting — it must never block it", async () => {
    const a = await makeContactWithEmail({
      firstName: "Wren",
      lastName: "Ash",
      email: "wren@example.com",
      phone: "+15855550111",
    });
    const b = await makeContactWithEmail({
      firstName: "Wrenn",
      lastName: "Ash",
      email: "wrenn@example.com",
      phone: "+15855550222",
    });
    const pair = await find(a.contactId, b.contactId);
    // Two different phone numbers are the strongest evidence a row can carry that these are two people.
    expect(pair?.safeToMerge).toBe(false);
    expect(pair?.safeToReject).toBe(true);
  });

  it("two membership accounts likewise block merging, not rejecting", async () => {
    const a = await createContact(db, { firstName: "Pat", lastName: "Payer" });
    const b = await createContact(db, { firstName: "Patricia", lastName: "Payer" });
    await makeMembershipAccount({ payerContactId: a.id, expiryDate: "2099-08-31" });
    await makeMembershipAccount({ payerContactId: b.id, expiryDate: "2098-08-31" });
    const pair = await find(a.id, b.id);
    expect(pair?.safeToMerge).toBe(false);
    expect(pair?.safeToReject).toBe(true);
  });
});

// Feature 069: a contact reached ONLY through a household address (067) must not render as "No email" —
// that reads as a sparse record when it is evidence of a distinct person.
describe("the row shows a ridden household address (feature 069)", () => {
  it("names the owner and the address the contact is reached at", async () => {
    const owner = await makeContactWithEmail({
      firstName: "Cindy",
      lastName: "Culbert",
      email: "culberts@example.com",
    });
    const rider = await createContact(db, { firstName: "Abby", lastName: "Culbert" });
    await createContact(db, { firstName: "Abbie", lastName: "Culbert" });
    await db
      .update(contacts)
      .set({ messageRecipientEmailId: owner.emailId })
      .where(eq(contacts.id, rider.id));

    const pair = (await getMergeSuggestions(db)).find((p) => [p.a.id, p.b.id].includes(rider.id));
    const side = [pair!.a, pair!.b].find((c) => c.id === rider.id)!;
    expect(side.emails).toEqual([]);
    expect(side.messageRecipient?.ownerDisplayName).toBe("Cindy Culbert");
    expect(side.messageRecipient?.address).toBe("culberts@example.com");
  });
});

// Feature 016 (FR-016) — this route is `base`, and every candidate carries a phone, addresses, and now
// the household address a contact rides. A volunteer without `contact.pii.read` must get none of it.
describe("the suggestions payload withholds PII from a reader who may not have it", () => {
  it("strips reach, keeps the owner's name, and says the row cannot be resolved in place", async () => {
    const owner = await makeContactWithEmail({
      firstName: "Cindy",
      lastName: "Culbert",
      email: "culberts@example.com",
      phone: "+15855550100",
    });
    const rider = await createContact(db, { firstName: "Abby", lastName: "Culbert" });
    await createContact(db, { firstName: "Abbie", lastName: "Culbert" });
    await db
      .update(contacts)
      .set({ messageRecipientEmailId: owner.emailId })
      .where(eq(contacts.id, rider.id));

    const base = await makeBaseActor("plain-volunteer@example.com");
    const res = await SUGGESTIONS(jsonReqAs(base.token, "GET", "/api/dedup/suggestions"), ctx());
    const { pairs } = await res.json();
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      for (const side of [p.a, p.b]) {
        expect(side.phone).toBeNull();
        expect(side.emails).toEqual([]);
        expect(side.messageRecipient?.address ?? null).toBeNull();
      }
      expect(p.safeToReject).toBe(false);
      expect(p.safeToMerge).toBe(false);
    }
    // The owner's NAME survives — it discloses nothing this reader could not already look up.
    const withRider = pairs.find((p: { a: { id: string }; b: { id: string } }) =>
      [p.a.id, p.b.id].includes(rider.id),
    );
    const side = [withRider.a, withRider.b].find((c: { id: string }) => c.id === rider.id);
    expect(side.messageRecipient?.ownerDisplayName).toBe("Cindy Culbert");
  });
});

/**
 * Feature 069 regression. The queue was silently capped at 50 rows while the launcher badge counted every
 * pair, so the button promised a number the list could not show. Revealing rejected pairs made it actively
 * harmful: the extra rows competed for the same 50 slots, so "show rejected" could push a pair OFF the
 * list — the exact opposite of what the control is for (FR-004a).
 */
describe("the queue does not silently drop pairs (feature 069)", () => {
  async function manyPairs(n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = await createContact(db, { firstName: `Rebecca${i}`, lastName: "Ward" });
      const b = await createContact(db, { firstName: `Rebecca${i}`, lastName: "Warde" });
      ids.push(a.id, b.id);
    }
    return ids;
  }

  it("reports truncation instead of quietly shortening the list", async () => {
    await manyPairs(3);
    const res = await SUGGESTIONS(jsonReq("GET", "/api/dedup/suggestions?limit=2"), ctx());
    const body = await res.json();
    expect(body.pairs.length).toBe(2);
    expect(body.truncated).toBe(true);
  });

  it("REVEALING rejected pairs never removes one that was already visible", async () => {
    const a = await createContact(db, { firstName: "Carol", lastName: "Johnson" });
    const b = await createContact(db, { firstName: "Rob", lastName: "Johnson" });
    await manyPairs(3);

    const visible = async (includeRejected: boolean) => {
      const res = await SUGGESTIONS(
        jsonReq("GET", `/api/dedup/suggestions${includeRejected ? "?includeRejected=1" : ""}`),
        ctx(),
      );
      return (await res.json()).pairs as { a: { id: string }; b: { id: string } }[];
    };
    const has = (rows: Awaited<ReturnType<typeof visible>>) =>
      rows.some((p) => [p.a.id, p.b.id].includes(a.id) && [p.a.id, p.b.id].includes(b.id));

    expect(has(await visible(false))).toBe(true);
    await rejectPair(db, a.id, b.id, (await makeBaseActor("mel2@example.com")).contactId);
    // Hidden by default …
    expect(has(await visible(false))).toBe(false);
    // … and findable again on request, which is the whole point of the control.
    expect(has(await visible(true))).toBe(true);
  });

  it("the launcher count never promises more than the queue can show", async () => {
    await manyPairs(4);
    const res = await SUGGESTIONS(jsonReq("GET", "/api/dedup/suggestions"), ctx());
    const body = await res.json();
    expect(body.truncated).toBe(false);
    expect(body.pairs.length).toBe(await countMergeSuggestions(db));
  });
});

/**
 * Feature 076 (069 manual pass). A custom display name can hide the name the pair was actually proposed
 * on: pairing runs on first + last, but the row showed only the display name. So the pair carries the
 * structured names, and the row shows them whenever the display name is custom.
 */
describe("the pair carries each contact's structured names (076)", () => {
  const named = (
    firstName: string,
    lastName: string | null,
    displayNameOverride: string | null,
  ) => ({
    firstName,
    lastName,
    displayNameOverride,
    ...deriveContactNames({ firstName, lastName, displayNameOverride }),
  });

  it("returns first name, last name and the display-name override for both sides", async () => {
    await db
      .insert(contacts)
      .values([named("Peggy", "Dempsey", "Peggy CDR"), named("Peggy", "Dempsey", null)]);

    const [pair] = await getMergeSuggestions(db, 0.4, 50);
    expect(pair, "the two Peggy Dempseys were not proposed as a pair").toBeDefined();
    const sides = [pair!.a, pair!.b];
    const custom = sides.find((c) => c.displayNameOverride !== null)!;
    const automatic = sides.find((c) => c.displayNameOverride === null)!;

    expect(custom).toMatchObject({
      displayName: "Peggy CDR",
      firstName: "Peggy",
      lastName: "Dempsey",
      displayNameOverride: "Peggy CDR",
    });
    expect(automatic).toMatchObject({
      displayName: "Peggy Dempsey",
      firstName: "Peggy",
      lastName: "Dempsey",
      displayNameOverride: null,
    });
  });

  it("keeps the names when contact details are projected away for a base reader", async () => {
    // Names are not PII here — only reach (emails, phone) is withheld — so projection must keep them,
    // or a reader without contact access would see the custom display name with nothing beneath it.
    await db
      .insert(contacts)
      .values([named("Peggy", "Dempsey", "Peggy CDR"), named("Peggy", "Dempsey", null)]);
    const [pair] = await getMergeSuggestions(db, 0.4, 50);

    const projected = projectSuggestion(pair!, false);
    const custom = [projected.a, projected.b].find((c) => c.displayNameOverride !== null)!;
    expect(custom.emails, "projection should still withhold reach").toEqual([]);
    expect(custom).toMatchObject({ firstName: "Peggy", lastName: "Dempsey" });
  });
});
