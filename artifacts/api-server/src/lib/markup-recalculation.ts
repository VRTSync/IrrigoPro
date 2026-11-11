import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { parts, materialMarkupSchedules as schedules, pricingAuditEvents, type Part } from "@workspace/db";
import { computeCustomerPrice, isMaterialMarkupEligible } from "@workspace/shared";
import { db } from "../db";
import { getActiveMarkupSchedule, lockMarkupCompany, type MarkupScheduleContext } from "../storage/markup-schedules";
import { createSingleUseConfirmation } from "./single-use-confirmation";
import { logger } from "./logger";

export class RecalculationError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
type Actor = { companyId: number; userId: number; name: string };
export type RecalculationResult = {
  processed: number; total: number; updated: number; unchanged: number;
  excluded: number; errors: string[]; done: boolean;
};
type Run = {
  actor: Actor; context: MarkupScheduleContext; candidates: Part[];
  fingerprint: string; expires: number; started: boolean; busy: boolean; result: RecalculationResult;
};
const ttlMs = 15 * 60_000;
const runs = new Map<string, Run>();
const confirmation = createSingleUseConfirmation({
  scope: "material-markup-recalculation", ttlMs,
  messages: { required: "Preview catalog prices first.", mismatch: "Catalog or schedule changed. Preview again.", expired: "Preview expired. Preview again.", used: "This preview has already been used. Preview again." },
});
function partFingerprint(part: Part) {
  return [part.id, part.companyId, part.sku, part.cost, part.price, part.category, part.isActive, part.updatedAt];
}
function fingerprint(actor: Actor, context: MarkupScheduleContext, catalog: Part[]) {
  return createHash("sha256").update(JSON.stringify([actor.companyId, actor.userId, context, catalog.map(partFingerprint)])).digest("hex");
}
async function load(companyId: number) {
  const context = await getActiveMarkupSchedule(companyId);
  if (!context) throw new RecalculationError("No active material markup schedule. Activate one first.", 404);
  const catalog = await db.select().from(parts).where(eq(parts.companyId, companyId)).orderBy(parts.id);
  return { context, catalog };
}
export async function previewMarkupRecalculation(actor: Actor) {
  for (const [key, run] of runs) if (run.expires < Date.now()) runs.delete(key);
  if (runs.size >= 100) throw new RecalculationError("Too many pending recalculations. Try again after existing previews expire.", 429);
  const { context, catalog } = await load(actor.companyId);
  const candidates = catalog.filter(part => part.isActive && isMaterialMarkupEligible(part));
  const hash = fingerprint(actor, context, catalog);
  const issued = confirmation.issue(hash, new Date());
  runs.set(issued.token, {
    actor, context, candidates, fingerprint: hash, expires: issued.expiresAt.getTime(), started: false, busy: false,
    result: { total: candidates.length, processed: 0, updated: 0, unchanged: 0, excluded: catalog.length - candidates.length, errors: [], done: false },
  });
  return { confirmationToken: issued.token, eligible: candidates.length, excluded: catalog.length - candidates.length,
    scheduleId: context.schedule.id, scheduleName: context.schedule.name, expiresAt: issued.expiresAt.toISOString() };
}

/** One database transaction per part makes the catalog price and its audit indivisible. */
export async function repriceMarkupPart(expected: Part, context: MarkupScheduleContext, actor: Actor) {
  return db.transaction(async tx => {
    // Use the same company lock as activation/edit; the active version cannot
    // change between this check and the committed catalog/audit pair.
    await lockMarkupCompany(tx, actor.companyId);
    const [active] = await tx.select({ id: schedules.id }).from(schedules).where(and(eq(schedules.companyId, actor.companyId), eq(schedules.isActive, true)));
    if (active?.id !== context.schedule.id) throw new RecalculationError("The active schedule changed. Preview again.");
    const [part] = await tx.select().from(parts).where(and(eq(parts.id, expected.id), eq(parts.companyId, actor.companyId))).for("update");
    if (!part || JSON.stringify(partFingerprint(part)) !== JSON.stringify(partFingerprint(expected)))
      throw new RecalculationError(`Part ${expected.sku} changed since preview. Preview again.`);
    if (!part.isActive || !isMaterialMarkupEligible(part)) throw new RecalculationError(`Part ${expected.sku} is no longer eligible.`);
    const price = computeCustomerPrice(Number(part.cost), context.tiers).toFixed(2);
    if (price === Number(part.price).toFixed(2)) return "unchanged" as const;
    await tx.update(parts).set({ price }).where(and(eq(parts.companyId, actor.companyId), eq(parts.id, part.id)));
    await tx.insert(pricingAuditEvents).values({
      companyId: actor.companyId, source: "catalog_part", parentId: part.id, parentNumber: part.sku,
      kind: "markup_schedule_reprice", delta: (Number(price) - Number(part.price)).toFixed(2), itemCount: 1,
      actorUserId: actor.userId, actorName: actor.name,
      details: { beforePrice: part.price, afterPrice: price, cost: part.cost,
        scheduleId: context.schedule.id, scheduleName: context.schedule.name,
        effectiveMarkupPercent: (Number(price) - Number(part.cost)) / Number(part.cost) * 100 },
    });
    return "updated" as const;
  });
}

export async function runMarkupRecalculation(actor: Actor, token: string, offset: number): Promise<RecalculationResult> {
  const run = runs.get(token);
  if (!run || run.expires < Date.now() || run.actor.companyId !== actor.companyId || run.actor.userId !== actor.userId)
    throw new RecalculationError("Preview is missing or expired. Preview again.");
  if (run.busy || run.result.done || offset !== run.result.processed) throw new RecalculationError("This batch is already processed or running. Preview again.");
  run.busy = true;
  try {
    if (!run.started) {
      const fresh = await load(actor.companyId);
      const check = confirmation.verify(token, fingerprint(actor, fresh.context, fresh.catalog), new Date());
      if (!check.ok) throw new RecalculationError(check.message, check.status);
      run.started = true;
    }
    const batch = run.candidates.slice(offset, offset + 100);
    for (const part of batch) {
      try {
        const changed = await repriceMarkupPart(part, run.context, actor);
        run.result[changed]++;
      } catch (error) {
        run.result.errors.push(`SKU ${part.sku}: ${error instanceof Error ? error.message : "Could not update; try again"}`);
      }
      run.result.processed++;
    }
    run.result.done = run.result.processed === run.result.total;
    logger.info({ companyId: actor.companyId, processed: run.result.processed, total: run.result.total, updated: run.result.updated, errors: run.result.errors.length }, "Material markup recalculation batch committed");
    return { ...run.result, errors: [...run.result.errors] };
  } finally { run.busy = false; }
}
