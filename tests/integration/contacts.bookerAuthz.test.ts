import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb } from "./helpers/db";
import { jsonReqAs, ctx } from "./helpers/http";
import { makeActor } from "./helpers/factories";
import { POST as CREATE_CONTACT } from "@/app/api/contacts/route";
import { PATCH as PATCH_CONTACT, DELETE as DELETE_CONTACT } from "@/app/api/contacts/[id]/route";

/**
 * Feature 086 US1 (FR-001, FR-002): the Booker settles an unlinked performer.
 *
 * Feature 084 gave the Booker a question — link this performer to someone, create a contact for them,
 * or archive it — and the middle answer posts a contact. The Booker did not hold `contact.write`, so a
 * flow built for them refused them. The Door Attendant and the Financial Secretary both already held
 * it; the Booker was the odd one out.
 *
 * The second half matters as much: writing is not destroying. `contact.delete` is a different
 * capability and the Booker still does not hold it.
 */
describe("the Booker and the contact directory", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function aBooker() {
    const { token } = await makeActor({
      email: "booker.contacts@cdrochester.org",
      grants: [{ role: "booker" }],
    });
    return token;
  }

  it("creates the contact a performer needs (FR-001)", async () => {
    const token = await aBooker();

    const res = await CREATE_CONTACT(
      jsonReqAs(token, "POST", "/api/contacts", {
        firstName: "Touring",
        lastName: "Fiddler",
      }),
      ctx(),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.displayName).toBe("Touring Fiddler");
  });

  it("corrects a contact's details (FR-001)", async () => {
    const token = await aBooker();
    const created = await CREATE_CONTACT(
      jsonReqAs(token, "POST", "/api/contacts", { firstName: "Clara", lastName: "Reidlinger" }),
      ctx(),
    );
    const { id } = await created.json();

    const res = await PATCH_CONTACT(
      jsonReqAs(token, "PATCH", `/api/contacts/${id}`, { lastName: "Riedlinger" }),
      ctx({ id }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).displayName).toBe("Clara Riedlinger");
  });

  it("is still REFUSED the deletion of one (FR-002)", async () => {
    const token = await aBooker();
    const created = await CREATE_CONTACT(
      jsonReqAs(token, "POST", "/api/contacts", { firstName: "Delete", lastName: "Me" }),
      ctx(),
    );
    const { id } = await created.json();

    const res = await DELETE_CONTACT(
      jsonReqAs(token, "DELETE", `/api/contacts/${id}`),
      ctx({ id }),
    );

    expect(res.status).toBe(403);
  });
});
