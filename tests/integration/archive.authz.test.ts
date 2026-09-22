import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReqAs, ctx } from "./helpers/http";
import { makeActor, makePerformer } from "./helpers/factories";
import { venues } from "@/server/db/schema";
import { POST as ARCHIVE_VENUE } from "@/app/api/venues/[id]/archive/route";
import { POST as RESTORE_VENUE } from "@/app/api/venues/[id]/restore/route";
import { POST as ARCHIVE_PERFORMER } from "@/app/api/performers/[id]/archive/route";
import { POST as RESTORE_PERFORMER } from "@/app/api/performers/[id]/restore/route";
import { POST as RESTORE_BAND } from "@/app/api/bands/[id]/restore/route";

// Feature 084 (analysis C1): retiring a record is an editor's act. A volunteer who may not edit a venue
// or a performer may not archive or restore one either — the routes say so, not the buttons.

beforeAll(ensureSchema);
beforeEach(resetDb);
afterAll(closeDb);

/** A door attendant: a real volunteer, holding neither `venue.write` nor `performer.write`. */
const aDoorAttendant = () =>
  makeActor({
    email: "meg.door@example.org",
    firstName: "Meg",
    lastName: "Door",
    grants: [{ role: "door_attendant" }],
  });

describe("who may retire a record", () => {
  it("refuses a volunteer without venue.write", async () => {
    const [venue] = await db
      .insert(venues)
      .values({ name: "Grange Hall", address: "1 Main" })
      .returning();
    const { token } = await aDoorAttendant();

    for (const route of [ARCHIVE_VENUE, RESTORE_VENUE]) {
      const res = await route(
        jsonReqAs(token, "POST", `/api/venues/${venue!.id}/x`, { confirm: true }),
        ctx({ id: venue!.id }),
      );
      expect(res.status).toBe(403);
    }
  });

  it("refuses a volunteer without performer.write", async () => {
    const pat = await makePerformer("Pat Caller");
    const { token } = await aDoorAttendant();

    for (const route of [ARCHIVE_PERFORMER, RESTORE_PERFORMER, RESTORE_BAND]) {
      const res = await route(
        jsonReqAs(token, "POST", `/api/performers/${pat.id}/x`, { confirm: true }),
        ctx({ id: pat.id }),
      );
      expect(res.status).toBe(403);
    }
  });
});
