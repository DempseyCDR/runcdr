import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureSchema, resetDb, closeDb, db } from "./helpers/db";
import { makeEvent } from "./helpers/factories";
import { events } from "@/server/db/schema";
import {
  getPublicEventDetail,
  getPublicHistory,
  getPublicSchedule,
} from "@/server/domain/public/publicSchedule";

/**
 * Feature 087 (FR-016): the Booker's note never reaches the public site.
 *
 * `events.description` is the dance's PUBLIC blurb; `events.note` is the Booker's private scheduling
 * note ("Chuck can't do Thursdays — try Dave first"). Keeping them apart is the ONLY reason the note has
 * a column of its own. The public reads use explicit projections today, so nothing leaks yet — which is
 * why these cases pass on first run. They are a GUARD over behaviour that already holds, not a red-first
 * test of new behaviour: their job is to fail the day someone widens a projection or reaches for
 * `select()`.
 */
describe("the public event reads", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  const SECRET = "Chuck can't do Thursdays - try Dave first";

  async function aDanceWithBoth(eventDate: string) {
    const ev = await makeEvent({ seriesKey: "tnc", eventDate });
    await db
      .update(events)
      .set({ description: "A friendly contra dance", note: SECRET })
      .where(eq(events.id, ev.id));
    return ev.id;
  }

  // The schedule and history lists carry neither the blurb nor the note — only the detail view shows a
  // blurb. So here the guard is simply that the note is absent, from the shape and from the text.
  it("never carry the Booker's note — schedule and history", async () => {
    await aDanceWithBoth("2026-06-18");
    await aDanceWithBoth("2026-01-10");

    for (const items of [
      await getPublicSchedule(db, "2026-01-01"),
      await getPublicHistory(db, "2027-01-01"),
    ]) {
      expect(items.length).toBeGreaterThan(0);
      expect(JSON.stringify(items)).not.toContain(SECRET);
      for (const item of items) expect(item).not.toHaveProperty("note");
    }
  });

  it("carries the public blurb and never the Booker's note — one dance's detail", async () => {
    const id = await aDanceWithBoth("2026-06-18");
    const detail = await getPublicEventDetail(db, id);

    expect(detail?.description).toBe("A friendly contra dance");
    expect(detail).not.toHaveProperty("note");
    expect(JSON.stringify(detail)).not.toContain(SECRET);
  });
});
