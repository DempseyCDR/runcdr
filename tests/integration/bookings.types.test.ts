import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { ensureSchema, resetDb, closeDb } from "./helpers/db";
import { jsonReq, ctx } from "./helpers/http";
import { makeEvent, makePerformer } from "./helpers/factories";
import { POST as BOOK } from "@/app/api/events/[id]/bookings/route";

// FR-001/002/003/005
describe("booking type rules", () => {
  beforeAll(ensureSchema);
  beforeEach(resetDb);
  afterAll(closeDb);

  async function book(eventId: string, performerType: string, extra: object = {}) {
    const p = await makePerformer(`${performerType} performer`);
    const res = await BOOK(
      jsonReq("POST", `/api/events/${eventId}/bookings`, {
        performerId: p.id,
        performerType,
        ...extra,
      }),
      ctx({ id: eventId }),
    );
    return res;
  }

  // Feature 081 (FR-009): no longer forced to $0 — free unless given a pay, then payable.
  it("books Instructor and Open Band free by default, and payable when given a pay", async () => {
    const evt = await makeEvent();
    const free = await (await book(evt.id, "instructor", {})).json();
    expect(free.payCents).toBe(0);
    expect(free.requiresCheck).toBe(false);

    const instr = await (await book(evt.id, "instructor", { pay: 100 })).json();
    expect(instr.payCents).toBe(10000);
    expect(instr.requiresCheck).toBe(true);

    const open = await (await book(evt.id, "open_band_musician", { pay: 50 })).json();
    expect(open.payCents).toBe(5000);
    expect(open.requiresCheck).toBe(true);
  });

  it("makes a paid Caller require a check", async () => {
    const evt = await makeEvent();
    const res = await book(evt.id, "caller", { pay: 150 });
    const b = await res.json();
    expect(b.payCents).toBe(15000);
    expect(b.requiresCheck).toBe(true);
  });
});
