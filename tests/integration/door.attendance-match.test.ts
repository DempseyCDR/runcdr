import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { contactRow, makeEvent } from "./helpers/factories";
import { attendance, contacts, events } from "@/server/db/schema";
import { recordAttendance } from "@/server/domain/attendance/attendanceService";
import { eq } from "drizzle-orm";
import { POST as CREATE_CONTACT } from "@/app/api/contacts/route";
import { POST as ATTEND } from "@/app/api/events/[id]/attendance/route";

// FR-001, FR-010 (attendance attaches to event, no door record needed)
describe("POST /api/events/:id/attendance (existing contact)", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  it("records attendance against the event and rejects duplicates", async () => {
    const evt = await makeEvent();
    const cRes = await CREATE_CONTACT(
      jsonReq("POST", "/api/contacts", {
        firstName: "Grace Hopper",
        email: { address: "grace@example.com" },
      }),
      ctx(),
    );
    const contactId = (await cRes.json()).id as string;

    const first = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, { contactId }),
      ctx({ id: evt.id }),
    );
    expect(first.status).toBe(201);

    const dup = await ATTEND(
      jsonReq("POST", `/api/events/${evt.id}/attendance`, { contactId }),
      ctx({ id: evt.id }),
    );
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe("ALREADY_CHECKED_IN");
  });

  /**
   * Feature 079 (research R12): two attendants checking the same dancer in at the same moment. Both can pass
   * the "already in?" check before either inserts; the database's unique index then refuses the second, and
   * that refusal must reach the attendant as ALREADY_CHECKED_IN — not a raw database error.
   */
  it("refuses a racing second check-in as ALREADY_CHECKED_IN, never a raw database error", async () => {
    const evt = await makeEvent();
    const [c] = await db.insert(contacts).values(contactRow("Rae Racer")).returning();

    // Deterministic race: another attendant's check-in is inserted but not yet committed, so this one's
    // "already in?" check cannot see it — and its own insert waits on the unique index until that commits.
    let second: Promise<unknown> | undefined;
    await db.transaction(async (tx) => {
      await tx.insert(attendance).values({ eventId: evt.id, contactId: c!.id });
      second = recordAttendance(db, evt.id, { contactId: c!.id });
      second.catch(() => {}); // observed below, after the first attendant commits
      await new Promise((r) => setTimeout(r, 300));
    });

    await expect(second).rejects.toMatchObject({ code: "ALREADY_CHECKED_IN" });
    const rows = await db.select().from(attendance).where(eq(attendance.eventId, evt.id));
    expect(rows).toHaveLength(1);
    const [after] = await db.select().from(events).where(eq(events.id, evt.id));
    expect(after!.attendanceCount, "a refused check-in still counted a head").toBe(0);
  });
});
