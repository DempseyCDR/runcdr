import { eq } from "drizzle-orm";
import type { Db, DbOrTx } from "@/server/db/client";
import { contacts, gateChecks, gateSales } from "@/server/db/schema";
import { errors } from "@/server/lib/apiError";
import { actorCan } from "@/server/auth/can";
import type { Actor } from "@/server/auth/actor";
import { recordAudit } from "@/server/lib/audit";
import { dollarsToCents } from "@/server/lib/money";
import type {
  GateCheckCreateInput,
  GateCheckLineInput,
  GateCheckPatchInput,
} from "@/server/validation/door";
import { enrollDoorMemberships, refreshDeposit, type DoorEnrollment } from "./doorRecordService";
import {
  assertMayCorrect,
  assertMayRecord,
  checkViews,
  doorRecordScope,
  type GateCheckView,
} from "./gateSaleService";

/**
 * Feature 082 (research R1, FR-014–FR-023): a check handed in at the door.
 *
 * A check is a small `gate_checks` row — its writer, its note, whether it is banked on its own — and its
 * lines are ordinary gate sales paid by check, so every reader of gate sales (the money, the membership
 * enrolment, the reports) understands them without being taught a second kind of line. Its amount is the
 * sum of its lines and is never stored. Each check is recorded, corrected and removed on its own; the
 * gate's Save never touches it (FR-023).
 */

const CHECK_VIOLATION = "23514";

/**
 * Analysis D2: the service checks a line before writing it, but two writes can still meet at the database,
 * whose constraints (migration 0053) then refuse. This turns that refusal into the code the pre-check would
 * have given, so a race reads the same as a mistake. Anything else passes through untouched.
 */
export function explainCheckViolation(err: unknown): unknown {
  const pg = (err as { cause?: unknown }).cause ?? err;
  const { code, constraint_name: constraint } = pg as { code?: string; constraint_name?: string };
  if (code !== CHECK_VIOLATION || !constraint?.startsWith("gate_sales_")) return err;
  if (constraint === "gate_sales_admission_on_check") return errors.admissionNeedsCheck();
  return errors.validation("A check's lines are paid by check, and only a check's lines are.");
}

async function rethrowExplained<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    throw explainCheckViolation(e);
  }
}

async function assertContact(db: DbOrTx, contactId: string): Promise<void> {
  const found = await db.query.contacts.findFirst({ where: eq(contacts.id, contactId) });
  if (!found) throw errors.contactNotFound();
}

/**
 * FR-021: only someone who may record gate money marks a check to be banked on its own. The door's dialog
 * never offers it; a request that sets it anyway is refused, never silently ignored (contracts/gate.md).
 */
function assertMayMark(
  actor: Actor | undefined,
  scope: { seriesId: string; groupId: string | null },
) {
  if (actor && !actorCan(actor, "gate.write", scope)) throw errors.unauthorized("gate.write");
}

async function checkView(
  db: DbOrTx,
  doorRecordId: string,
  checkId: string,
): Promise<GateCheckView> {
  const view = (await checkViews(db, doorRecordId)).find((c) => c.id === checkId);
  if (!view) throw errors.validation("That check no longer exists.");
  return view;
}

/**
 * Write a check's lines as gate sales, paid by check. A membership is always the payer's — the check's
 * writer owns the account and is a member of it; anyone else it covers is named as a member (§3.3).
 */
async function writeLines(
  tx: DbOrTx,
  doorRecordId: string,
  checkId: string,
  writerContactId: string,
  lines: GateCheckLineInput[],
  recordedBy: string | null,
) {
  return tx
    .insert(gateSales)
    .values(
      lines.map((l) => ({
        doorRecordId,
        checkId,
        category: l.category,
        paymentMethod: "check" as const,
        amountCents: dollarsToCents(l.amount),
        contactId: l.category === "membership" ? writerContactId : (l.contactId ?? null),
        membershipLevel: l.membershipLevel ?? null,
        quantity: l.quantity ?? null,
        note: blankToNull(l.note),
        recordedByContactId: recordedBy,
      })),
    )
    .returning();
}

/** The members each line names, in the lines' order — `writeLines` returns its rows in that order. */
const members = (lines: GateCheckLineInput[]) => lines.map((l) => l.memberContactIds);

