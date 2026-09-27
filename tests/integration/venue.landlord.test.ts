import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { contacts, series, venues } from "@/server/db/schema";
import { jsonReqAs, ctx } from "./helpers/http";
import { makeActor, makeBaseActor, makeContactWithEmail } from "./helpers/factories";
import { GET as GET_ONE } from "@/app/api/venues/[id]/route";
import { GET as MAILTO } from "@/app/api/venues/[id]/landlord-mailto/route";
import { createVenue, patchVenue } from "@/server/domain/venues/venueService";
import { createContact } from "@/server/domain/contacts/contactService";

// Feature 018 (B22): a venue can name/clear an optional landlord contact; the link degrades gracefully.
describe("venue landlord contact", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("sets and clears the landlord", async () => {
    const venue = await createVenue(db, { name: "Hall", address: "1 Main St" });
    const landlord = await createContact(db, { firstName: "Larry", lastName: "Landlord" });

    const set = await patchVenue(db, venue.id, { landlordContactId: landlord.id });
    expect(set.landlordContactId).toBe(landlord.id);

    const cleared = await patchVenue(db, venue.id, { landlordContactId: null });
    expect(cleared.landlordContactId).toBeNull();
  });

  it("nulls the link when the landlord contact is deleted (ON DELETE SET NULL)", async () => {
    const venue = await createVenue(db, { name: "Hall", address: "1 Main St" });
    const landlord = await createContact(db, { firstName: "Larry", lastName: "Landlord" });
    await patchVenue(db, venue.id, { landlordContactId: landlord.id });

    await db.delete(contacts).where(eq(contacts.id, landlord.id));

    const row = await db.query.venues.findFirst({ where: eq(venues.id, venue.id) });
    expect(row?.landlordContactId).toBeNull();
  });

  // Feature 087 walk-through: the form said "set" because the venue read never carried the landlord's
  // name. The name is a display name, readable by any volunteer, as a performer's contact name is.
  it("names the landlord on the venue read (087)", async () => {
    const venue = await createVenue(db, { name: "Hall", address: "1 Main St" });
    const landlord = await createContact(db, { firstName: "Larry", lastName: "Landlord" });
    await patchVenue(db, venue.id, { landlordContactId: landlord.id });
    const base = await makeBaseActor("base.landlord@example.com");

    const res = await GET_ONE(
      jsonReqAs(base.token, "GET", `/api/venues/${venue.id}`),
      ctx({ id: venue.id }),
    );
    expect((await res.json()).landlordName).toBe("Larry Landlord");
  });

  // The ADDRESS is PII, so it is its own read behind contact.pii.read — as a performer's mailto is.
  it("gives the landlord's address to a PII holder only (087)", async () => {
    const venue = await createVenue(db, { name: "Hall", address: "1 Main St" });
    const { contactId } = await makeContactWithEmail({
      firstName: "Larry",
      lastName: "Landlord",
      email: "larry@example.org",
    });
    await patchVenue(db, venue.id, { landlordContactId: contactId });
    const tnc = await db.query.series.findFirst({ where: eq(series.key, "tnc") });
    const booker = await makeActor({
      email: "booker.landlord@example.com",
      grants: [{ role: "booker", seriesId: tnc!.id }],
    });
    const base = await makeBaseActor("base.mailto@example.com");
    const ask = (token: string) =>
      MAILTO(
        jsonReqAs(token, "GET", `/api/venues/${venue.id}/landlord-mailto`),
        ctx({ id: venue.id }),
      );

    const ok = await ask(booker.token);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ email: "larry@example.org" });
    expect((await ask(base.token)).status).toBe(403);
  });

  it("answers no address for a venue with no landlord (087)", async () => {
    const venue = await createVenue(db, { name: "Hall", address: "1 Main St" });
    const { token } = await makeActor({
      email: "super.landlord@example.com",
      grants: [{ role: "super_user" }],
    });
    const res = await MAILTO(
      jsonReqAs(token, "GET", `/api/venues/${venue.id}/landlord-mailto`),
      ctx({ id: venue.id }),
    );
    expect(await res.json()).toEqual({ email: null });
  });
});