export async function createGateCheck(
  db: Db,
  doorRecordId: string,
  input: GateCheckCreateInput,
  actor?: Actor,
): Promise<{ check: GateCheckView; enrolled: DoorEnrollment[] }> {
  const { eventId, scope } = await doorRecordScope(db, doorRecordId);
  assertMayRecord(actor, scope);
  if (input.depositSeparately) assertMayMark(actor, scope);
  if (input.lines.length === 0) throw errors.checkNeedsLines();
  await assertContact(db, input.writerContactId);

  const actorId = actor?.staff.contactId ?? null;
  return rethrowExplained(() =>
    db.transaction(async (tx) => {
      const [check] = await tx
        .insert(gateChecks)
        .values({
          doorRecordId,
          writerContactId: input.writerContactId,
          note: blankToNull(input.note),
          depositSeparately: input.depositSeparately ?? false,
          recordedByContactId: actorId,
        })
        .returning();
      if (!check) throw new Error("gate check insert returned no row");
      const lines = await writeLines(
        tx,
        doorRecordId,
        check.id,
        input.writerContactId,
        input.lines,
        actorId,
      );
      // FR-018: a membership line opens or renews the membership, as a membership sale always has.
      const enrolled = await enrollDoorMemberships(
        tx,
        eventId,
        lines,
        actorId,
        members(input.lines),
      );
      await refreshDeposit(tx, eventId);
      await recordAudit(tx, {
        kind: "gate_check.created",
        actorContactId: actorId,
        details: {
          checkId: check.id,
          doorRecordId,
          writerContactId: input.writerContactId,
          amountCents: lines.reduce((a, l) => a + l.amountCents, 0),
          lines: lines.length,
          depositSeparately: check.depositSeparately,
        },
      });
      return { check: await checkView(tx, doorRecordId, check.id), enrolled };
    }),
  );
}

export async function patchGateCheck(
  db: Db,
  checkId: string,
  input: GateCheckPatchInput,
  actor?: Actor,
): Promise<{ check: GateCheckView; enrolled: DoorEnrollment[] }> {
  const existing = await db.query.gateChecks.findFirst({ where: eq(gateChecks.id, checkId) });
  if (!existing) throw errors.validation("That check no longer exists.");
  const { eventId, scope } = await doorRecordScope(db, existing.doorRecordId);
  assertMayCorrect(actor, scope, existing.recordedByContactId);
  if (
    input.depositSeparately !== undefined &&
    input.depositSeparately !== existing.depositSeparately
  ) {
    assertMayMark(actor, scope);
  }
  if (input.lines && input.lines.length === 0) throw errors.checkNeedsLines();
  if (input.writerContactId) await assertContact(db, input.writerContactId);

  // Research R7: whoever last corrected an entry is who recorded it.
  const actorId = actor?.staff.contactId ?? existing.recordedByContactId;
  return rethrowExplained(() =>
    db.transaction(async (tx) => {
      await tx
        .update(gateChecks)
        .set({
          ...(input.writerContactId ? { writerContactId: input.writerContactId } : {}),
          ...(input.note !== undefined ? { note: blankToNull(input.note) } : {}),
          ...(input.depositSeparately !== undefined
            ? { depositSeparately: input.depositSeparately }
            : {}),
          recordedByContactId: actorId,
          updatedAt: new Date(),
        })
        .where(eq(gateChecks.id, checkId));
      let enrolled: DoorEnrollment[] = [];
      if (input.lines) {
        await tx.delete(gateSales).where(eq(gateSales.checkId, checkId));
        const lines = await writeLines(
          tx,
          existing.doorRecordId,
          checkId,
          input.writerContactId ?? existing.writerContactId,
          input.lines,
          actorId,
        );
        enrolled = await enrollDoorMemberships(tx, eventId, lines, actorId, members(input.lines));
      }
      await refreshDeposit(tx, eventId);
      await recordAudit(tx, {
        kind: "gate_check.updated",
        actorContactId: actor?.staff.contactId ?? null,
        details: { checkId, fields: Object.keys(input) },
      });
      return { check: await checkView(tx, existing.doorRecordId, checkId), enrolled };
    }),
  );
}

export async function deleteGateCheck(db: Db, checkId: string, actor?: Actor): Promise<void> {
  const existing = await db.query.gateChecks.findFirst({ where: eq(gateChecks.id, checkId) });
  if (!existing) throw errors.validation("That check no longer exists.");
  const { eventId, scope } = await doorRecordScope(db, existing.doorRecordId);
  assertMayCorrect(actor, scope, existing.recordedByContactId);

  await db.transaction(async (tx) => {
    const lines = await tx.select().from(gateSales).where(eq(gateSales.checkId, checkId));
    // The lines cascade with the check (migration 0053); a check means nothing without them.
    await tx.delete(gateChecks).where(eq(gateChecks.id, checkId));
    await refreshDeposit(tx, eventId);
    await recordAudit(tx, {
      kind: "gate_check.deleted",
      actorContactId: actor?.staff.contactId ?? null,
      details: {
        checkId,
        doorRecordId: existing.doorRecordId,
        writerContactId: existing.writerContactId,
        amountCents: lines.reduce((a, l) => a + l.amountCents, 0),
        lines: lines.length,
      },
    });
  });
}

function blankToNull(note: string | null | undefined): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
}
